---
title: The Unidirectional Flow
description: How requests move through handlers, actions, tasks, and queries in a strict one-way flow
section: Architecture Concepts
order: 6
draft: false
---

# The Unidirectional Flow

- [Introduction](#introduction)
- [The Four Layers](#the-four-layers)
- [Flow Diagram](#flow-diagram)
- [Handlers](#handlers)
- [Actions](#actions)
- [Tasks](#tasks)
- [Queries](#queries)
- [What Each Layer Can and Cannot Do](#what-each-layer-can-and-cannot-do)
- [A Complete Example](#a-complete-example)
- [Why One Direction](#why-one-direction)
- [Testing by Layer](#testing-by-layer)

<a name="introduction"></a>
## Introduction

LumiARQ enforces a single direction of control flow. Every HTTP request enters through a **handler**, which delegates write-side operations to **actions**, side effects to **tasks**, and read-side projections to **queries**. The flow never reverses.

This is not a suggestion — it is a structural constraint. The module's directory layout makes violations visible at a glance, and the framework's lint rules flag cross-layer imports at CI time.

<a name="the-four-layers"></a>
## The Four Layers

| Layer | Directory | Responsibility | Creates / reads |
|---|---|---|---|
| Handler | `http/handlers/` | Receive HTTP requests, validate input, delegate, return responses | Reads request, writes response |
| Action | `logic/actions/` | Orchestrate write-side business logic | Writes state, calls tasks, emits events |
| Task | `logic/tasks/` | Execute a single infrastructure side effect | Sends email, uploads file, dispatches job |
| Query | `logic/queries/` | Fetch read-side projections | Reads state only |

<a name="flow-diagram"></a>
## Flow Diagram

```
HTTP Request
     │
     ▼
┌─────────────┐
│   Handler   │  ── validates input
│  (http/)    │  ── calls action (writes) or query (reads)
└──────┬──────┘  ── returns Response
       │
       ├─────────────────────────┐
       │                         │
       ▼                         ▼
┌─────────────┐         ┌──────────────┐
│   Action    │         │    Query     │
│  (write)    │         │   (read)     │
└──────┬──────┘         └──────────────┘
       │
       ├───────────────┐
       │               │
       ▼               ▼
┌─────────────┐  ┌─────────────┐
│    Task     │  │    Task     │
│  (side fx)  │  │  (side fx)  │
└─────────────┘  └─────────────┘
```

The flow is **always top-down**. Handlers delegate to actions or queries. Actions delegate to tasks. Nothing flows back up.

<a name="handlers"></a>
## Handlers

Handlers are the outermost layer. Their job is to translate an HTTP request into a call to the logic layer and translate the result back into an HTTP response.

Handlers should be **thin**. They do not contain business logic, do not access the database directly, and do not call third-party services. Every substantive operation belongs one layer deeper.

```ts
// src/modules/Billing/http/handlers/create-invoice.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { createInvoice } from '@modules/Billing/logic/actions/create-invoice.action'
import { createInvoiceSchema } from '@modules/Billing/logic/validators/create-invoice.validator'

export const createInvoiceHandler = defineHandler(async (ctx) => {
  const body = await ctx.req.json()

  // 1. Validate
  const parsed = createInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return ctx.json({ errors: parsed.error.flatten().fieldErrors }, 422)
  }

  // 2. Delegate to action (write path)
  const invoice = await createInvoice(parsed.data)

  // 3. Return response
  return ctx.json({ invoice }, 201)
})
```

A handler that needs to **read** data calls a query directly:

```ts
export const listInvoicesHandler = defineHandler(async (ctx) => {
  const userId = ctx.get('userId') as string
  const page = Number(ctx.req.query('page') ?? '1')

  // Delegate to query (read path)
  const result = await getInvoices({ userId, page })

  return ctx.json(result)
})
```

<a name="actions"></a>
## Actions

Actions own write-side business logic. They are the answer to "what does our system do?" — creating an invoice, processing a payment, closing an account.

An action may call tasks to perform side effects, and it may call repositories to persist state. It does not call other actions inside the same module, and it does not return HTML.

```ts
// src/modules/Billing/logic/actions/create-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import { EventBus } from '@lumiarq/framework'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'
import { sendInvoiceEmailTask } from '@modules/Billing/logic/tasks/send-invoice-email.task'
import { InvoiceCreatedEvent } from '@modules/Billing/contracts'
import type { CreateInvoiceDto } from '@modules/Billing/contracts'

const repo = new InvoiceRepository()

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  // Business rule enforcement
  if (dto.lineItems.length === 0) {
    throw new Error('An invoice must have at least one line item.')
  }

  const totalCents = dto.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitCents,
    0,
  )

  // Persist
  const invoice = await repo.create({
    customerId: dto.customerId,
    lineItems: dto.lineItems,
    totalCents,
    dueDateIso: dto.dueDateIso,
    status: 'draft',
  })

  // Emit a domain event (read by listeners in other modules)
  EventBus.dispatch(InvoiceCreatedEvent, {
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    totalCents: invoice.totalCents,
  })

  // Kick off side-effect task
  await sendInvoiceEmailTask({ invoiceId: invoice.id })

  return invoice
})
```

<a name="tasks"></a>
## Tasks

Tasks are single-purpose infrastructure operations. A task does one thing and does it well: send an email, upload a file to object storage, dispatch a background job, call an external API.

Tasks receive a typed payload and do not return domain data to the caller. They are disposable: you can swap the implementation behind a task without changing the action that calls it.

```ts
// src/modules/Billing/logic/tasks/send-invoice-email.task.ts
import { defineTask } from '@lumiarq/framework'
import { Mailer } from '@lumiarq/framework'
import { getInvoice } from '@modules/Billing/logic/queries/get-invoice.query'

export const sendInvoiceEmailTask = defineTask(async ({ invoiceId }: { invoiceId: string }) => {
  const invoice = await getInvoice({ id: invoiceId })

  if (!invoice) return

  await Mailer.send({
    to: invoice.customerEmail,
    subject: `Invoice ${invoice.number} from Acme`,
    template: 'invoice-created',
    payload: { invoice },
  })
})
```

A task may call a query to fetch data it needs — that is the only direction where a lower layer is allowed to move upward for reads. A task must not call an action.

<a name="queries"></a>
## Queries

Queries are read-only operations. They fetch data from the data store and project it into a shape that the caller can use. They do not write, do not mutate state, do not emit events, and do not call actions or tasks.

The constraint is strict and intentional. A query that writes is a bug waiting to surface under load.

```ts
// src/modules/Billing/logic/queries/get-invoices.query.ts
import { defineQuery } from '@lumiarq/framework'
import { db } from '@shared/database/connection'
import { invoices } from '@shared/database/schemas/invoices.schema'
import { eq } from 'drizzle-orm'
import type { GetInvoicesDto } from '@modules/Billing/contracts'

export const getInvoices = defineQuery(async ({ userId, page = 1 }: GetInvoicesDto) => {
  const limit = 20
  const offset = (page - 1) * limit

  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.userId, userId))
    .limit(limit)
    .offset(offset)

  return {
    data: rows,
    meta: { page, limit },
  }
})
```

<a name="what-each-layer-can-and-cannot-do"></a>
## What Each Layer Can and Cannot Do

| | Handler | Action | Task | Query |
|---|---|---|---|---|
| Read request body / params | ✅ | ❌ | ❌ | ❌ |
| Return HTTP response | ✅ | ❌ | ❌ | ❌ |
| Call an action | ✅ | ❌ | ❌ | ❌ |
| Call a task | ❌ | ✅ | ❌ | ❌ |
| Call a query | ✅ | ❌ | ✅ | ❌ |
| Write to the database | ❌ | ✅ | ✅ | ❌ |
| Read from the database | ❌ | ❌ | ❌ | ✅ |
| Emit domain events | ❌ | ✅ | ❌ | ❌ |
| Call external APIs | ❌ | ❌ | ✅ | ❌ |
| Call another module's action | ❌ | ❌ | ❌ | ❌ |

> **Note** — Modules communicate across boundaries through domain events (`EventBus.dispatch` → listeners in other modules), not by calling each other's actions or queries directly.

<a name="a-complete-example"></a>
## A Complete Example

Here is the full `POST /invoices` path, tracing flow from handler to database:

```
POST /invoices
  └─ createInvoiceHandler         (validates body, calls action)
       └─ createInvoice()         (action: enforces rules, persists, emits event)
            ├─ repo.create()      (writes to DB)
            ├─ EventBus.dispatch  (InvoiceCreatedEvent → listeners in other modules)
            └─ sendInvoiceEmailTask()  (task: fetches invoice, sends email)
                  └─ getInvoice() (query: reads invoice for email payload)
```

Each step is a separate file, separately testable, with a single responsibility.

<a name="why-one-direction"></a>
## Why One Direction

**Predictable debugging.** When something goes wrong, you know exactly where to look. A bug on write is in an action or task. A bug on read is in a query. A routing or validation bug is in a handler. The layer tells you where to start.

**Isolated testing.** Each layer can be tested without the others. Queries need only a database connection. Actions need only stubs for tasks and repositories. Handlers need only mock actions and queries. Nothing bleeds across.

**No circular dependencies.** Queries cannot call actions. Actions cannot call handlers. Tasks cannot call actions. The constraint eliminates an entire class of architectural decay.

**Replaceable infrastructure.** A task wrapping an email provider can be swapped for a different provider by changing one file. The action does not care — it calls the same task interface.

<a name="testing-by-layer"></a>
## Testing by Layer

LumiARQ's layer model makes unit testing predictable.

**Testing a query** — provide only a database connection:

```ts
import { withTestContext } from '@lumiarq/framework'
import { getInvoices } from '@modules/Billing/logic/queries/get-invoices.query'

test('returns paginated invoices for a user', async () => {
  await withTestContext(async () => {
    const result = await getInvoices({ userId: 'user_1', page: 1 })
    expect(result.data).toHaveLength(3)
    expect(result.meta.page).toBe(1)
  })
})
```

**Testing an action** — stub the task to avoid sending real emails:

```ts
import { withTestContext } from '@lumiarq/framework'
import { createInvoice } from '@modules/Billing/logic/actions/create-invoice.action'
import * as emailTask from '@modules/Billing/logic/tasks/send-invoice-email.task'

test('creates invoice and emits InvoiceCreatedEvent', async () => {
  const taskSpy = vi.spyOn(emailTask, 'sendInvoiceEmailTask').mockResolvedValue(undefined)

  await withTestContext(async () => {
    const invoice = await createInvoice({
      customerId: 'cust_1',
      lineItems: [{ description: 'Consulting', quantity: 1, unitCents: 5000 }],
      dueDateIso: '2025-12-31',
    })

    expect(invoice.status).toBe('draft')
    expect(taskSpy).toHaveBeenCalledWith({ invoiceId: invoice.id })
  })
})
```

**Testing a handler** — mock the action to test HTTP contract in isolation:

```ts
import { testRequest } from '@lumiarq/framework/testing'
import * as action from '@modules/Billing/logic/actions/create-invoice.action'

test('returns 422 when line items are empty', async () => {
  const res = await testRequest('POST', '/billing/invoices', {
    body: { customerId: 'cust_1', lineItems: [], dueDateIso: '2025-12-31' },
  })

  expect(res.status).toBe(422)
  expect(action.createInvoice).not.toHaveBeenCalled()
})
```
