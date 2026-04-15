---
title: Contracts
description: Service contracts and interface-driven development in Lumiarq
section: Architecture Concepts
order: 5
draft: false
---

# Contracts

- [Introduction](#introduction)
- [The Contracts Package](#the-contracts-package)
- [Available Contracts](#available-contracts)
- [Importing Contracts](#importing-contracts)
- [MailerContract](#mailercontract)
- [QueueContract](#queuecontract)
- [CacheContract](#cachecontract)
- [StorageContract](#storagecontract)
- [EventBusContract](#eventbuscontract)
- [LoggerContract](#loggercontract)
- [NotificationContract](#notificationcontract)
- [SchedulerContract](#schedulercontract)
- [Swapping Implementations](#swapping-implementations)
- [Test Doubles](#test-doubles)

<a name="introduction"></a>
## Introduction

LumiARQ defines all core infrastructure capabilities — mail, queues, storage, cache, event bus, logging, notifications, and scheduling — as TypeScript interfaces in a separate, zero-dependency package. Application code depends on these **contracts**, never on concrete driver implementations.

This keeps every module decoupled from infrastructure choices. Swapping from SMTP to an SES driver, or from a Redis queue to an in-memory queue for tests, requires changing one provider registration — not searching for every call site.

<a name="the-contracts-package"></a>
## The Contracts Package

Contracts live in `@lumiarq/contracts`, a zero-dependency package containing only TypeScript interfaces. It is a dependency of `@lumiarq/framework`, which re-exports everything under a single import path.

You always import from `@lumiarq/framework`, not directly from `@lumiarq/contracts`:

```ts
import type {
  MailerContract,
  QueueContract,
  CacheContract,
  StorageContract,
  EventBusContract,
  LoggerContract,
  NotificationContract,
  SchedulerContract,
} from '@lumiarq/framework'
```

<a name="available-contracts"></a>
## Available Contracts

| Contract | Accessor | Responsibility |
|---|---|---|
| `MailerContract` | `Mailer` | Send and queue transactional email |
| `QueueContract` | `Queue` | Dispatch background jobs |
| `CacheContract` | `Cache` | Key-value store with TTL |
| `StorageContract` | `Storage` | File storage (disk, S3, R2, etc.) |
| `EventBusContract` | `EventBus` | In-process domain event bus |
| `LoggerContract` | `Logger` | Structured application logging |
| `NotificationContract` | `Notifier` | Send notifications via multiple channels |
| `SchedulerContract` | `Scheduler` | Register and run scheduled jobs |

<a name="importing-contracts"></a>
## Importing Contracts

Framework-provided singleton accessors are exported from `@lumiarq/framework`. These resolve to the concrete implementation registered in `bootstrap/providers.ts`.

```ts
import { Mailer, Queue, Cache, Storage, EventBus, Logger } from '@lumiarq/framework'

// Use the accessor directly
await Mailer.send({ to: 'user@example.com', subject: 'Hi', template: 'welcome', payload: {} })
await Queue.dispatch({ name: 'ProcessOrder', data: { orderId: 'ord_1' } })
const value = await Cache.get<string>('session:user_42')
```

When you need the contract type for a function parameter or class field, import the interface:

```ts
import type { MailerContract } from '@lumiarq/framework'

export class InvoiceService {
  constructor(private readonly mailer: MailerContract) {}

  async sendReceipt(email: string) {
    await this.mailer.send({
      to: email,
      subject: 'Your receipt',
      template: 'receipt',
      payload: {},
    })
  }
}
```

<a name="mailercontract"></a>
## MailerContract

```ts
interface MailMessage {
  to: string | string[]
  subject: string
  template: string
  payload: Record<string, unknown>
  from?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
}

interface MailerContract {
  /** Send immediately — awaits delivery confirmation. */
  send(message: MailMessage): Promise<void>
  /** Push to the mail queue — returns as soon as the job is queued. */
  queue(message: MailMessage): Promise<void>
}
```

Use `send` when you need delivery confirmation before proceeding. Use `queue` for fire-and-forget communication.

```ts
// src/modules/Billing/logic/tasks/send-invoice-email.task.ts
import { defineTask } from '@lumiarq/framework'
import { Mailer } from '@lumiarq/framework'

export const sendInvoiceEmailTask = defineTask(async ({ invoiceId, email }: {
  invoiceId: string
  email: string
}) => {
  await Mailer.queue({
    to: email,
    subject: 'Your invoice is ready',
    template: 'invoice-ready',
    payload: { invoiceId },
  })
})
```

<a name="queuecontract"></a>
## QueueContract

```ts
interface JobPayload {
  name: string
  data: Record<string, unknown>
}

interface DispatchOptions {
  delay?: number       // Seconds to wait before processing
  queue?: string       // Named queue (default: 'default')
  tries?: number       // Maximum retry attempts
  backoff?: number     // Seconds between retries
}

interface QueueContract {
  dispatch(job: JobPayload, options?: DispatchOptions): Promise<void>
  later(job: JobPayload, seconds: number, options?: Omit<DispatchOptions, 'delay'>): Promise<void>
}
```

```ts
import { Queue } from '@lumiarq/framework'

// Dispatch immediately
await Queue.dispatch({
  name: 'ProcessPayment',
  data: { orderId: 'ord_42', amount: 4999 },
})

// Dispatch with a 5-minute delay
await Queue.later(
  { name: 'SendFollowUpEmail', data: { userId: 'user_1' } },
  300,
)

// Dispatch to a specific queue with retry policy
await Queue.dispatch(
  { name: 'GenerateReport', data: { reportId: 'rep_7' } },
  { queue: 'reports', tries: 5, backoff: 60 },
)
```

<a name="cachecontract"></a>
## CacheContract

```ts
interface CacheContract {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  forget(key: string): Promise<void>
  remember<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T>
}
```

`remember` is the most useful method — it returns the cached value if present, or executes `fn`, stores the result, and returns it:

```ts
import { Cache } from '@lumiarq/framework'

export const getUserProfile = defineQuery(async ({ userId }: { userId: string }) => {
  return Cache.remember(
    `profile:${userId}`,
    300, // 5 minutes
    () => db.select().from(users).where(eq(users.id, userId)).then(rows => rows[0] ?? null),
  )
})
```

<a name="storagecontract"></a>
## StorageContract

```ts
interface PutOptions {
  visibility?: 'public' | 'private'
  metadata?: Record<string, string>
  contentType?: string
}

interface StoredFile {
  path: string
  url: string
  size: number
  mimeType: string
  metadata?: Record<string, string>
}

interface StorageContract {
  put(path: string, file: Buffer | ReadableStream, options?: PutOptions): Promise<StoredFile>
  get(path: string): Promise<Buffer | null>
  delete(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  url(path: string): string
  temporaryUrl(path: string, expiry: Date): Promise<string>
}
```

```ts
import { Storage } from '@lumiarq/framework'

export const uploadAvatarTask = defineTask(async ({ userId, file }: {
  userId: string
  file: Buffer
}) => {
  const stored = await Storage.put(
    `avatars/${userId}.jpg`,
    file,
    { visibility: 'public', contentType: 'image/jpeg' },
  )

  return stored.url
})
```

<a name="eventbuscontract"></a>
## EventBusContract

```ts
interface EventBusContract {
  emit(event: unknown, payload: unknown): void
  dispatch(event: unknown, payload: unknown): void
  listen(event: unknown, handler: unknown, options?: { idempotent?: boolean }): void
  clearListeners(): void
}
```

`dispatch` and `emit` are aliases — both fire the event synchronously to all registered listeners.

```ts
import { EventBus } from '@lumiarq/framework'

// Emit an event (in an action)
EventBus.dispatch(InvoiceCreatedEvent, {
  invoiceId: invoice.id,
  customerId: invoice.customerId,
})

// Register a listener (in bootstrap/listeners.ts)
EventBus.listen(InvoiceCreatedEvent, async (payload: InvoiceCreatedEventPayload) => {
  await Queue.dispatch({ name: 'NotifyAccountant', data: { invoiceId: payload.invoiceId } })
})
```

<a name="loggercontract"></a>
## LoggerContract

```ts
interface LoggerContract {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}
```

The `Logger` accessor is the application-level logger (registered in `bootstrap/providers.ts`). For request-scoped logs tagged with `contextId`, prefer `getContext().logger` instead.

```ts
import { Logger } from '@lumiarq/framework'
import { getContext } from '@lumiarq/framework'

// Application logger (not request-scoped)
Logger.info('Application booted', { env: process.env.NODE_ENV })

// Request-scoped logger (preferred inside handlers/actions/tasks)
const { logger } = getContext()
logger.info('Processing payment', { orderId: 'ord_42' })
```

<a name="notificationcontract"></a>
## NotificationContract

```ts
interface Notifiable {
  id: string
  email?: string
}

interface NotificationContract {
  send(notifiable: Notifiable, notification: unknown): Promise<void>
  queue(notifiable: Notifiable, notification: unknown): Promise<void>
}
```

```ts
import { Notifier } from '@lumiarq/framework'
import { InvoicePaidNotification } from '@modules/Billing/contracts'

export const markInvoicePaid = defineAction(async ({ invoiceId }: { invoiceId: string }) => {
  const invoice = await repo.markPaid(invoiceId)

  await Notifier.queue(
    { id: invoice.customerId, email: invoice.customerEmail },
    new InvoicePaidNotification({ invoice }),
  )

  return invoice
})
```

<a name="schedulercontract"></a>
## SchedulerContract

```ts
interface SchedulerContract {
  call(action: unknown, cron: CronExpression, options?: ScheduleOptions): void
  jobs(): ScheduledJob[]
  due(now?: Date): ScheduledJob[]
}

interface ScheduleOptions {
  timezone?: string
  runInBackground?: boolean
  description?: string
}
```

Register scheduled jobs in a module's `bootstrap/schedule.ts`:

```ts
import { Scheduler } from '@lumiarq/framework'
import { generateMonthlyReport } from '@modules/Reporting/logic/actions/generate-monthly-report.action'
import { pruneExpiredSessions } from '@modules/Auth/logic/actions/prune-expired-sessions.action'

// Run on the first day of every month at midnight UTC
Scheduler.call(generateMonthlyReport, '0 0 1 * *', {
  timezone: 'UTC',
  description: 'Generate monthly billing report',
})

// Run every hour
Scheduler.call(pruneExpiredSessions, '0 * * * *', {
  runInBackground: true,
})
```

Run all due jobs manually with the CLI:

```bash
pnpm lumis schedule:run
```

<a name="swapping-implementations"></a>
## Swapping Implementations

Provider registrations live in `bootstrap/providers.ts`. Swapping one implementation for another is a single-line change.

```ts
// bootstrap/providers.ts
import { registerProvider } from '@lumiarq/framework'
import { NodeMailerProvider } from '@lumiarq/mailer-nodemailer'
import { SesMailerProvider } from '@lumiarq/mailer-ses'
import { RedisQueueProvider } from '@lumiarq/queue-redis'
import { StubQueueProvider } from '@lumiarq/queue-stub'

// Swap SMTP → SES based on environment
const MailProvider = process.env.MAIL_DRIVER === 'ses'
  ? new SesMailerProvider({ region: process.env.AWS_REGION! })
  : new NodeMailerProvider({ host: process.env.SMTP_HOST! })

registerProvider('mailer', MailProvider)

// Use real Redis in production, stub in development
const QueueProvider = process.env.NODE_ENV === 'production'
  ? new RedisQueueProvider({ url: process.env.REDIS_URL! })
  : new StubQueueProvider()

registerProvider('queue', QueueProvider)
```

Because every call site uses the contract (not the concrete class), the rest of the application is unaffected.

<a name="test-doubles"></a>
## Test Doubles

For unit tests you rarely want to send real emails or enqueue real jobs. LumiARQ's stub providers capture calls without performing side effects.

```ts
import { StubMailer } from '@lumiarq/framework/testing'
import { registerProvider } from '@lumiarq/framework'

beforeEach(() => {
  registerProvider('mailer', new StubMailer())
})

test('sends an invoice email after creation', async () => {
  const mailer = new StubMailer()
  registerProvider('mailer', mailer)

  await withTestContext(async () => {
    await createInvoice({
      customerId: 'cust_1',
      lineItems: [{ description: 'Design', quantity: 1, unitCents: 20000 }],
      dueDateIso: '2025-12-31',
    })
  })

  expect(mailer.sent).toHaveLength(1)
  expect(mailer.sent[0].to).toBe('billing@example.com')
  expect(mailer.sent[0].template).toBe('invoice-ready')
})
```

You can also implement a contract inline for highly specific test scenarios:

```ts
const capturedJobs: JobPayload[] = []

const testQueue: QueueContract = {
  async dispatch(job) { capturedJobs.push(job) },
  async later(job)   { capturedJobs.push(job) },
}

registerProvider('queue', testQueue)
```

Because application code depends only on the interface, any object matching the contract shape works as a test double.
