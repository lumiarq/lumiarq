---
title: Scheduling
description: Registering and running cron jobs with CronScheduler
section: Digging Deeper
order: 14
draft: false
---

# Scheduling

## Table of Contents

- [Introduction](#introduction)
- [CronScheduler](#cron-scheduler)
- [The Schedule Bootstrap File](#schedule-bootstrap-file)
- [Registering Jobs](#registering-jobs)
- [Scheduler Lifecycle](#scheduler-lifecycle)
- [Exporting the Schedule](#exporting-the-schedule)
- [Cron Expression Reference](#cron-reference)
- [Listing Scheduled Jobs](#listing-jobs)
- [Running a Job On Demand](#run-on-demand)
- [Running the Scheduler](#running-the-scheduler)
- [Preventing Overlap](#preventing-overlap)
- [Timezone Support](#timezone-support)
- [Full Example](#full-example)
- [Testing Scheduled Jobs](#testing-jobs)

---

<a name="introduction"></a>
## Introduction

Some work is not triggered by a user action but by the **passage of time** — clearing expired sessions at midnight, warming a cache every hour, sending a weekly digest on Monday morning. LumiARQ's scheduling system lets you define these recurring tasks in code, with full TypeScript support, rather than managing a crontab file on each server.

### Scheduling vs Queues

These two systems complement each other:

| Concern | Use |
|---------|-----|
| "Run this logic **right now**, in the background" | Queue + Worker |
| "Run this logic **at a specific time / interval**" | Scheduler |

A common pattern is to use the scheduler to **dispatch a job** on a schedule, letting the worker do the heavy lifting:

```typescript
schedule.add('reports:weekly', '0 9 * * 1', async () => {
  await queue.dispatch('report.generate', { scope: 'weekly' })
})
```

---

<a name="cron-scheduler"></a>
## CronScheduler

`CronScheduler` is exported from `@lumiarq/framework/runtime`. It wraps [node-cron](https://github.com/node-cron/node-cron) with lazy initialisation — the underlying cron tasks are not started until you call `schedule.start()`.

```typescript
import { CronScheduler } from '@lumiarq/framework/runtime'
```

### Instantiation

```typescript
const schedule = new CronScheduler({
  logger?: LoggerContract   // optional — logs job start/finish/error
  timezone?: string         // default IANA timezone for all jobs unless overridden
})
```

---

<a name="schedule-bootstrap-file"></a>
## The Schedule Bootstrap File

By convention, schedule registrations live in `bootstrap/schedule.ts`. This file is imported by `bootstrap/worker.ts` so the scheduler shares the worker process.

Create the file manually or scaffold it:

```bash
lumis publish config queue   # generates bootstrap/worker.ts + bootstrap/schedule.ts
```

A minimal `bootstrap/schedule.ts`:

```typescript
// bootstrap/schedule.ts
import { CronScheduler } from '@lumiarq/framework/runtime'
import { createLogger } from '@lumiarq/framework'

export const schedule = new CronScheduler({
  logger:   createLogger(),
  timezone: 'UTC',
})

// Register your jobs below
```

Then import and start the schedule from `bootstrap/worker.ts`:

```typescript
// bootstrap/worker.ts
import { schedule } from './schedule.js'

// ...worker setup...

await worker.start()
await schedule.start()
```

---

<a name="registering-jobs"></a>
## Registering Jobs

Use `schedule.add()` to register a named cron job:

```typescript
schedule.add(name, cronExpression, handler, options?)
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique name used by `lumis schedule:run` and logs |
| `cronExpression` | `string` | Standard 5-field cron expression |
| `handler` | `() => Promise<void>` | Async function to execute |
| `options` | `ScheduleOptions` | Optional configuration (see below) |

### ScheduleOptions

```typescript
interface ScheduleOptions {
  /** Prevent a new execution if the previous run is still in progress */
  preventOverlap?: boolean   // default: false

  /** IANA timezone for this specific job (overrides scheduler default) */
  timezone?: string

  /** If true, the job is registered but not activated on start() */
  disabled?: boolean
}
```

### Basic Registration

```typescript
// Run at the top of every hour
schedule.add('cache:warm', '0 * * * *', async () => {
  await warmApplicationCache()
})

// Run at midnight every day
schedule.add('sessions:cleanup', '0 0 * * *', async () => {
  await deleteExpiredSessions()
})

// Run at 9 AM every Monday
schedule.add('reports:weekly', '0 9 * * 1', async () => {
  await queue.dispatch('report.generate', { scope: 'weekly' })
})
```

---

<a name="scheduler-lifecycle"></a>
## Scheduler Lifecycle

```typescript
// Activate all registered jobs and begin ticking
await schedule.start()

// Deactivate all jobs and stop the cron loop
await schedule.stop()
```

`start()` iterates over every registered job and activates its underlying node-cron task. Once started, jobs fire automatically according to their expressions.

`stop()` deactivates all tasks. Any currently running handler is allowed to finish; no new executions will begin after `stop()` returns.

---

<a name="exporting-the-schedule"></a>
## Exporting the Schedule

To allow `lumis schedule:list` to inspect your registered jobs, the `schedule` instance must be accessible to the framework's CLI. Export it from `bootstrap/schedule.ts` and re-export it from `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
export { schedule } from './schedule.js'
export { worker }   from './worker.js'
// ... other providers
```

The CLI imports `providers.ts` at inspection time without fully booting the worker process, so it can enumerate job names and cron expressions cheaply.

---

<a name="cron-reference"></a>
## Cron Expression Reference

LumiARQ uses the standard 5-field cron format:

```
┌───────────── minute        (0–59)
│ ┌─────────── hour          (0–23)
│ │ ┌───────── day of month  (1–31)
│ │ │ ┌─────── month         (1–12)
│ │ │ │ ┌───── day of week   (0–7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

### Common Patterns

| Expression | Meaning |
|-----------|---------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour (at :00) |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 * * *` | Every day at midnight |
| `0 6 * * *` | Every day at 6 AM |
| `0 9 * * 1` | Every Monday at 9 AM |
| `0 0 1 * *` | First day of every month at midnight |
| `0 0 1 1 *` | Every January 1st at midnight |
| `30 23 * * 5` | Every Friday at 11:30 PM |

### Validation

LumiARQ validates cron expressions at registration time and throws a descriptive error for invalid expressions:

```typescript
// This throws immediately — invalid expression
schedule.add('bad-job', '99 * * * *', async () => {})
// Error: Invalid cron expression "99 * * * *": minute must be 0–59
```

---

<a name="listing-jobs"></a>
## Listing Scheduled Jobs

```bash
lumis schedule:list
```

Example output:

```
┌─ Scheduled Jobs ─────────────────────────────────────────────────────────────────┐
│ Name                Cron Expression   Timezone   Next Run                        │
│ cache:warm          0 * * * *         UTC        2025-01-15 15:00:00 UTC         │
│ sessions:cleanup    0 0 * * *         UTC        2025-01-16 00:00:00 UTC         │
│ reports:weekly      0 9 * * 1         UTC        2025-01-20 09:00:00 UTC         │
│ invoices:monthly    0 8 1 * *         UTC        2025-02-01 08:00:00 UTC         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

<a name="run-on-demand"></a>
## Running a Job On Demand

Trigger any registered job immediately without waiting for its scheduled time:

```bash
lumis schedule:run cache:warm
```

This is useful for:

- Manually warming a cache after a deployment
- Testing that a job works correctly in production
- Re-running a job that failed or was missed

The `schedule:run` command imports your schedule, finds the named job, and invokes its handler directly — no Redis or cron ticking involved.

```bash
# With verbose output
lumis schedule:run reports:weekly --verbose

# Running 'reports:weekly'...
# ✓ Completed in 4.2s
```

---

<a name="running-the-scheduler"></a>
## Running the Scheduler

The scheduler runs **inside the worker process** — not in the HTTP server. This ensures only one scheduler instance is active regardless of how many HTTP replicas you deploy.

In development:

```bash
lumis worker:start --dev   # starts both the BullMQ worker and the CronScheduler
```

In production:

```bash
lumis worker:start
```

> **Important:** If you run multiple worker processes (for horizontal scaling), each process will independently execute every cron job. Use `preventOverlap: true` to guard against concurrent runs, or ensure only **one** worker process runs the scheduler by separating it from your job-processing workers.

---

<a name="preventing-overlap"></a>
## Preventing Overlap

For jobs that could take longer than their interval, enable overlap prevention:

```typescript
schedule.add(
  'data:sync',
  '*/5 * * * *',  // every 5 minutes
  async () => {
    await syncExternalData()  // might take up to 4 minutes
  },
  { preventOverlap: true }
)
```

When `preventOverlap: true` is set and the previous run is still executing, the scheduler logs a warning and **skips** the new execution:

```
[schedule] Skipping "data:sync" — previous run still in progress
```

---

<a name="timezone-support"></a>
## Timezone Support

All cron expressions are evaluated in UTC by default. You can override the timezone for the entire scheduler or per individual job.

### Scheduler-Level Default

```typescript
const schedule = new CronScheduler({
  timezone: 'America/New_York',
})
```

### Per-Job Timezone

```typescript
// This job runs at 9 AM Eastern, regardless of the server's local time
schedule.add(
  'reports:morning',
  '0 9 * * *',
  async () => { await sendMorningReport() },
  { timezone: 'America/New_York' }
)

// This job runs at 9 AM Tokyo time
schedule.add(
  'reports:tokyo',
  '0 9 * * *',
  async () => { await sendTokyoReport() },
  { timezone: 'Asia/Tokyo' }
)
```

LumiARQ accepts any valid [IANA timezone identifier](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). Invalid identifiers throw at registration time.

---

<a name="full-example"></a>
## Full Example

A complete `bootstrap/schedule.ts` for a typical SaaS application:

```typescript
// bootstrap/schedule.ts
import { CronScheduler } from '@lumiarq/framework/runtime'
import { createLogger, env }  from '@lumiarq/framework'
import { db }   from './providers.js'
import { queue } from './queue.js'

const logger = createLogger({ level: env('LOG_LEVEL', 'info') })

export const schedule = new CronScheduler({ logger, timezone: 'UTC' })

// ─── Cache ───────────────────────────────────────────────────────────────────

schedule.add('cache:warm', '0 * * * *', async () => {
  // Re-warm frequently accessed but slow queries every hour
  await db.query.products.findMany({ limit: 100 })
  logger.info('Cache warmed')
})

// ─── Sessions ────────────────────────────────────────────────────────────────

schedule.add(
  'sessions:cleanup',
  '0 0 * * *',  // midnight UTC
  async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days
    const deleted = await db
      .delete(sessions)
      .where(lt(sessions.lastActiveAt, cutoff))
    logger.info({ deleted: deleted.rowCount }, 'Expired sessions removed')
  },
  { preventOverlap: true }
)

// ─── Reports ─────────────────────────────────────────────────────────────────

schedule.add(
  'reports:weekly',
  '0 9 * * 1',  // Monday 9 AM UTC
  async () => {
    // Dispatch to the 'reports' queue so it doesn't block the scheduler
    await queue.dispatch('report.generate', {
      scope: 'weekly',
      date:  new Date().toISOString(),
    }, { queueName: 'reports' })
    logger.info('Weekly report job dispatched')
  }
)

// ─── Invoices ────────────────────────────────────────────────────────────────

schedule.add(
  'invoices:monthly',
  '0 8 1 * *',  // 1st of every month at 8 AM
  async () => {
    const subscriptions = await db.query.subscriptions.findMany({
      where: (s, { eq }) => eq(s.status, 'active'),
    })

    for (const sub of subscriptions) {
      await queue.dispatch('invoice.generate', { subscriptionId: sub.id })
    }

    logger.info({ count: subscriptions.length }, 'Invoice jobs dispatched')
  },
  { preventOverlap: true }
)

// ─── Health ──────────────────────────────────────────────────────────────────

schedule.add('health:ping', '*/5 * * * *', async () => {
  // Ping an external health monitor (e.g. Betterstack, UptimeRobot)
  const url = env('HEALTH_PING_URL')
  if (url) await fetch(url)
})
```

---

<a name="testing-jobs"></a>
## Testing Scheduled Jobs

### Unit-Testing Handler Logic

Extract your job handler logic into plain async functions, then test them independently of the scheduler:

```typescript
// src/jobs/cleanupSessions.ts
export async function cleanupSessions(db: DatabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const result = await db.delete(sessions).where(lt(sessions.lastActiveAt, cutoff))
  return result.rowCount ?? 0
}
```

```typescript
// tests/jobs/cleanupSessions.test.ts
import { describe, it, expect } from 'vitest'
import { cleanupSessions } from '#jobs/cleanupSessions'
import { createTestDb }    from '#testing/db'

describe('cleanupSessions', () => {
  it('deletes sessions older than 30 days', async () => {
    const db = createTestDb()
    // seed an expired session
    await db.insert(sessions).values({
      id:           'sess-old',
      lastActiveAt: new Date('2020-01-01'),
    })

    const deleted = await cleanupSessions(db)

    expect(deleted).toBe(1)
  })
})
```

### Asserting a Job Is Registered

You can assert that a specific job name is registered in your schedule instance:

```typescript
import { schedule } from '#bootstrap/schedule'

it('registers the weekly report job', () => {
  const job = schedule.findByName('reports:weekly')
  expect(job).toBeDefined()
  expect(job?.cronExpression).toBe('0 9 * * 1')
})
```

### Running a Job in Test

Invoke a scheduled job directly in a test without ticking the clock:

```typescript
it('weekly report job dispatches a queue job', async () => {
  const fakeQueue = new FakeQueue()
  await schedule.run('reports:weekly', { queue: fakeQueue })

  fakeQueue.assertDispatched('report.generate', (data) => {
    expect(data.scope).toBe('weekly')
    return true
  })
})
```
