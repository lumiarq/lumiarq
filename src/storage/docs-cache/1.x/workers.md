---
title: Workers
description: Running background workers with BullMQ and the bootstrap/worker.ts entrypoint
section: Digging Deeper
order: 13
draft: false
---

# Workers

## Table of Contents

- [Introduction](#introduction)
- [The Worker Entrypoint](#worker-entrypoint)
- [BullMQWorker](#bullmq-worker)
- [Registering Handlers](#registering-handlers)
- [Worker Lifecycle](#worker-lifecycle)
- [Running in Development](#running-dev)
- [Running in Production](#running-production)
- [Listing Workers](#listing-workers)
- [Multiple Queues](#multiple-queues)
- [Graceful Shutdown](#graceful-shutdown)
- [Retries and Dead Letter](#retries-dead-letter)
- [Full Example](#full-example)
- [Testing Workers](#testing-workers)

---

<a name="introduction"></a>
## Introduction

Long-running or CPU-intensive tasks — sending emails, generating PDFs, calling third-party APIs, resizing images — should not block your HTTP request cycle. LumiARQ separates these concerns cleanly: your HTTP server handles requests and immediately returns a response, while a **worker process** consumes jobs from a queue and executes them in the background.

LumiARQ's worker system is built on top of [BullMQ](https://docs.bullmq.io/), a battle-tested Node.js queue library backed by Redis. The framework provides a thin, ergonomic wrapper (`BullMQWorker`) that integrates with your application's bootstrap layer, handles graceful shutdown, and keeps all queue configuration in one place.

> **Why a separate process?**  
> Workers run outside the HTTP server process. This means a slow job cannot starve HTTP traffic, you can scale workers independently of your web tier, and a worker crash does not take down your API.

---

<a name="worker-entrypoint"></a>
## The Worker Entrypoint

The worker process is bootstrapped from `bootstrap/worker.ts`. This file is not created by default — generate it by publishing the queue config:

```bash
lumis publish config queue
```

This command creates two files:

- `config/queue.ts` — connection and queue configuration
- `bootstrap/worker.ts` — the worker process entrypoint

The generated `bootstrap/worker.ts` is intentionally minimal. You own this file; add your handlers and queues as your application grows.

---

<a name="bullmq-worker"></a>
## BullMQWorker

`BullMQWorker` is exported from `@lumiarq/framework/runtime`. It wraps BullMQ's `Worker` class with a friendlier interface that integrates with the rest of the framework.

```typescript
import { BullMQWorker } from '@lumiarq/framework/runtime'
```

### Constructor Options

```typescript
interface BullMQWorkerOptions {
  /** Redis connection options or an existing IORedis instance */
  connection: ConnectionOptions | IORedis

  /** Queue names this worker will consume from (default: ['default']) */
  queues?: string[]

  /** Job name → async handler map */
  handlers: Map<string, JobHandler>

  /** Max concurrent jobs processed at once per queue (default: 5) */
  concurrency?: number

  /** Optional logger instance (implements LoggerContract) */
  logger?: LoggerContract
}

type JobHandler = (name: string, data: unknown) => Promise<void>
```

**`connection`** accepts the same options as [ioredis](https://github.com/redis/ioredis): a plain options object `{ host, port, password }` or a pre-constructed `IORedis` instance. For most applications you will pass the same Redis connection used by your cache driver.

**`concurrency`** controls how many jobs are executed in parallel per queue. Increase this for I/O-bound jobs (e.g., sending emails); keep it low for CPU-bound jobs (e.g., image processing).

---

<a name="registering-handlers"></a>
## Registering Handlers

Handlers are registered as a `Map` from job name to async function. The job name is a string you choose — by convention, LumiARQ uses dot-namespaced names like `user.welcome`, `report.generate`, or `notification.send`.

```typescript
import { BullMQWorker } from '@lumiarq/framework/runtime'
import { env } from '@lumiarq/framework'

const worker = new BullMQWorker({
  connection: {
    host: env('REDIS_HOST', '127.0.0.1'),
    port: Number(env('REDIS_PORT', '6379')),
    password: env('REDIS_PASSWORD'),
  },
  queues: ['default'],
  handlers: new Map([
    ['user.welcome', async (name, data) => {
      // data is the payload you passed when dispatching the job
      const { userId } = data as { userId: string }
      await sendWelcomeEmail(userId)
    }],

    ['report.generate', async (name, data) => {
      const { reportId } = data as { reportId: string }
      await generateAndStoreReport(reportId)
    }],
  ]),
  concurrency: 10,
})
```

### Handler Shape

Every handler receives two arguments:

| Argument | Type | Description |
|----------|------|-------------|
| `name` | `string` | The job name (e.g. `'user.welcome'`) |
| `data` | `unknown` | The job payload, cast to your expected shape |

Handlers should be **async** and **throw** on failure — BullMQ uses thrown errors to determine whether to retry a job.

### Keeping Handlers Tidy

As your application grows, extract handlers into dedicated files:

```
src/
  jobs/
    handlers/
      userWelcomeHandler.ts
      reportGenerateHandler.ts
bootstrap/
  worker.ts
```

```typescript
// src/jobs/handlers/userWelcomeHandler.ts
import type { JobHandler } from '@lumiarq/framework/runtime'

export const userWelcomeHandler: JobHandler = async (name, data) => {
  const { userId } = data as { userId: string }
  await sendWelcomeEmail(userId)
}
```

```typescript
// bootstrap/worker.ts
import { userWelcomeHandler } from '#jobs/handlers/userWelcomeHandler'
import { reportGenerateHandler } from '#jobs/handlers/reportGenerateHandler'

const worker = new BullMQWorker({
  // ...
  handlers: new Map([
    ['user.welcome', userWelcomeHandler],
    ['report.generate', reportGenerateHandler],
  ]),
})
```

---

<a name="worker-lifecycle"></a>
## Worker Lifecycle

`BullMQWorker` exposes two lifecycle methods: `start()` and `stop()`.

```typescript
// Start consuming jobs
await worker.start()

// Gracefully drain and stop
await worker.stop()
```

`start()` opens the Redis connection and begins polling all registered queues. It is non-blocking — control returns immediately and jobs are processed in the background event loop.

`stop()` signals BullMQ to stop accepting new jobs, waits for in-flight jobs to complete (up to a configurable timeout), and then closes the Redis connection cleanly.

---

<a name="running-dev"></a>
## Running in Development

In development, start the worker with hot-reload support:

```bash
lumis worker:start --dev
```

This compiles your TypeScript source on-the-fly (via `tsx` / `ts-node`) and watches for file changes, restarting the worker process automatically. Logs are colorised and verbose by default.

You can tail worker logs alongside your dev server:

```bash
# Terminal 1
lumis dev

# Terminal 2
lumis worker:start --dev
```

---

<a name="running-production"></a>
## Running in Production

In production, the worker runs from the compiled output:

```bash
lumis worker:start
```

Under the hood this executes `.arc/node/worker.js` — the compiled entrypoint produced by `lumis build`. Ensure you run `lumis build` before deploying, or wire the build step into your CI pipeline.

A typical `package.json` for a production deployment:

```json
{
  "scripts": {
    "build":        "lumis build",
    "start:server": "lumis start",
    "start:worker": "lumis worker:start"
  }
}
```

Use a process manager such as [PM2](https://pm2.keymetrics.io/) or your platform's native supervisor to keep both processes alive:

```bash
pm2 start npm --name "api"    -- run start:server
pm2 start npm --name "worker" -- run start:worker
pm2 save
```

---

<a name="listing-workers"></a>
## Listing Workers

Inspect your registered workers and any scheduled jobs attached to the queue system:

```bash
lumis worker:list
```

Example output:

```
┌─ Workers ──────────────────────────────────────────────────────────┐
│ Queue       Handler            Concurrency   Status               │
│ default     user.welcome       10            registered           │
│ default     report.generate    10            registered           │
│ mail        notification.send  20            registered           │
└────────────────────────────────────────────────────────────────────┘

┌─ Scheduled Jobs ───────────────────────────────────────────────────┐
│ Name                Cron            Next Run                       │
│ cache:warm          0 * * * *       2025-01-15 14:00:00 UTC        │
│ reports:weekly      0 9 * * 1       2025-01-20 09:00:00 UTC        │
└────────────────────────────────────────────────────────────────────┘
```

---

<a name="multiple-queues"></a>
## Multiple Queues

It is common to segment jobs into different queues so that a flood of low-priority jobs (e.g., generating reports) cannot delay high-priority jobs (e.g., sending password resets).

```typescript
const worker = new BullMQWorker({
  connection: redisConnection,
  queues: ['default', 'mail', 'reports'],
  handlers: new Map([
    ['user.welcome',      userWelcomeHandler],
    ['notification.send', notificationSendHandler],
    ['report.generate',   reportGenerateHandler],
  ]),
  concurrency: 10,
})
```

BullMQ processes queues with the order you specify. Place high-priority queue names first. Each queue name must also be referenced when dispatching jobs:

```typescript
// Dispatch to the 'mail' queue with high priority
await queue.dispatch('notification.send', { userId: '123' }, {
  queueName: 'mail',
  priority: 1,
})

// Dispatch to the 'reports' queue (low priority, can be slow)
await queue.dispatch('report.generate', { reportId: 'xyz' }, {
  queueName: 'reports',
})
```

---

<a name="graceful-shutdown"></a>
## Graceful Shutdown

`BullMQWorker` listens for `SIGTERM` and `SIGINT` signals and calls `stop()` automatically. This ensures:

1. No new jobs are accepted from the queue.
2. In-flight jobs are allowed to complete.
3. The Redis connection is closed cleanly.
4. The process exits with code `0`.

This behaviour is built-in — you do not need to wire it up yourself. However, if you need to run additional teardown logic (e.g., flushing a metrics buffer), you can hook into the shutdown sequence:

```typescript
worker.onShutdown(async () => {
  await metricsClient.flush()
  await db.disconnect()
})

await worker.start()
```

The default graceful shutdown timeout is **30 seconds**. Jobs that are still running after this window are forcibly terminated and re-queued for retry. You can override the timeout:

```typescript
const worker = new BullMQWorker({
  // ...
  shutdownTimeout: 60_000, // 60 seconds
})
```

---

<a name="retries-dead-letter"></a>
## Retries and Dead Letter

BullMQ retry options are passed through directly via the `jobOptions` field on `BullMQWorker`, or per-dispatch when enqueueing a job.

### Default Retry Policy

Set a default retry policy for all jobs processed by this worker:

```typescript
const worker = new BullMQWorker({
  connection: redisConnection,
  queues: ['default'],
  handlers: new Map([...]),
  jobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1_000, // 1 second initial delay, doubles each attempt
    },
  },
})
```

### Per-Job Retry Policy

Override the retry policy when dispatching a specific job:

```typescript
await queue.dispatch('report.generate', { reportId }, {
  attempts: 5,
  backoff: {
    type: 'fixed',
    delay: 5_000, // retry every 5 seconds
  },
})
```

### Dead Letter Queue

Jobs that exhaust all retry attempts are moved to a **failed** set in BullMQ. You can inspect and replay them from the BullMQ dashboard or programmatically:

```typescript
import { Queue } from 'bullmq'

const rawQueue = new Queue('default', { connection })

const failed = await rawQueue.getFailed(0, 100)

for (const job of failed) {
  console.log(job.name, job.data, job.failedReason)
  await job.retry() // re-enqueue
}
```

---

<a name="full-example"></a>
## Full Example

Below is a complete, production-ready `bootstrap/worker.ts`:

```typescript
// bootstrap/worker.ts
import 'reflect-metadata'
import { BullMQWorker, type JobHandler } from '@lumiarq/framework/runtime'
import { env, createLogger } from '@lumiarq/framework'
import { db } from './providers.js'

// ─── Connection ──────────────────────────────────────────────────────────────

const connection = {
  host:     env('REDIS_HOST', '127.0.0.1'),
  port:     Number(env('REDIS_PORT', '6379')),
  password: env('REDIS_PASSWORD'),
  db:       Number(env('REDIS_DB', '0')),
}

const logger = createLogger({ level: env('LOG_LEVEL', 'info') })

// ─── Handlers ────────────────────────────────────────────────────────────────

const userWelcome: JobHandler = async (name, data) => {
  const { userId } = data as { userId: string }
  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  })
  if (!user) throw new Error(`User ${userId} not found`)
  await sendWelcomeEmail(user)
}

const notificationSend: JobHandler = async (name, data) => {
  const { to, subject, html } = data as {
    to: string
    subject: string
    html: string
  }
  await mailer.send({ to, subject, html })
}

const reportGenerate: JobHandler = async (name, data) => {
  const { reportId } = data as { reportId: string }
  logger.info({ reportId }, 'Starting report generation')
  await generateReport(reportId)
  logger.info({ reportId }, 'Report generation complete')
}

// ─── Worker ──────────────────────────────────────────────────────────────────

const worker = new BullMQWorker({
  connection,
  queues: ['default', 'mail', 'reports'],
  concurrency: 10,
  shutdownTimeout: 30_000,
  logger,

  handlers: new Map([
    ['user.welcome',      userWelcome],
    ['notification.send', notificationSend],
    ['report.generate',   reportGenerate],
  ]),

  jobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1_000,
    },
  },
})

worker.onShutdown(async () => {
  logger.info('Worker shutting down — closing database connection')
  await db.$client.end()
})

// ─── Start ───────────────────────────────────────────────────────────────────

await worker.start()
logger.info('Worker started — listening for jobs')
```

---

<a name="testing-workers"></a>
## Testing Workers

LumiARQ provides helpers for testing worker logic without connecting to Redis.

### Testing Handler Logic Directly

The simplest approach is to import and invoke your handler functions directly in tests:

```typescript
// tests/jobs/userWelcome.test.ts
import { describe, it, expect, vi } from 'vitest'
import { userWelcomeHandler } from '#jobs/handlers/userWelcomeHandler'

describe('userWelcomeHandler', () => {
  it('sends a welcome email to the user', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined)
    vi.mock('#mail/mailer', () => ({ mailer: { send: sendMock } }))

    await userWelcomeHandler('user.welcome', { userId: 'user-123' })

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'alice@example.com' })
    )
  })
})
```

### Asserting Jobs Were Dispatched

Use the `FakeQueue` provided by the framework to assert that jobs were enqueued without processing them:

```typescript
import { FakeQueue } from '@lumiarq/framework/testing'
import { registerUser } from '#modules/Auth/actions/registerUser'

it('dispatches a welcome email job on registration', async () => {
  const queue = new FakeQueue()

  await registerUser(
    { email: 'alice@example.com', password: 'secret' },
    { queue }
  )

  queue.assertDispatched('user.welcome', (data) => {
    expect(data.userId).toBeDefined()
    return true
  })
})
```

`FakeQueue` captures all `dispatch()` calls in memory. Use `queue.assertDispatched(name)`, `queue.assertNotDispatched(name)`, and `queue.dispatchedJobs()` to make assertions.
