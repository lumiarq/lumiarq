---
title: Porto SAP Pattern
description: Understanding Porto SAP and strict module isolation in Lumiarq
section: Architecture Concepts
order: 3
draft: false
---

# Bounded Context

- [Introduction](#introduction)
- [What a Bounded Context Owns](#what-a-bounded-context-owns)
- [The Public Contract](#the-public-contract)
- [Cross-Module Communication](#cross-module-communication)
- [Event-Based Decoupling](#event-based-decoupling)
- [What Is Allowed vs Forbidden](#what-is-allowed-vs-forbidden)
- [ESLint Enforcement](#eslint-enforcement)
- [IAM as a Bounded Context Example](#iam-as-a-bounded-context-example)
- [Summary](#summary)

<a name="introduction"></a>
## Introduction

In Lumiarq, every module is a **bounded context**: a self-contained slice of the application that owns its own data model, business logic, and public interface. Modules communicate exclusively through explicitly exported contracts — never by reaching into another module's internals.

This boundary enforcement is what keeps large applications from becoming entangled codebases where a change to one feature silently breaks an unrelated feature.

<a name="what-a-bounded-context-owns"></a>
## What a Bounded Context Owns

Each module is responsible for everything within its domain:

| Concern | Location |
|---|---|
| HTTP routes | `http/routes/*.web.ts`, `http/routes/*.api.ts` |
| Request handlers | `http/handlers/` |
| Business logic | `logic/actions/`, `logic/tasks/` |
| Read queries | `logic/queries/` |
| Public surface | `contracts/` |
| Tests | `tests/` |

Nothing outside the module directory should import from inside it except via the `contracts/` directory.

<a name="the-public-contract"></a>
## The Public Contract

Every module exposes a deliberate public surface through its `contracts/` directory. This is the only thing other modules are allowed to import.

```ts
// src/modules/Billing/contracts/index.ts
export type { Invoice, InvoiceStatus } from './invoice.types'
export type { CreateInvoiceDto } from './dto/create-invoice.dto'
export { InvoiceCreatedEvent } from './events/invoice-created.event'
```

Any type, DTO, or event schema you want to share with the rest of the application belongs here. Internal implementation details — repository classes, raw database rows, private helpers — stay private.

<a name="cross-module-communication"></a>
## Cross-Module Communication

The only legitimate way for one module to use functionality from another is to import from that module's public contracts:

```ts
// src/modules/Notifications/logic/actions/send-invoice-notification.action.ts
import { defineAction } from '@lumiarq/framework'

// Allowed: importing a public contract type from Billing
import type { Invoice } from '@modules/Billing/contracts'

export const sendInvoiceNotification = defineAction(async (invoice: Invoice) => {
  // send a notification based on the invoice data
})
```

```ts
// src/modules/Notifications/logic/actions/send-invoice-notification.action.ts

// FORBIDDEN: importing a private implementation from inside another module
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'
//                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// This bypasses the boundary and couples Notifications to Billing's internals.
```

The rule is simple: if it is not in `contracts/`, it is private.

<a name="event-based-decoupling"></a>
## Event-Based Decoupling

When one module needs to react to something that happened in another module, the preferred approach is domain events. The emitting module publishes an event. Any number of other modules can subscribe without the emitter knowing about them.

```ts
// src/modules/Billing/contracts/events/invoice-created.event.ts
import { z } from 'zod'

export const InvoiceCreatedEvent = {
  name: 'billing.invoice.created' as const,
  schema: z.object({
    invoiceId: z.string().uuid(),
    customerId: z.string().uuid(),
    totalCents: z.number().int(),
  }),
}
```

```ts
// src/modules/Billing/logic/actions/create-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import { EventBus } from '@lumiarq/framework'
import { InvoiceCreatedEvent } from '@modules/Billing/contracts'
import type { CreateInvoiceDto } from '@modules/Billing/contracts'

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  // ... create invoice in DB ...
  const invoice = { id: 'inv_123', customerId: dto.customerId, totalCents: dto.totalCents }

  EventBus.dispatch(InvoiceCreatedEvent, {
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    totalCents: invoice.totalCents,
  })

  return invoice
})
```

```ts
// src/modules/Notifications/bootstrap/listeners.ts
import { EventBus } from '@lumiarq/framework'
import { InvoiceCreatedEvent } from '@modules/Billing/contracts'
import { sendInvoiceNotification } from '@modules/Notifications/logic/actions/send-invoice-notification.action'

EventBus.on(InvoiceCreatedEvent, async (payload) => {
  await sendInvoiceNotification(payload)
})
```

The `Billing` module has no dependency on `Notifications`. The coupling flows through the event schema alone.

<a name="what-is-allowed-vs-forbidden"></a>
## What Is Allowed vs Forbidden

### Allowed

```ts
// Importing a public contract type
import type { Invoice } from '@modules/Billing/contracts'

// Importing a public event schema
import { InvoiceCreatedEvent } from '@modules/Billing/contracts'

// Importing a public DTO
import type { CreateInvoiceDto } from '@modules/Billing/contracts'

// Using your own module's internal types freely
import { InvoiceRepository } from '../repositories/invoice.repository'
```

### Forbidden

```ts
// Direct import of a repository from another module
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'

// Direct import of an action from another module
import { createInvoice } from '@modules/Billing/logic/actions/create-invoice.action'

// Direct import of a handler from another module
import { createInvoiceHandler } from '@modules/Billing/http/handlers/create-invoice.handler'

// Reaching into another module's database schema
import { invoicesTable } from '@modules/Billing/infrastructure/database/schema'
```

<a name="eslint-enforcement"></a>
## ESLint Enforcement

Lumiarq ships an ESLint plugin that enforces module boundaries automatically. The `no-cross-module-bypass` rule reports an error whenever a file in one module imports from a path inside a different module that is not the `contracts/` directory.

```jsonc
// eslint.config.js (flat config)
import lumivel from 'eslint-plugin-lumivel'

export default [
  lumivel.configs.recommended,
  // no-cross-module-bypass is included and set to 'error' by default
]
```

If you attempt to bypass the boundary, the linter will catch it before it reaches CI:

```
src/modules/Notifications/logic/actions/send-invoice-notification.action.ts
  3:1  error  Cross-module import bypasses bounded context boundary.
              Import from '@modules/Billing/contracts' instead.
              lumivel/no-cross-module-bypass
```

<a name="iam-as-a-bounded-context-example"></a>
## IAM as a Bounded Context Example

The IAM (Identity & Access Management) module installed by `lumis auth:install --iam` is a canonical example of a fully isolated bounded context. It never imports from the `Auth` or `User` modules. It exposes its own contracts for principals, roles, and permissions.

```
src/modules/IAM/
  contracts/
    index.ts          <- public surface: Principal, Permission, Role types
    events/
      role-assigned.event.ts
  http/
    handlers/
    routes/
  logic/
    actions/
    queries/
  tests/
```

Any module that needs to check permissions imports `Principal` from `@modules/IAM/contracts`, never from IAM's internals.

<a name="summary"></a>
## Summary

- A module is a bounded context: it owns everything within its directory.
- The `contracts/` directory is the only public surface.
- Other modules import contracts, never internals.
- Domain events decouple reactions across module boundaries.
- The `no-cross-module-bypass` ESLint rule enforces these boundaries automatically.
