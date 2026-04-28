---
title: Audit Trail
description: Built-in action pipeline auditing for change visibility and compliance
section: Architecture Concepts
order: 10
draft: false
---

# Audit Trail

- [Introduction](#introduction)
- [What an Audit Record Contains](#what-an-audit-record-contains)
- [Schema: the audit_events table](#schema-the-audit-events-table)
- [Creating an AuditTask](#creating-an-audittask)
- [Emitting Audit Events from Actions](#emitting-audit-events-from-actions)
- [Capturing Before and After Snapshots](#capturing-before-and-after-snapshots)
- [The AuditRepository](#the-auditrepository)
- [Querying Audit History](#querying-audit-history)
- [Cross-module Audit Access](#cross-module-audit-access)
- [Testing Audit Behaviour](#testing-audit-behaviour)

<a name="introduction"></a>
## Introduction

LumiArq action pipelines are designed to support first-class auditing.

An audit record can capture:

- Who initiated the action.
- Which module and action executed.
- Which entities changed.
- Before and after snapshots (when configured).
- When the operation occurred.

<a name="recommended-pattern"></a>
## Recommended pattern

Emit audit events from actions where state transitions happen. Keep formatting and persistence in dedicated tasks so business logic remains focused and testable.

---

*The sections below expand this pattern with complete, production-ready examples.*

<a name="what-an-audit-record-contains"></a>
## What an Audit Record Contains

```ts
// src/modules/Audit/contracts/types/audit-event.types.ts
export interface AuditEvent {
  id:          string         // UUID – unique identifier for this record
  actorId:     string | null  // The user or system that triggered the action
  actorType:   string         // 'user' | 'system' | 'webhook' | 'scheduled-job'
  module:      string         // e.g. 'Billing'
  action:      string         // e.g. 'createInvoice'
  entityType:  string         // e.g. 'Invoice'
  entityId:    string         // e.g. 'inv_01HXZ...'
  event:       string         // e.g. 'invoice.created'
  before:      unknown | null // Snapshot before the change
  after:       unknown | null // Snapshot after the change
  metadata:    Record<string, unknown>
  occurredAt:  string         // ISO 8601 timestamp
}
```

<a name="schema-the-audit-events-table"></a>
## Schema: the audit_events table

```ts
// src/modules/Audit/infrastructure/database/schema.ts
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const auditEventsTable = sqliteTable('audit_events', {
  id:         text('id').primaryKey(),
  actorId:    text('actor_id'),
  actorType:  text('actor_type').notNull().default('user'),
  module:     text('module').notNull(),
  action:     text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId:   text('entity_id').notNull(),
  event:      text('event').notNull(),
  before:     text('before'),      // JSON serialised — null when N/A
  after:      text('after'),       // JSON serialised — null when N/A
  metadata:   text('metadata'),    // JSON serialised
  occurredAt: text('occurred_at').notNull(),
})
```

Create the table with a migration:

```bash
pnpm lumis make:migration create_audit_events_table
pnpm lumis db:migrate
```

<a name="creating-an-audittask"></a>
## Creating an AuditTask

A task is the right home for audit persistence because it is a side effect with no business rules. It keeps the action lean
and the storage concern isolated.

```ts
// src/modules/Audit/logic/tasks/record-audit-event.task.ts
import { defineTask } from '@lumiarq/framework'
import { AuditRepository } from '@modules/Audit/logic/repositories/audit.repository'
import type { AuditEventPayload } from '@modules/Audit/contracts/types/audit-event.types'
import { ulid } from 'ulid'

const repo = new AuditRepository()

export const recordAuditEvent = defineTask(async (payload: AuditEventPayload) => {
  await repo.create({
    id:         ulid(),
    actorId:    payload.actorId   ?? null,
    actorType:  payload.actorType ?? 'system',
    module:     payload.module,
    action:     payload.action,
    entityType: payload.entityType,
    entityId:   payload.entityId,
    event:      payload.event,
    before:     payload.before ? JSON.stringify(payload.before) : null,
    after:      payload.after  ? JSON.stringify(payload.after)  : null,
    metadata:   payload.metadata ? JSON.stringify(payload.metadata) : null,
    occurredAt: new Date().toISOString(),
  })
})
```

The repository is a thin wrapper around `BaseRepository`:

```ts
// src/modules/Audit/logic/repositories/audit.repository.ts
import { BaseRepository } from '@lumiarq/framework'
import { auditEventsTable } from '@modules/Audit/infrastructure/database/schema'

export class AuditRepository extends BaseRepository {
  async create(data: typeof auditEventsTable.$inferInsert) {
    return this.db.insert(auditEventsTable).values(data).run()
  }
}
```

<a name="emitting-audit-events-from-actions"></a>
## Emitting Audit Events from Actions

Call `recordAuditEvent` at the end of any action where a state transition must be traceable.

```ts
// src/modules/Billing/logic/actions/create-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'
import { recordAuditEvent } from '@modules/Audit/contracts'

const repo = new InvoiceRepository()

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  const invoice = await repo.create(dto)

  await recordAuditEvent({
    actorId:    dto.createdByUserId,
    actorType:  'user',
    module:     'Billing',
    action:     'createInvoice',
    entityType: 'Invoice',
    entityId:   invoice.id,
    event:      'invoice.created',
    before:     null,
    after:      invoice,
    metadata:   { totalCents: invoice.totalCents, status: invoice.status },
  })

  return invoice
})
```

For destructive operations (delete, void, archive), always record both the pre- and post-states so the change is reversible
and diffable:

```ts
// src/modules/Billing/logic/actions/void-invoice.action.ts
export const voidInvoice = defineAction(async (dto: VoidInvoiceDto) => {
  const before = await repo.findById(dto.id)
  if (!before) throw new NotFoundError('Invoice not found.')
  if (before.status === 'void') throw new ValidationError('Invoice is already void.')

  const after = await repo.update({ id: dto.id, status: 'void', voidReason: dto.reason })

  await recordAuditEvent({
    actorId:    dto.actorId,
    actorType:  'user',
    module:     'Billing',
    action:     'voidInvoice',
    entityType: 'Invoice',
    entityId:   dto.id,
    event:      'invoice.voided',
    before,
    after,
    metadata:   { reason: dto.reason },
  })

  return after
})
```

<a name="capturing-before-and-after-snapshots"></a>
## Capturing Before and After Snapshots

Snapshots are plain serialisable objects. Fetch the entity **before** the write and pass both to `recordAuditEvent` — the
task serialises them with `JSON.stringify` before persisting.

Strip PII (passwords, SSNs, payment tokens) before recording:

```ts
function safeUserSnapshot(user: User) {
  const { passwordHash, mfaSecret, ...safe } = user
  return safe
}

const before = safeUserSnapshot(await userRepo.findById(dto.userId))
const after  = await userRepo.update(dto)

await recordAuditEvent({
  ...commonFields,
  before: safeUserSnapshot(before),
  after:  safeUserSnapshot(after),
})
```

<a name="the-auditrepository"></a>
## The AuditRepository

Extend `AuditRepository` with read methods for the events feed:

```ts
import { BaseRepository } from '@lumiarq/framework'
import { auditEventsTable } from '@modules/Audit/infrastructure/database/schema'
import { and, desc, eq, gte, lte } from 'drizzle-orm'

export class AuditRepository extends BaseRepository {
  async create(data: typeof auditEventsTable.$inferInsert) {
    return this.db.insert(auditEventsTable).values(data).run()
  }

  async findByEntity(entityType: string, entityId: string) {
    return this.db
      .select()
      .from(auditEventsTable)
      .where(and(
        eq(auditEventsTable.entityType, entityType),
        eq(auditEventsTable.entityId, entityId),
      ))
      .orderBy(desc(auditEventsTable.occurredAt))
      .all()
  }

  async findByActor(actorId: string, opts?: { from?: string; to?: string }) {
    const conditions = [eq(auditEventsTable.actorId, actorId)]
    if (opts?.from) conditions.push(gte(auditEventsTable.occurredAt, opts.from))
    if (opts?.to)   conditions.push(lte(auditEventsTable.occurredAt, opts.to))

    return this.db
      .select()
      .from(auditEventsTable)
      .where(and(...conditions))
      .orderBy(desc(auditEventsTable.occurredAt))
      .all()
  }

  async paginate(opts: { page: number; perPage: number }) {
    return super.paginate(auditEventsTable, {
      orderBy: [desc(auditEventsTable.occurredAt)],
      page:    opts.page,
      perPage: opts.perPage,
    })
  }
}
```

<a name="querying-audit-history"></a>
## Querying Audit History

```ts
// src/modules/Audit/logic/queries/get-entity-audit-history.query.ts
import { defineQuery } from '@lumiarq/framework'
import { AuditRepository } from '@modules/Audit/logic/repositories/audit.repository'

const repo = new AuditRepository()

export const getEntityAuditHistory = defineQuery(
  async ({ entityType, entityId }: { entityType: string; entityId: string }) => {
    const events = await repo.findByEntity(entityType, entityId)

    return events.map((e) => ({
      ...e,
      before:   e.before   ? JSON.parse(e.before)   : null,
      after:    e.after    ? JSON.parse(e.after)    : null,
      metadata: e.metadata ? JSON.parse(e.metadata) : null,
    }))
  },
)
```

Expose it from a handler:

```ts
// src/modules/Billing/http/handlers/invoice-audit.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { getEntityAuditHistory } from '@modules/Audit/logic/queries/get-entity-audit-history.query'

export const InvoiceAuditHandler = defineHandler(async (ctx) => {
  const id = ctx.req.param('id')!
  const events = await getEntityAuditHistory({ entityType: 'Invoice', entityId: id })
  return ctx.json({ events })
})
```

```ts
Route.get('/invoices/:id/audit', InvoiceAuditHandler, {
  name:   'billing.invoices.audit',
  render: 'static',
})
```

<a name="cross-module-audit-access"></a>
## Cross-module Audit Access

Export `recordAuditEvent` from the `Audit` module's public contract so other modules never depend on the task
implementation directly:

```ts
// src/modules/Audit/contracts/index.ts
export { recordAuditEvent } from '@modules/Audit/logic/tasks/record-audit-event.task'
export type { AuditEvent, AuditEventPayload } from './types/audit-event.types'
```

Import from the contract in other modules:

```ts
// src/modules/Users/logic/actions/delete-user.action.ts
import { recordAuditEvent } from '@modules/Audit/contracts'
```

<a name="testing-audit-behaviour"></a>
## Testing Audit Behaviour

Use `withTestContext` — it wraps the test in a rolled-back transaction so every write (including audit events) is cleaned up
automatically. Assert that the correct record was persisted with the correct shape:

```ts
// src/modules/Billing/tests/void-invoice.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/framework'
import { voidInvoice } from '@modules/Billing/logic/actions/void-invoice.action'
import { AuditRepository } from '@modules/Audit/logic/repositories/audit.repository'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'

describe('voidInvoice', () => {
  it(
    'writes an invoice.voided audit event with before and after snapshots',
    withTestContext({}, async () => {
      const invoiceRepo = new InvoiceRepository()
      const auditRepo   = new AuditRepository()

      const invoice = await invoiceRepo.create({
        userId:     'user_1',
        totalCents: 5000,
        status:     'open',
        dueDateIso: '2026-06-01',
      })

      await voidInvoice({ id: invoice.id, reason: 'duplicate', actorId: 'user_1' })

      const events = await auditRepo.findByEntity('Invoice', invoice.id)

      expect(events).toHaveLength(1)
      expect(events[0].event).toBe('invoice.voided')
      expect(JSON.parse(events[0].before!).status).toBe('open')
      expect(JSON.parse(events[0].after!).status).toBe('void')
      expect(JSON.parse(events[0].metadata!).reason).toBe('duplicate')
    }),
  )
})
```
