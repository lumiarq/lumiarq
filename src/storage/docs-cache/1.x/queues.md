---
title: Queues
description: Deferring work with job queues
section: Digging Deeper
order: 12
draft: false
---

# Queues

- [Introduction](#introduction)
- [Queue Configuration](#queue-configuration)
- [BullMQ Driver](#bullmq-driver)
- [Processing Jobs](#processing-jobs)
- [Registering the Queue in Providers](#registering-the-queue-in-providers)
- [Dispatching Jobs](#dispatching-jobs)
- [The QueueContract Interface](#the-queuecontract-interface)
- [Scheduled Jobs with the Scheduler](#scheduled-jobs-with-the-scheduler)
- [Inspecting Registered Jobs](#inspecting-registered-jobs)
- [Testing Queued Actions](#testing-queued-actions)
- [Handling Task Failures](#handling-task-failures)
- [Dead Letter Pattern](#dead-letter-pattern)

<a name="introduction"></a>

Queues let you defer time-consuming or non-critical work to run outside of the HTTP request lifecycle. Lumiarq exposes queue functionality through `QueueContract` from `@lumiarq/contracts`, keeping your handlers fast and your application resilient.

<a name="queue-configuration"></a>
## Queue Configuration

Queue settings live in `config/queue.ts`. Scaffold it with:

```bash
pnpm lumis publish config queue
```

The generated stub:

```typescript
// config/queue.ts
import { env } from '../bootstrap/env.js';

const queue = {
  driver: env.QUEUE_DRIVER ?? 'sync',
  bullmq: {
    connection: {
      host: env.REDIS_HOST ?? '127.0.0.1',
      port: Number(env.REDIS_PORT ?? 6379),
      password: env.REDIS_PASSWORD,
    },
  },
  defaultQueue: env.QUEUE_DEFAULT ?? 'default',
} as const;

export default queue;
```

The `driver` field controls the backend. Use `'sync'` locally — jobs run immediately in the same process without a Redis connection. Switch to `'bullmq'` in staging and production.

<a name="bullmq-driver"></a>
## BullMQ Driver

`BullMQQueue` from `@lumiarq/framework/runtime` implements `QueueContract` using [BullMQ](https://docs.bullmq.io/) and `ioredis`. It uses a lazy dynamic import so neither package is loaded until the BullMQ driver is active.

**Install dependencies:**

```bash
pnpm add bullmq ioredis
```

**Constructor:**

```typescript
import { BullMQQueue } from '@lumiarq/framework/runtime'

const queue = new BullMQQueue({
  connection: {
    host: '127.0.0.1',
    port: 6379,
    password: undefined,  // optional
  },
  defaultQueue: 'default',  // optional, defaults to 'default'
})
```

**Dispatching with options:**

`queue.dispatch(jobName, data, options?)` accepts per-job options as a third argument:

```typescript
await queue.dispatch('send-welcome-email', { userId: '42' }, {
  queue: 'emails',       // target a named queue (defaults to defaultQueue)
  delay: 5000,           // ms delay before the job becomes active
  attempts: 3,           // max retry attempts
  backoff: { type: 'exponential', delay: 1000 },
})
```

**Registering in `bootstrap/providers.ts`:**

```typescript
// bootstrap/providers.ts
import { BullMQQueue } from '@lumiarq/framework/runtime'
import queueConfig from '../config/queue.js'

export let queue: BullMQQueue

export async function bootProviders() {
  queue = new BullMQQueue({
    connection: queueConfig.bullmq.connection,
    defaultQueue: queueConfig.defaultQueue,
  })
}
```

<a name="processing-jobs"></a>
## Processing Jobs

Dispatching a job adds it to a Redis list. A **separate worker process** consumes jobs from that list and runs them. The HTTP server and worker process are independent — both can scale independently.

Start the worker locally:

```bash
pnpm lumis worker:start --dev
```

In production, the compiled worker bundle is started with:

```bash
pnpm lumis worker:start
```

The worker entrypoint lives in `bootstrap/worker.ts`. It registers BullMQ workers for each queue and starts the CronScheduler. See the [Workers](/docs/workers) documentation for the full setup, graceful shutdown, and multi-queue configuration.

<a name="registering-the-queue-in-providers"></a>
## Registering the Queue in Providers

The queue client is instantiated once at boot time and exported from `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { createQueue } from '@lumiarq/framework'
import queueConfig from '@config/queue'
import { createMailer } from '@lumiarq/framework'
import mailConfig from '@config/mail'
import { createDb } from '@lumiarq/database'
import databaseConfig from '@config/database'

export const db = createDb(databaseConfig)
export const mailer = createMailer(mailConfig)
export const queue = createQueue(queueConfig)
```

<a name="dispatching-jobs"></a>
## Dispatching Jobs

The ESLint rule `no-queue-outside-logic` prevents `queue.dispatch()` and `queue.later()` from being called outside of `logic/actions/` or `logic/tasks/`. This keeps dispatch decisions inside the business logic layer, away from HTTP handlers.

### Immediate Dispatch

Use `queue.dispatch(action, payload)` to push a job to the queue for immediate processing by a worker:

```typescript
// src/modules/Billing/logic/actions/create-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import { db, queue } from '@bootstrap/providers'
import { GenerateInvoicePdfTask } from '@modules/Billing/logic/tasks/generate-invoice-pdf.task'
import { invoices } from '@modules/Billing/infrastructure/schema'

interface CreateInvoicePayload {
  userId: string
  lineItems: Array<{ description: string; amount: number }>
}

export const CreateInvoiceAction = defineAction(async (payload: CreateInvoicePayload) => {
  const [invoice] = await db
    .insert(invoices)
    .values({
      userId: payload.userId,
      status: 'pending',
      total: payload.lineItems.reduce((sum, item) => sum + item.amount, 0),
    })
    .returning()

  // PDF generation is expensive — dispatch it to a worker
  await queue.dispatch(GenerateInvoicePdfTask, { invoiceId: invoice.id })

  return invoice
})
```

### Delayed Dispatch

Use `queue.later(action, payload, delayMs)` to schedule a job for future execution. The third argument is the delay in milliseconds:

```typescript
// src/modules/Billing/logic/tasks/send-invoice-reminder.task.ts
import { defineTask } from '@lumiarq/framework'
import { mailer } from '@bootstrap/providers'

export const SendInvoiceReminderTask = defineTask(
  async ({ invoiceId, email }: { invoiceId: string; email: string }) => {
    await mailer.send({
      to: email,
      subject: 'Your invoice is due soon',
      html: `<p>Invoice <strong>${invoiceId}</strong> is due in 3 days.</p>`,
      text: `Invoice ${invoiceId} is due in 3 days.`,
    })
  }
)
```

```typescript
// src/modules/Billing/logic/actions/create-invoice.action.ts (continued)
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

// Send a reminder 3 days before the due date
await queue.later(SendInvoiceReminderTask, { invoiceId: invoice.id, email: payload.userEmail }, THREE_DAYS_MS)
```

<a name="the-queuecontract-interface"></a>
## The QueueContract Interface

```typescript
import type { QueueContract } from '@lumiarq/contracts'

interface QueueContract {
  // Push a job for immediate processing
  dispatch<TPayload>(action: TaskDefinition<TPayload>, payload: TPayload): Promise<void>

  // Push a job to run after a delay (milliseconds)
  later<TPayload>(
    action: TaskDefinition<TPayload>,
    payload: TPayload,
    delayMs: number
  ): Promise<void>
}
```

<a name="scheduled-jobs-with-the-scheduler"></a>
## Scheduled Jobs with the Scheduler

For recurring work (cron jobs), use `bootstrap/schedule.ts` rather than a queue. The scheduler uses `schedule.call(action, cronExpression, opts?)` to register jobs that run on a timer:

```typescript
// bootstrap/schedule.ts
import { schedule } from '@lumiarq/runtime'
import { GenerateDailyReportTask } from '@modules/Reporting/logic/tasks/generate-daily-report.task'
import { PruneExpiredSessionsTask } from '@modules/Auth/logic/tasks/prune-expired-sessions.task'
import { SyncInventoryTask } from '@modules/Inventory/logic/tasks/sync-inventory.task'

// Run at midnight every day
schedule.call(GenerateDailyReportTask, '0 0 * * *')

// Prune expired sessions every hour
schedule.call(PruneExpiredSessionsTask, '0 * * * *')

// Sync inventory every 15 minutes, starting jobs sequentially
schedule.call(SyncInventoryTask, '*/15 * * * *', { overlap: false })
```

The `StubScheduler` used in development registers jobs in memory and runs them in-process on their cron schedule. In production you would pair this with a cron trigger or a dedicated scheduler worker.

<a name="inspecting-registered-jobs"></a>
## Inspecting Registered Jobs

You can read all registered scheduled jobs at runtime via `schedule.jobs()`:

```typescript
import { schedule } from '@lumiarq/runtime'

const jobs = schedule.jobs()
// => [{ action: GenerateDailyReportTask, cron: '0 0 * * *', opts: {} }, ...]
```

This is useful for building admin dashboards or health-check endpoints that report on scheduler state.

<a name="testing-queued-actions"></a>
## Testing Queued Actions

When the queue driver is `'sync'`, dispatched jobs execute immediately in the same process. This makes test assertions straightforward — you can verify side effects without a real queue worker:

```typescript
// src/modules/Billing/tests/create-invoice.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'
import { CreateInvoiceAction } from '@modules/Billing/logic/actions/create-invoice.action'

describe('CreateInvoiceAction', () => {
  it(
    'creates an invoice and dispatches PDF generation',
    withTestContext({}, async () => {
      const invoice = await CreateInvoiceAction({
        userId: 'user-123',
        lineItems: [{ description: 'Consulting', amount: 5000 }],
      })

      expect(invoice.id).toBeDefined()
      expect(invoice.status).toBe('pending')
      expect(invoice.total).toBe(5000)
    })
  )
})
```

For unit-level tests where you want to assert that `queue.dispatch` was called without running the task, mock `@bootstrap/providers` in the same way as the mailer (see [Mail testing](/docs/mail)).

<a name="handling-task-failures"></a>
## Handling Task Failures

When a task throws an unhandled error, the queue driver retries it according to the `attempts` and `backoff` options in `config/queue.ts`. Configure these per queue:

```typescript
// config/queue.ts
import { env } from '@/bootstrap/env'

export default {
  driver: env.QUEUE_DRIVER ?? 'sync',
  queues: {
    default: {
      concurrency:  5,
      attempts:     3,          // retry up to 3 times
      backoff:      { type: 'exponential', delay: 1000 }, // ms between retries
    },
    emails: {
      concurrency:  2,
      attempts:     5,
      backoff:      { type: 'fixed', delay: 30_000 },     // 30 s between retries
    },
    reports: {
      concurrency:  1,
      attempts:     1,           // no retries for long-running reports
    },
  },
} satisfies QueueConfig
```

`backoff.type` can be `'fixed'` (same delay every retry) or `'exponential'` (delay doubles each attempt).

**Making tasks idempotent:** Tasks can be retried, so they must be idempotent — running the same task twice with the same payload must produce the same result. The safest approach is to check before acting:

```typescript
export const GenerateInvoicePdfTask = defineTask(
  async ({ invoiceId }: { invoiceId: string }) => {
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
    })

    // Already generated — skip
    if (!invoice || invoice.pdfUrl) return

    const pdfBuffer = await generatePdf(invoice)
    const url       = await uploadToStorage(pdfBuffer, `invoices/${invoiceId}.pdf`)

    await db.update(invoices)
      .set({ pdfUrl: url })
      .where(eq(invoices.id, invoiceId))
  }
)
```

<a name="dead-letter-pattern"></a>
## Dead Letter Pattern

When a task exhausts all retry attempts, the job is considered "dead". Rather than silently discarding it, implement a dead-letter handler that persists the failure for ops review:

```typescript
// src/modules/Queue/logic/tasks/capture-dead-letter.task.ts
import { defineTask } from '@lumiarq/framework'
import { db } from '@bootstrap/providers'
import { deadLetterJobs } from '@modules/Queue/infrastructure/schema'

interface DeadLetterPayload {
  taskName:    string
  payload:     unknown
  errorMessage: string
  failedAt:    string
}

export const CaptureDeadLetterTask = defineTask(async (data: DeadLetterPayload) => {
  await db.insert(deadLetterJobs).values({
    taskName:     data.taskName,
    payload:      JSON.stringify(data.payload),
    errorMessage: data.errorMessage,
    failedAt:     new Date(data.failedAt),
  })
})
```

Register `CaptureDeadLetterTask` as the `onFailed` handler in `bootstrap/schedule.ts` or in the queue configuration:

```typescript
// bootstrap/queue.ts  (application entry point for the queue worker)
import { workerPool } from '@lumiarq/runtime'
import { CaptureDeadLetterTask } from '@modules/Queue/logic/tasks/capture-dead-letter.task'

workerPool.onFailed(async (job) => {
  await CaptureDeadLetterTask.run({
    taskName:     job.taskName,
    payload:      job.payload,
    errorMessage: job.error.message,
    failedAt:     new Date().toISOString(),
  })
})
```

You can then build an admin endpoint to list and replay dead-letter jobs:

```typescript
// Re-dispatch a dead-letter job from an admin handler
const row = await db.query.deadLetterJobs.findFirst({ where: eq(deadLetterJobs.id, jobId) })

await queue.dispatch(taskRegistry[row.taskName], JSON.parse(row.payload))
await db.delete(deadLetterJobs).where(eq(deadLetterJobs.id, jobId))
```

---

**Next:** Learn about dependency management with the [Service Container](/docs/service-container).
