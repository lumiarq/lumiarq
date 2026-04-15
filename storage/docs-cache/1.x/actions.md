---
title: Actions
description: Encapsulating business logic with actions
section: Architecture Concepts
order: 7
draft: false
---

# Actions

- [Introduction](#introduction)
- [Defining an Action](#defining-an-action)
- [Data Transfer Objects](#data-transfer-objects)
- [A Complete Action](#a-complete-action)
- [Generating an Action](#generating-an-action)
- [Generating an Action with a Task](#generating-an-action-with-a-task)
- [Calling an Action from a Handler](#calling-an-action-from-a-handler)
- [Throwing Errors from Actions](#throwing-errors-from-actions)
- [Idempotent Actions](#idempotent-actions)
- [Emitting Domain Events](#emitting-domain-events)
- [Testing an Action](#testing-an-action)
- [Database Transactions](#database-transactions)
- [Composing Actions](#composing-actions)

<a name="introduction"></a>
## Introduction

An **action** is a named, single-purpose function that encapsulates a discrete piece of business logic. Actions live in `logic/actions/` inside a module and are created with `defineAction`. They are the home for everything that _changes_ application state: creating records, updating data, emitting domain events, calling tasks.

The pattern is deliberate: one action per use case. This keeps each function focused, testable, and easy to reason about.

<a name="defining-an-action"></a>
## Defining an Action

```ts
import { defineAction } from '@lumiarq/framework'

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  // ... business logic
})
```

`defineAction` wraps your function and marks it as an action in the framework's registry. The wrapped function has the same call signature — you pass the DTO directly when calling it.

<a name="data-transfer-objects"></a>
## Data Transfer Objects

Actions receive a single DTO (Data Transfer Object) — a typed object that carries the input the action needs. Define DTOs in the module's `contracts/dto/` directory.

```ts
// src/modules/Billing/contracts/dto/create-invoice.dto.ts
export interface CreateInvoiceDto {
  customerId: string
  lineItems: Array<{
    description: string
    quantity: number
    unitCents: number
  }>
  dueDateIso: string
}
```

Keeping DTOs in `contracts/` allows other modules to reference the shape without depending on the action itself.

<a name="a-complete-action"></a>
## A Complete Action

```ts
// src/modules/Billing/logic/actions/create-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import { EventBus } from '@lumiarq/framework'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'
import { InvoiceCreatedEvent } from '@modules/Billing/contracts'
import type { CreateInvoiceDto } from '@modules/Billing/contracts'

const repo = new InvoiceRepository()

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  // Validate business rules
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

  // Emit domain event so other modules can react
  EventBus.dispatch(InvoiceCreatedEvent, {
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    totalCents: invoice.totalCents,
  })

  return invoice
})
```

<a name="generating-an-action"></a>
## Generating an Action

```bash
pnpm lumis make:action Billing CreateInvoice
```

This creates:

```
src/modules/Billing/logic/actions/create-invoice.action.ts
src/modules/Billing/contracts/dto/create-invoice.dto.ts
src/modules/Billing/tests/create-invoice.test.ts
```

<a name="generating-an-action-with-a-task"></a>
## Generating an Action with a Task

Use `--with-task` when the action needs to kick off a side-effect task (sending an email, uploading a file, enqueuing a job).

```bash
pnpm lumis make:action Billing CreateInvoice --with-task
```

This generates four files:

```
src/modules/Billing/logic/actions/create-invoice.action.ts   <- action, pre-wired to call the task
src/modules/Billing/logic/tasks/create-invoice.task.ts       <- task stub
src/modules/Billing/contracts/dto/create-invoice.dto.ts      <- shared DTO
src/modules/Billing/tests/create-invoice.test.ts             <- failing test stub
```

The action stub is already wired to call the task:

```ts
// Generated action stub (--with-task)
import { defineAction } from '@lumiarq/framework'
import { createInvoiceTask } from '@modules/Billing/logic/tasks/create-invoice.task'
import type { CreateInvoiceDto } from '@modules/Billing/contracts'

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  // TODO: implement business logic
  await createInvoiceTask(dto)
})
```

<a name="calling-an-action-from-a-handler"></a>
## Calling an Action from a Handler

Actions are plain async functions. Call them directly from handlers.

```ts
// src/modules/Billing/http/handlers/create-invoice.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { createInvoice } from '@modules/Billing/logic/actions/create-invoice.action'
import { createInvoiceSchema } from '@modules/Billing/logic/validators/create-invoice.validator'

export const createInvoiceHandler = defineHandler(async (ctx) => {
  const body = await ctx.req.json()
  const parsed = createInvoiceSchema.safeParse(body)

  if (!parsed.success) {
    return ctx.json({ errors: parsed.error.flatten().fieldErrors }, 422)
  }

  const invoice = await createInvoice(parsed.data)

  return ctx.json({ invoice }, 201)
})
```

<a name="throwing-errors-from-actions"></a>
## Throwing Errors from Actions

Actions can throw at any point. The error propagates up to the handler or to the framework's error boundary. Use descriptive error types so callers can react meaningfully.

```ts
export class InvoiceLimitExceededError extends Error {
  constructor(customerId: string) {
    super(`Customer ${customerId} has reached the maximum number of open invoices.`)
    this.name = 'InvoiceLimitExceededError'
  }
}

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  const openCount = await repo.countOpen({ customerId: dto.customerId })

  if (openCount >= 10) {
    throw new InvoiceLimitExceededError(dto.customerId)
  }

  // ...
})
```

Handle it in the handler:

```ts
import { InvoiceLimitExceededError } from '@modules/Billing/logic/actions/create-invoice.action'

export const createInvoiceHandler = defineHandler(async (ctx) => {
  try {
    const invoice = await createInvoice(parsed.data)
    return ctx.json({ invoice }, 201)
  } catch (err) {
    if (err instanceof InvoiceLimitExceededError) {
      return ctx.json({ message: err.message }, 422)
    }
    throw err
  }
})
```

<a name="idempotent-actions"></a>
## Idempotent Actions

Mark an action as idempotent when calling it multiple times with the same input should produce the same result without side effects being repeated. This is especially relevant for payment processing and email sending.

```ts
export const chargeCustomer = defineAction(
  async (dto: ChargeCustomerDto) => {
    // ... call payment gateway
  },
  {
    idempotent: true,
  },
)
```

You can also specify a custom key derivation and time-to-live:

```ts
export const chargeCustomer = defineAction(
  async (dto: ChargeCustomerDto) => {
    // ...
  },
  {
    idempotent: {
      key: (dto) => `charge:${dto.customerId}:${dto.amountCents}`,
      ttl: 3600, // seconds
    },
  },
)
```

The `ActionMetadata` type is exported from `@lumiarq/framework` if you want to type the options separately:

```ts
import type { ActionMetadata } from '@lumiarq/framework'

const metadata: ActionMetadata = {
  idempotent: { key: (dto) => `charge:${dto.customerId}`, ttl: 3600 },
}

export const chargeCustomer = defineAction(async (dto: ChargeCustomerDto) => {
  // ...
}, metadata)
```

<a name="emitting-domain-events"></a>
## Emitting Domain Events

Actions are the canonical place to emit domain events. Events notify other parts of the system that something meaningful occurred without creating direct dependencies.

```ts
import { EventBus } from '@lumiarq/framework'
import { PaymentSucceededEvent } from '@modules/Billing/contracts'

export const chargeCustomer = defineAction(async (dto: ChargeCustomerDto) => {
  const charge = await paymentGateway.charge(dto)

  EventBus.dispatch(PaymentSucceededEvent, {
    customerId: dto.customerId,
    amountCents: charge.amountCents,
    chargeId: charge.id,
  })

  return charge
})
```

`EventBus.dispatch` is fire-and-forget. If you need to await listener completion, use tasks queued through `QueueContract` instead.

<a name="testing-an-action"></a>
## Testing an Action

Generated test stubs use `withTestContext`, which wraps the test in an automatically rolled-back database transaction:

```ts
// src/modules/Billing/tests/create-invoice.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/framework'
import { createInvoice } from '@modules/Billing/logic/actions/create-invoice.action'

describe('createInvoice', () => {
  it(
    'creates an invoice and emits InvoiceCreatedEvent',
    withTestContext({}, async () => {
      const result = await createInvoice({
        customerId: 'cust_123',
        lineItems: [{ description: 'Consulting', quantity: 1, unitCents: 10000 }],
        dueDateIso: '2026-04-01',
      })

      expect(result.id).toBeDefined()
      expect(result.totalCents).toBe(10000)
      expect(result.status).toBe('draft')
    }),
  )
})
```

<a name="database-transactions"></a>
## Database Transactions

When an action performs multiple writes that must succeed or fail together, wrap them in a database transaction using `db.transaction()`. If any operation inside the transaction throws, all writes are rolled back automatically:

```ts
// src/modules/Billing/logic/actions/settle-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import { db } from '@bootstrap/providers'
import { invoices, payments, ledgerEntries } from '@modules/Billing/infrastructure/schema'
import { eq } from 'drizzle-orm'

export const settleInvoice = defineAction(
  async ({ invoiceId, paymentMethod }: SettleInvoiceDto) => {
    return db.transaction(async (tx) => {
      // 1. Mark the invoice as paid
      const [invoice] = await tx
        .update(invoices)
        .set({ status: 'paid', paidAt: new Date() })
        .where(eq(invoices.id, invoiceId))
        .returning()

      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`)
      }

      // 2. Record the payment
      const [payment] = await tx
        .insert(payments)
        .values({
          invoiceId:     invoice.id,
          amountCents:   invoice.totalCents,
          method:        paymentMethod,
          processedAt:   new Date(),
        })
        .returning()

      // 3. Write a ledger entry
      await tx.insert(ledgerEntries).values({
        reference:   payment.id,
        type:        'credit',
        amountCents: invoice.totalCents,
        recordedAt:  new Date(),
      })

      // If *any* of the three inserts throws, all three are rolled back
      return { invoice, payment }
    })
  },
)
```

The `tx` object passed to the callback is a Drizzle transaction client — it has the same query API as `db` but all queries execute within the transaction scope.

> **Rule of thumb:** Any action that writes to more than one table should use a transaction.

<a name="composing-actions"></a>
## Composing Actions

Actions can call other actions, but the dependency should flow in one direction: a higher-level action can call lower-level actions; the reverse should not happen. Keep compositions shallow — a maximum of two levels avoids confusing call graphs.

```ts
// src/modules/Billing/logic/actions/finalize-order.action.ts
import { defineAction } from '@lumiarq/framework'
import { createInvoice }   from '@modules/Billing/logic/actions/create-invoice.action'
import { chargeCustomer }  from '@modules/Billing/logic/actions/charge-customer.action'
import { settleInvoice }   from '@modules/Billing/logic/actions/settle-invoice.action'

export const finalizeOrder = defineAction(async (dto: FinalizeOrderDto) => {
  // 1. Create the invoice (draft)
  const invoice = await createInvoice({
    customerId: dto.customerId,
    lineItems:  dto.lineItems,
    dueDateIso: dto.dueDateIso,
  })

  // 2. Charge the customer
  const charge = await chargeCustomer({
    customerId:    dto.customerId,
    amountCents:   invoice.totalCents,
    paymentMethod: dto.paymentMethod,
  })

  // 3. Mark invoice as paid
  const { payment } = await settleInvoice({
    invoiceId:     invoice.id,
    paymentMethod: dto.paymentMethod,
  })

  return { invoice, charge, payment }
})
```

Each step is already tested independently. The composition test only needs to verify the orchestration:

```ts
describe('finalizeOrder', () => {
  it('creates an invoice, charges the customer, and settles the invoice', withTestContext({}, async () => {
    const result = await finalizeOrder({
      customerId:    'cust_123',
      lineItems:     [{ description: 'SaaS subscription', quantity: 1, unitCents: 4900 }],
      dueDateIso:    '2026-06-01',
      paymentMethod: 'card',
    })

    expect(result.invoice.status).toBe('paid')
    expect(result.payment).toBeDefined()
  }))
})
```

---

**Next:** Learn about managing cross-cutting concerns with [Middleware](/docs/middleware).
