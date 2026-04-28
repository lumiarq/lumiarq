---
title: Events
description: Broadcasting and listening to domain events
section: Digging Deeper
order: 5
draft: false
---

# Events

- [Introduction](#introduction)
- [EventBus](#eventbus)
- [Dispatching Events](#dispatching-events)
- [Event Schemas](#event-schemas)
- [Scaffolding Events and Listeners](#scaffolding-events-and-listeners)
- [Registering Listeners](#registering-listeners)
- [Writing a Listener](#writing-a-listener)
- [EventEnvelope](#eventenvelope)
- [Sync Emit](#sync-emit)
- [Events in Tests](#events-in-tests)
- [Cross-module Event Communication](#cross-module-event-communication)
- [Queued Event Listeners](#queued-event-listeners)
- [Wildcard Listeners](#wildcard-listeners)

<a name="introduction"></a>
## Introduction

Events let different parts of your application communicate without creating direct dependencies between them. When an invoice is paid, the billing module dispatches an `InvoicePaid` event. The notification module listens for it and sends a receipt. Neither module knows the other exists.

<a name="eventbus"></a>
## EventBus

Import `EventBus` from `@lumiarq/framework`:

```typescript
import { EventBus } from '@lumiarq/framework'
```

`EventBus` has two dispatch methods with different semantics:

| Method | Behaviour |
|--------|-----------|
| `EventBus.dispatch(name, payload)` | Async, fire-and-forget. Returns `Promise<void>`. |
| `EventBus.emit(name, payload)` | Synchronous. Executes all listeners inline. |

Use `dispatch` for side effects that should not block the current request (sending emails, updating external systems, logging audit trails). Use `emit` when you need the listeners to complete before continuing — for example, in tests.

<a name="dispatching-events"></a>
## Dispatching Events

Call `EventBus.dispatch` anywhere in your logic layer after a meaningful state change:

```typescript
// src/modules/Billing/logic/actions/mark-invoice-paid.action.ts
import { defineAction } from '@lumiarq/framework'
import { EventBus } from '@lumiarq/framework'
import { InvoiceRepository } from '../../data/repositories/invoice.repository'

export const MarkInvoicePaidAction = defineAction(async (invoiceId: string) => {
  const invoice = await InvoiceRepository.update(invoiceId, { status: 'paid' })

  await EventBus.dispatch('invoice.paid', {
    invoiceId: invoice.id,
    userId: invoice.userId,
    amount: invoice.amount,
    currency: invoice.currency,
    paidAt: new Date().toISOString(),
  })

  return invoice
})
```

`dispatch` is fire-and-forget. The action returns without waiting for listeners to complete. If a listener throws, the error is logged but does not propagate back to the caller.

<a name="event-schemas"></a>
## Event Schemas

Define event payloads with Zod schemas. This gives you type safety in both the dispatch call and the listener function:

```typescript
// src/modules/Billing/contracts/events/invoice-paid.event.ts
import { z } from 'zod'

export const InvoicePaidSchema = z.object({
  invoiceId: z.string(),
  userId:    z.string(),
  amount:    z.number(),
  currency:  z.string(),
  paidAt:    z.string().datetime(),
})

export type InvoicePaidPayload = z.infer<typeof InvoicePaidSchema>
```

<a name="scaffolding-events-and-listeners"></a>
## Scaffolding Events and Listeners

Generate an event schema stub:

```bash
pnpm lumis make:event Billing InvoicePaid
```

This creates `src/modules/Billing/contracts/events/invoice-paid.event.ts` with a Zod schema stub:

```typescript
import { z } from 'zod'

export const InvoicePaidSchema = z.object({
  // TODO: add event payload fields
})
```

Generate a listener:

```bash
pnpm lumis make:listener Notifications InvoicePaid
```

This creates `src/modules/Notifications/logic/listeners/invoice-paid.listener.ts`.

<a name="registering-listeners"></a>
## Registering Listeners

Listeners are registered in `bootstrap/events.ts`. This file is the single authoritative record of which modules react to which events:

```typescript
// bootstrap/events.ts
import { EventBus } from '@lumiarq/framework'
import { InvoicePaidSchema } from '@modules/Billing/contracts/events/invoice-paid.event'
import { SendInvoiceReceiptListener } from '@modules/Notifications/logic/listeners/invoice-paid.listener'
import { UpdateRevenueStatsListener } from '@modules/Analytics/logic/listeners/invoice-paid.listener'
import { WriteAuditTrailListener } from '@modules/Audit/logic/listeners/invoice-paid.listener'

EventBus.on('invoice.paid', InvoicePaidSchema, SendInvoiceReceiptListener)
EventBus.on('invoice.paid', InvoicePaidSchema, UpdateRevenueStatsListener)
EventBus.on('invoice.paid', InvoicePaidSchema, WriteAuditTrailListener)
```

Multiple listeners can subscribe to the same event. They run in registration order.

<a name="writing-a-listener"></a>
## Writing a Listener

A listener is a function that matches the `ListenerFn<Schema>` signature. It receives the validated payload as the first argument and the full `EventEnvelope` as the second:

```typescript
// src/modules/Notifications/logic/listeners/invoice-paid.listener.ts
import type { ListenerFn } from '@lumiarq/framework'
import type { InvoicePaidSchema } from '@modules/Billing/contracts/events/invoice-paid.event'
import { SendReceiptEmailTask } from '../tasks/send-receipt-email.task'
import { logger } from '@bootstrap/providers'

export const SendInvoiceReceiptListener: ListenerFn<typeof InvoicePaidSchema> = async (
  payload,
  envelope,
) => {
  logger.info('Handling invoice.paid', {
    invoiceId: payload.invoiceId,
    idempotencyKey: envelope.idempotencyKey,
  })

  await SendReceiptEmailTask({
    userId: payload.userId,
    invoiceId: payload.invoiceId,
    amount: payload.amount,
    currency: payload.currency,
  })
}
```

### ListenerFn Signature

```typescript
type ListenerFn<S extends z.ZodTypeAny> = (
  payload: z.infer<S>,
  envelope: EventEnvelope<z.infer<S>>,
) => void | Promise<void>
```

The `payload` is already validated against the schema you registered. TypeScript knows its shape.

<a name="eventenvelope"></a>
## EventEnvelope

Every dispatched event is wrapped in an `EventEnvelope` before being delivered to listeners:

```typescript
interface EventEnvelope<T> {
  idempotencyKey: string   // SHA-256(eventName + stableStringify(payload))
  name: string             // Event name, e.g. 'invoice.paid'
  emittedAt: string        // ISO 8601 timestamp
  payload: T               // The validated payload
  signal: AbortSignal      // Cancellation signal (long-running listeners)
}
```

### Automatic Idempotency

The `idempotencyKey` is derived automatically by the `EventBus` as `SHA-256(name + stableStringify(payload))`. You never set it manually. The same event name and the same payload always produce the same key, which means:

- If you dispatch the same event twice with identical data, both envelopes have the same `idempotencyKey`
- Listeners can use this key to deduplicate — for example, when a webhook delivery retries

```typescript
export const SendInvoiceReceiptListener: ListenerFn<typeof InvoicePaidSchema> = async (
  payload,
  envelope,
) => {
  const alreadySent = await cache.get(`receipt:${envelope.idempotencyKey}`)
  if (alreadySent) return   // Skip duplicate delivery

  await SendReceiptEmailTask({ userId: payload.userId, invoiceId: payload.invoiceId })

  await cache.set(`receipt:${envelope.idempotencyKey}`, true, 86400)
}
```

You do not need to add an `idempotencyKey` field to your event schemas. The framework computes it from the data.

<a name="sync-emit"></a>
## Sync Emit

For cases where you need listener output before returning — typically inside tests — use `emit` instead of `dispatch`:

```typescript
EventBus.emit('user.registered', {
  userId: 'usr_001',
  email: 'alice@example.com',
})
// All listeners have completed synchronously at this point
```

`emit` blocks until all listeners return. Async listeners must be awaited manually if you use `emit` — the bus calls them but does not await them in sync mode. Prefer `dispatch` for production code.

<a name="events-in-tests"></a>
## Events in Tests

In tests, use `EventBus.emit` to confirm that an action dispatches the expected event, and register a capturing listener before the action runs:

```typescript
import { EventBus } from '@lumiarq/framework'
import { withTestContext } from '@lumiarq/runtime'
import { MarkInvoicePaidAction } from '@modules/Billing/logic/actions/mark-invoice-paid.action'
import { InvoicePaidSchema } from '@modules/Billing/contracts/events/invoice-paid.event'

it('dispatches invoice.paid after marking paid', withTestContext({}, async () => {
  const received: unknown[] = []

  EventBus.on('invoice.paid', InvoicePaidSchema, (payload) => {
    received.push(payload)
  })

  await MarkInvoicePaidAction('inv_001')

  expect(received).toHaveLength(1)
  expect(received[0]).toMatchObject({ invoiceId: 'inv_001' })
}))
```

<a name="cross-module-event-communication"></a>
## Cross-module Event Communication

Events are the preferred mechanism for one module to react to changes in another without creating a direct import dependency.
The dispatching module knows nothing about its listeners; the listening module knows only the event name and schema.

**Pattern:**
1. The dispatching module defines the event schema in its public `contracts/` directory.
2. The listening module imports the schema and registers a listener during its module boot.

```ts
// src/modules/Billing/contracts/events/invoice-paid.event.ts
import { z } from 'zod'

export const InvoicePaidSchema = z.object({
  invoiceId:   z.string(),
  userId:      z.string(),
  amountCents: z.number(),
  paidAt:      z.string(),
})
export type InvoicePaidPayload = z.infer<typeof InvoicePaidSchema>
```

```ts
// src/modules/Notifications/logic/listeners/on-invoice-paid.listener.ts
import { EventBus } from '@lumiarq/framework'
import { InvoicePaidSchema } from '@modules/Billing/contracts/events/invoice-paid.event'
import { sendInvoiceReceipt } from '@modules/Notifications/logic/tasks/send-invoice-receipt.task'

// Register at module boot — called once when the Notifications module is initialised
export function registerInvoicePaidListener() {
  EventBus.on('invoice.paid', InvoicePaidSchema, async (payload) => {
    await sendInvoiceReceipt({
      userId:      payload.userId,
      invoiceId:   payload.invoiceId,
      amountCents: payload.amountCents,
    })
  })
}
```

```ts
// src/modules/Notifications/notifications.module.ts
import { defineModule } from '@lumiarq/framework'
import { registerInvoicePaidListener } from './logic/listeners/on-invoice-paid.listener'

export default defineModule({
  name: 'Notifications',
  boot() {
    registerInvoicePaidListener()
  },
})
```

<a name="queued-event-listeners"></a>
## Queued Event Listeners

For long-running listener work (generating a PDF, calling a slow external API), dispatch the heavy lifting to the queue from
inside the listener rather than blocking the event bus:

```ts
EventBus.on('invoice.paid', InvoicePaidSchema, async (payload) => {
  // ✅ Enqueue the slow work — don't block the event bus
  const queue = app().make<QueueContract>('queue')
  await queue.dispatch(generateAndSendInvoicePdf, payload)
})
```

The listener returns immediately after dispatching, and the PDF generation runs asynchronously in a worker process.

<a name="wildcard-listeners"></a>
## Wildcard Listeners

Use a wildcard listener to capture all events from a namespace — useful for audit logging, metrics, or debugging:

```ts
// src/modules/Audit/logic/listeners/capture-all-events.listener.ts
import { EventBus } from '@lumiarq/framework'

export function registerAuditListener() {
  // '*' or a namespace prefix like 'invoice.*'
  EventBus.onAny((name, payload, envelope) => {
    console.log(`[Event] ${name}`, {
      idempotencyKey: envelope.idempotencyKey,
      occurredAt:     envelope.occurredAt,
      payload,
    })
  })
}
```

---

**Next:** Return to [Getting Started](/docs/getting-started) or explore the [CLI Reference](/docs/cli/overview) for a full command listing.
