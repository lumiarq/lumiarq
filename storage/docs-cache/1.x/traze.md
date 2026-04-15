---
title: Traze
description: Diagnostics, logging, and performance tracing for LumiARQ applications.
section: Packages
order: 8
draft: false
---

# Traze

- [Introduction](#introduction)
- [Dump Helpers](#dump-helpers)
  - [dump()](#dump)
  - [dd()](#dd)
- [Performance Tracing](#performance-tracing)
  - [trace()](#trace)
- [Structured Logger](#structured-logger)
  - [createLogger()](#createlogger)
  - [Log Levels](#log-levels)
  - [Context](#context)
  - [measure()](#measure)
- [Channels](#channels)
  - [Console Channel](#console-channel)
  - [File Channel](#file-channel)
  - [HTTP Channel](#http-channel)
- [Collectors](#collectors)
  - [HTTP Collector](#http-collector)
  - [Query Collector](#query-collector)
  - [Event Collector](#event-collector)
  - [Cache Collector](#cache-collector)
- [Global Helpers](#global-helpers)

<a name="introduction"></a>

## Introduction

Traze is LumiARQ's diagnostics and observability package. It ships three layers of tooling:

- **Dump helpers** — `dump()` and `dd()` for quick variable inspection.
- **Performance tracing** — `trace()` for measuring execution time.
- **Structured logger** — `createLogger()` with pluggable output channels and performance metrics.
- **Collectors** — passive recorders for HTTP requests, database queries, events, and cache operations.

Import everything from the framework's `traze` sub-path:

```typescript
import { dump, dd, trace, createLogger } from '@lumiarq/framework/traze'
import { createConsoleChannel, createFileChannel } from '@lumiarq/framework/traze'
import { createHttpCollector, createQueryCollector } from '@lumiarq/framework/traze'
```

<a name="dump-helpers"></a>

## Dump Helpers

<a name="dump"></a>

### dump()

`dump()` pretty-prints any value to stdout using Node's `util.inspect` with depth 6 and sorted keys. Unlike `console.log`, it formats objects across multiple lines and handles circular references gracefully.

```typescript
import { dump } from '@lumiarq/framework/traze'

const user = { id: 1, name: 'Alice', roles: ['admin', 'editor'] }
dump(user)
```

<run-example>{ id: 1, name: 'Alice', roles: [ 'admin', 'editor' ] }</run-example>

You can pass multiple values and each will be printed in sequence:

```typescript
dump(user, user.roles, 42)
```

<run-example>{ id: 1, name: 'Alice', roles: [ 'admin', 'editor' ] }
[ 'admin', 'editor' ]
42</run-example>

<a name="dd"></a>

### dd()

`dd()` (dump and die) calls `dump()` then throws an `Error` to stop execution immediately. It's useful during development when you want to inspect a value and prevent any further processing.

```typescript
import { dd } from '@lumiarq/framework/traze'

const order = await GetOrderQuery(id)
dd(order) // inspect and halt — nothing below this runs
```

<run-example>{
  id: 42,
  status: 'pending',
  total: 129.99,
  items: [
    { sku: 'SHIRT-M', qty: 2, price: 49.99 },
    { sku: 'CAP-ONE', qty: 1, price: 30.01 }
  ]
}

Error: Execution halted by dd().
</run-example>

> [!NOTE]
> Both `dump` and `dd` are also registered as **globals** when Traze is imported, so you can call them without an import statement during debugging sessions. Remove any global calls before deploying to production.

<a name="performance-tracing"></a>

## Performance Tracing

<a name="trace"></a>

### trace()

`trace()` starts a named timer and returns a stop function. Calling the stop function prints the elapsed time to stdout and returns the duration in milliseconds.

```typescript
import { trace } from '@lumiarq/framework/traze'

const stop = trace('fetch users')

const users = await GetUsersQuery()

const ms = stop() // prints and returns duration
```

<run-example>fetch users: 12.45ms</run-example>

When the duration exceeds one second, `trace()` automatically switches to seconds:

<run-example>import users from CSV: 2.31s</run-example>

Nest multiple `trace()` calls to profile individual stages of a pipeline:

```typescript
const stopTotal = trace('pipeline total')

const stopFetch = trace('  fetch')
const raw = await fetchExternalData()
stopFetch()

const stopTransform = trace('  transform')
const processed = transform(raw)
stopTransform()

stopTotal()
```

<run-example>  fetch: 89.12ms
  transform: 3.07ms
pipeline total: 94.31ms</run-example>

<a name="structured-logger"></a>
## Structured Logger

<a name="createlogger"></a>
### createLogger()

`createLogger()` returns a fully structured logger that fans log entries out to one or more output **channels**. Each log entry carries a level, message, timestamp, optional context map, and optional performance metrics.

```typescript
import { createLogger, createConsoleChannel } from '@lumiarq/framework/traze'

const logger = createLogger({
  channels: [createConsoleChannel()],
})

await logger.info('Server started', { port: 3000 })
await logger.warn('Slow query detected', { sql: 'SELECT *', durationMs: 820 })
await logger.error('Payment failed', { orderId: 42, reason: 'card_declined' })
```

<a name="log-levels"></a>
### Log Levels

Four levels are available, in ascending severity:

| Level | Use for |
|-------|---------|
| `debug` | Low-level diagnostic detail, disabled in production |
| `info` | Routine operational events |
| `warn` | Recoverable problems worth attention |
| `error` | Failures requiring investigation |

You can also call `logger.log(level, message, context, metrics)` to pass the level as a string argument.

<a name="context"></a>
### Context

Attach persistent fields to every subsequent log entry using `logger.context()`. This is ideal for binding a request ID, user ID, or tenant ID at the start of a request lifecycle:

```typescript
const logger = createLogger({ channels: [createConsoleChannel()] })

// Bind for the duration of this request
logger.context({ requestId: ctx.req.id, userId: session.userId })

await logger.info('Cart updated', { itemCount: 3 })
await logger.info('Checkout initiated')

// Remove all bound context
logger.clearContext()
```

<run-example>[info]  Cart updated       { requestId: 'req_9xk2', userId: 7, itemCount: 3 }
[info]  Checkout initiated { requestId: 'req_9xk2', userId: 7 }</run-example>

Both `context()` and `clearContext()` return the logger instance so calls can be chained.

<a name="measure"></a>

### measure()

`measure()` wraps an async or sync function, runs it, and logs an `info` entry with the elapsed `durationMs` metric automatically attached:

```typescript
const users = await logger.measure(
  'load users',
  () => GetAllUsersQuery(),
  { source: 'database' },
)
```

<run-example>[info]  load users  { source: 'database' }  durationMs: 34.18</run-example>

The wrapped function's return value is passed through, so `measure()` is a zero-friction drop-in around any existing call.

<a name="channels"></a>
## Channels

A channel receives every `LogEntry` and decides how to record it. Pass an array of channels when creating a logger — entries are fanned out to all of them in parallel.

<a name="console-channel"></a>

### Console Channel

Writes formatted log entries to stdout. Best for development and for serverless runtimes where stdout is captured by the platform.

```typescript
import { createConsoleChannel } from '@lumiarq/framework/traze'

const logger = createLogger({
  channels: [createConsoleChannel()],
})
```

<a name="file-channel"></a>

### File Channel

Appends newline-delimited JSON entries to a log file. Each line is a complete `LogEntry` object, making it easy to stream into log aggregation tools.

```typescript
import { createFileChannel } from '@lumiarq/framework/traze'

const logger = createLogger({
  channels: [
    createFileChannel({ path: 'storage/logs/app.log' }),
  ],
})
```

<run-example>
{"level":"info","message":"Server started","timestamp":"2026-03-27T10:00:00.000Z","context":{"port":3000}}
{"level":"warn","message":"Slow query","timestamp":"2026-03-27T10:00:04.231Z","context":{},"metrics":{"durationMs":820}}
</run-example>

<a name="http-channel"></a>
### HTTP Channel

Posts log entries as JSON to an external HTTP endpoint. Useful for forwarding logs to hosted observability platforms.

```typescript
import { createHttpChannel } from '@lumiarq/framework/traze'

const logger = createLogger({
  channels: [
    createHttpChannel({
      url: 'https://logs.example.com/ingest',
      headers: { Authorization: `Bearer ${env.LOG_TOKEN}` },
    }),
  ],
})
```

Channels can be combined freely — log to the console during development and to a file and HTTP endpoint in production:

```typescript
const channels =
  env.NODE_ENV === 'production'
    ? [createFileChannel({ path: 'storage/logs/app.log' }), createHttpChannel({ url: env.LOG_ENDPOINT })]
    : [createConsoleChannel()]

const logger = createLogger({ channels })
```

<a name="collectors"></a>

## Collectors

Collectors are passive recorders — they accumulate structured entries for a specific subsystem (HTTP, queries, events, or cache) without emitting anything until you inspect them. They are useful for testing and for building custom dashboards.

<a name="http-collector"></a>

### HTTP Collector

Records each HTTP request with its method, path, status code, and duration:

```typescript
import { createHttpCollector } from '@lumiarq/framework/traze'

const http = createHttpCollector()

// Record a request (typically via middleware)
http.record({ method: 'GET', path: '/api/users', status: 200, durationMs: 14 })

// Inspect
console.log(http.all())   // all entries
console.log(http.slow(200)) // entries where durationMs > 200
```

<a name="query-collector"></a>

### Query Collector

Records SQL queries with their bindings and duration, and detects N+1 patterns automatically:

```typescript
import { createQueryCollector } from '@lumiarq/framework/traze'

const queries = createQueryCollector()

queries.record({ sql: 'SELECT * FROM users', durationMs: 8 })
queries.record({ sql: 'SELECT * FROM posts WHERE user_id = ?', bindings: [1], durationMs: 5 })
queries.record({ sql: 'SELECT * FROM posts WHERE user_id = ?', bindings: [2], durationMs: 4 })

console.log(queries.warnings()) // detects repeated queries (N+1)
```

<run-example>[
  {
    sql: 'SELECT * FROM posts WHERE user_id = ?',
    count: 2,
    type: 'n-plus-one'
  }
]</run-example>

<a name="event-collector"></a>

### Event Collector

Records dispatched events with their name, optional payload, and optional duration:

```typescript
import { createEventCollector } from '@lumiarq/framework/traze'

const events = createEventCollector()

events.record({ name: 'order.placed', payload: { orderId: 42 }, durationMs: 2 })
events.record({ name: 'email.queued', durationMs: 1 })

console.log(events.all())
console.log(events.for('order.placed')) // filter by name
```

<a name="cache-collector"></a>

### Cache Collector

Records cache hits, misses, writes (`put`), and deletions (`forget`):

```typescript
import { createCacheCollector } from '@lumiarq/framework/traze'

const cache = createCacheCollector()

cache.record({ operation: 'miss', key: 'users:page:1', durationMs: 0.5 })
cache.record({ operation: 'put',  key: 'users:page:1', durationMs: 1.2 })
cache.record({ operation: 'hit',  key: 'users:page:1', durationMs: 0.3 })

console.log(cache.summary())
```

<run-example>{ hits: 1, misses: 1, puts: 1, forgets: 0, total: 3 }</run-example>

<a name="global-helpers"></a>

## Global Helpers

When Traze is first imported, it registers `dump`, `dd`, and `trace` on the **global object** (`globalThis`). This means you can call them anywhere in your codebase without an import — handy for quick debugging deep inside a call stack.

```typescript
// No import needed after Traze has been initialised
dump({ userId: 1, role: 'admin' })
dd(suspiciousValue)
const stop = trace('render page')
```

> [!NOTE]
> Global registration happens as a side effect of the first `import … from '@lumiarq/framework/traze'`. The framework's boot process handles this automatically, so you don't need to import Traze explicitly in application code just to get the globals.

Remove all `dump`, `dd`, and `trace` calls before deploying to production, or gate them behind an `env.APP_DEBUG` check.
