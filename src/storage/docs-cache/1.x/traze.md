---
title: Trazze
description: Observability platform for LumiARQ — structured logging, Ignition error pages, action/query tracing, and the Trazze dashboard.
section: Packages
order: 8
draft: false
---

# Trazze

- [Introduction](#introduction)
- [Packages Overview](#packages-overview)
- [Installation](#installation)
- [The  @trazze/sdk](#the-sdk)SDK 
  - [Dump Helpers](#dump-helpers)
  - [trace()](#trace)
  - [formatDuration() and formatBytes()](#format-helpers)
  - [style](#style)
  - [createLogger()](#createlogger)
  - [Log Levels](#log-levels)
  - [Persistent Context](#persistent-context)
  - [measure()](#measure)
  - [Channels](#channels)
  - [Memory Channel (testing)](#memory-channel)
  - [Collectors](#collectors)
  - [Global Helpers](#global-helpers)
- [LumiARQ  @trazze/adapter-lumiarq](#lumiarq-adapter)Adapter 
  - [createTrazeAdapter()](#createtrazeadapter)
  - [HTTP Capture Middleware](#http-capture-middleware)
  - [Action and Query Tracing](#action-and-query-tracing)
  - [Automatic Error Reporter](#automatic-error-reporter)
  - [Full Bootstrap Example](#full-bootstrap-example)
- [Ignition Error  @trazze/ignite](#ignition)Pages 
  - [handleIgnitionError](#handleignitionerror)
  - [pushToTrazze](#pushtotrazze)
  - [Editor Deep-Links](#editor-deep-links)
- [The Trazze  @trazze/cli](#trazze-cli)CLI 
- [Environment Variables](#environment-variables)

---

<a name="introduction"></a>
## Introduction

Trazze is LumiARQ's companion observability platform. It started as a set of debug helpers and has grown into a full stack:

- **`@trazze/ structured logger, dump/dd/trace helpers, output channels, and collectors. Works in any JavaScript runtime.sdk`** 
- **`@trazze/ shared TypeScript types (`LogEntry`, `Logger`, `Channel`, collectors) consumed by every Trazze package.contracts`** 
- **`@trazze/adapter- wires the SDK into a LumiARQ app: HTTP capture middleware, action/query auto-tracing, and global error reporter.lumiarq`** 
- **`@trazze/ Ignition-style dev error page with parsed stack frames, editor deep-links, and automatic push to the Trazze dashboard.ignite`** 
- **`@trazze/ `traze` CLI for tailing, searching, and inspecting event streams from the Trazze server.cli`** 
- **Trazze  self-hosted observability dashboard (separate deployment).app** 

---

<a name="packages-overview"></a>
## Packages Overview

| Package | NPM | Purpose |
|---------|-----|---------|
| `@trazze/sdk` | public | Logger, channels, helpers, collectors |
| `@trazze/contracts` | public | Shared TypeScript types |
| `@trazze/adapter-lumiarq` | public | LumiARQ integration hooks |
| `@trazze/ignite` | public | Dev error page + stack push |
| `@trazze/cli` | public | CLI for Trazze server |

---

<a name="installation"></a>
## Installation

Install the SDK and LumiARQ adapter together:

```bash
pnpm add @trazze/sdk @trazze/adapter-lumiarq
```

Add Ignition error pages for development:

```bash
pnpm add -D @trazze/ignite
```

Add the Trazze CLI globally (optional):

```bash
pnpm add -g @trazze/cli
```

---

<a name="the-sdk"></a>
## The  `@trazze/sdk`SDK 

```typescript
import { dump, dd, trace, formatDuration, formatBytes, style } from '@trazze/sdk'
import { createLogger } from '@trazze/sdk'
import { createConsoleChannel, createFileChannel, createHttpChannel, createMemoryChannel } from '@trazze/sdk'
import { createHttpCollector, createQueryCollector, createEventCollector, createCacheCollector } from '@trazze/sdk'
```

---

<a name="dump-helpers"></a>
### Dump Helpers

#### `dump(...values)`

Pretty-prints any value to stdout using Node's `util.inspect` with depth 6, sorted keys, and no colour codes so output is clean in any terminal.

```typescript
import { dump } from '@trazze/sdk'

dump({ id: 1, name: 'Alice', roles: ['admin', 'editor'] })
// { id: 1, name: 'Alice', roles: [ 'admin', 'editor' ] }

dump(user, user.roles, 42)
// prints each argument in sequence
```

#### `dd(...values)`

Calls `dump()` then throws an `Error` to halt execution immediately. Use during debugging to inspect a value and stop any further processing.

```typescript
import { dd } from '@trazze/sdk'

const order = await GetOrderQuery(id)
 halt; nothing below this runs
```

#### `formatDump(value)`

Returns the formatted string without printing  useful when you need to embed the representation in a log message.it 

```typescript
import { formatDump } from '@trazze/sdk'

logger.info('Processing order', { snapshot: formatDump(order) })
```

---

<a name="trace"></a>
### `trace(label)`

Starts a named timer and returns a stop function. Calling stop prints the elapsed time and returns the duration in milliseconds.

```typescript
import { trace } from '@trazze/sdk'

const stop = trace('fetch users')
const users = await GetUsersQuery()
const ms = stop()
 fetch users: 12.45ms
```

Nest `trace()` calls to profile each stage of a pipeline:

```typescript
const stopTotal = trace('pipeline total')

const stopFetch  = trace('  fetch')
const raw = await fetchExternalData()
stopFetch()

const stopTransform = trace('  transform')
const processed = transform(raw)
stopTransform()

stopTotal()
   fetch: 89.12ms
   transform: 3.07ms
 pipeline total: 94.31ms
```

---

<a name="format-helpers"></a>
### `formatDuration()` and `formatBytes()`

Utility formatters that return human-readable strings:

```typescript
import { formatDuration, formatBytes } from '@trazze/sdk'

formatDuration(42)       // '42.00ms'
formatDuration(1340)     // '1.34s'

formatBytes(512)         // '512 B'
formatBytes(4096)        // '4.00 KB'
formatBytes(2097152)     // '2.00 MB'
```

Useful when building custom log entries or CLI output.

---

<a name="style"></a>
### `style`

A chalk-based styling helper exported as a `TrazeStyle` object. Every Trazze package uses this for consistent terminal output.

```typescript
import { style } from '@trazze/sdk'

console.log(style.green('Passed'))
console.log(style.red('Failed'))
console.log(style.bold('Section header'))
console.log(style.dim('secondary text'))
console.log(style.cyan('lumis serve'))
console.log(style. (green)successMark())  // 
console.log(style. (yellow)warnMark())     // 
console.log(style. (red)errorMark())    // 
console.log(style. (cyan)bullet())       // 
```

---

<a name="createlogger"></a>
### `createLogger(options?)`

Returns a `Logger` that fans every log entry out to one or more output **channels**. Each entry carries a level, message, timestamp, context map, and optional performance metrics.

```typescript
import { createLogger, createConsoleChannel } from '@trazze/sdk'

const logger = createLogger({
  channels: [createConsoleChannel()],
  context: { service: 'billing-api' },  // bound to every entry
})

await logger.info('Server started', { port: 3000 })
await logger.warn('Slow query', { sql: 'SELECT *', durationMs: 820 })
await logger.error('Payment failed', { orderId: 42, reason: 'card_declined' })
```

`createLogger` options:

| Option | Type | Description |
|--------|------|-------------|
| `channels` | `Channel[]` | Output destinations. Defaults to `[]` (silent). |
| `context` | `Record<string, unknown>` | Fields merged into every log entry. |

---

<a name="log-levels"></a>
### Log Levels

| Method | Use for |
|--------|---------|
| `logger.debug(msg, ctx?, metrics?)` | Low-level diagnostic detail |
| `logger.info(msg, ctx?, metrics?)` | Routine operational events |
| `logger.warn(msg, ctx?, metrics?)` | Recoverable problems |
| `logger.error(msg, ctx?, metrics?)` | Failures requiring investigation |
| `logger.log(level, msg, ctx?, metrics?)` | Programmatic level selection |

All methods are `async` and return `Promise< await them if you need backpressure, or fire-and-forget with `.catch(() => void 0)` for request paths.void>` 

---

<a name="persistent-context"></a>
### Persistent Context

Bind fields to every subsequent log entry with `logger.context()`. Ideal for attaching request IDs or user IDs at the start of a request lifecycle:

```typescript
// In your request handler or middleware
logger.context({ requestId: ctx.contextId, userId: session.userId })

await logger.info('Cart updated', { itemCount: 3 })
await logger.info('Checkout initiated')

// Remove all bound context when done
logger.clearContext()
```

Both `context()` and `clearContext()` return the logger instance for chaining.

---

<a name="measure"></a>
### `measure(label, fn, ctx?)`

Wraps an async (or sync) function, runs it, and logs an `info` entry with the elapsed `durationMs` metric automatically attached. The return value is passed through unchanged.

```typescript
const users = await logger.measure(
  'load users',
  () => GetAllUsersQuery(),
  { source: 'database' },
)
// [info] load users { source: 'database' } durationMs: 34.18
```

`measure()` is a zero-friction drop-in around any existing async call.

---

<a name="channels"></a>
### Channels

A channel receives every `LogEntry` and decides how to record it. Multiple channels receive entries in parallel.

#### Console Channel

Writes formatted log entries to stdout. Best for development and serverless runtimes.

```typescript
import { createConsoleChannel } from '@trazze/sdk'

const logger = createLogger({ channels: [createConsoleChannel()] })
```

#### File Channel

Appends newline-delimited JSON to a log file. Each line is a complete `LogEntry`, making it compatible with log aggregation tools (Grafana Loki, Datadog, etc.).

```typescript
import { createFileChannel } from '@trazze/sdk/node'

const logger = createLogger({
  channels: [createFileChannel({ path: 'storage/logs/app.log' })],
})
```

> [!NOTE]
> `createFileChannel` is only available via `@trazze/sdk/node` (Node.js-only). Import from `@trazze/sdk` in edge runtimes and it will be omitted.

#### HTTP Channel

Posts log entries as JSON to an external  typically the Trazze ingest API or another log aggregator.endpoint 

```typescript
import { createHttpChannel } from '@trazze/sdk'

const logger = createLogger({
  channels: [
    createHttpChannel({
      endpoint: 'https://trazze.example.com/v1/ingest',
      headers: { Authorization: `Bearer ${env.TRAZZE_API_KEY}` },
    }),
  ],
})
```

The `createHttpChannel` factory accepts a custom `transport` function as its second argument for testing or custom fetch behaviour.

#### Combining Channels

Fan out to multiple destinations simultaneously:

```typescript
const channels =
  env.NODE_ENV === 'production'
    ? [
        createFileChannel({ path: 'storage/logs/app.log' }),
        createHttpChannel({ endpoint: env.TRAZZE_ENDPOINT, headers: { Authorization: `Bearer ${env.TRAZZE_API_KEY}` } }),
      ]
    : [createConsoleChannel()]

const logger = createLogger({ channels })
```

---

<a name="memory-channel"></a>
### Memory Channel (Testing)

The `MemoryChannel` stores entries in an in-process array so you can assert on them in tests:

```typescript
import { createMemoryChannel, createLogger } from '@trazze/sdk'

const channel = createMemoryChannel()
const logger = createLogger({ channels: [channel] })

await logger.info('User created', { userId: 42 })

const entries = channel.getEntries()
expect(entries).toHaveLength(1)
expect(entries[0]!.level).toBe('info')
expect(entries[0]!.context?.userId).toBe(42)

channel.clear()
```

---

<a name="collectors"></a>
### Collectors

Collectors are passive recorders that accumulate structured entries for a specific subsystem without emitting anything until you inspect them. Useful for testing and custom observability dashboards.

#### HTTP Collector

```typescript
import { createHttpCollector } from '@trazze/sdk'

const http = createHttpCollector()

http.record({ method: 'GET', path: '/api/users', status: 200, durationMs: 14 })

http.all()      // all entries
http.slow(200)  // entries where durationMs > 200ms
```

#### Query Collector

Detects N+1 patterns automatically:

```typescript
import { createQueryCollector } from '@trazze/sdk'

const queries = createQueryCollector()

queries.record({ sql: 'SELECT * FROM posts WHERE user_id = ?', bindings: [1], durationMs: 5 })
queries.record({ sql: 'SELECT * FROM posts WHERE user_id = ?', bindings: [2], durationMs: 4 })

queries.warnings()
// [{ sql: 'SELECT * FROM posts WHERE user_id = ?', count: 2, type: 'n-plus-one' }]
```

#### Event Collector

```typescript
import { createEventCollector } from '@trazze/sdk'

const events = createEventCollector()
events.record({ name: 'order.placed', payload: { orderId: 42 }, durationMs: 2 })

events.all()
events.for('order.placed')  // filter by event name
```

#### Cache Collector

```typescript
import { createCacheCollector } from '@trazze/sdk'

const cache = createCacheCollector()
cache.record({ operation: 'miss', key: 'users:page:1', durationMs: 0.5 })
cache.record({ operation: 'put',  key: 'users:page:1', durationMs: 1.2 })
cache.record({ operation: 'hit',  key: 'users:page:1', durationMs: 0.3 })

cache.summary()
// { hits: 1, misses: 1, puts: 1, forgets: 0, total: 3 }
```

---

<a name="global-helpers"></a>
### Global Helpers

When `@trazze/sdk` is first imported, it registers `dump`, `dd`, and `trace` on `globalThis`. This means you can call them anywhere in your codebase during debugging without importing  the framework's boot process handles the initialisation automatically.them 

```typescript
// No import needed after Trazze has been initialised
dump({ userId: 1, role: 'admin' })
dd(suspiciousValue)
const stop = trace('render page')
```

> [!WARNING]
> Remove all `dump`, `dd`, and `trace` calls before deploying to production, or gate them behind `env.APP_DEBUG === 'true'`.

---

<a name="lumiarq-adapter"></a>
## LumiARQ  `@trazze/adapter-lumiarq`Adapter 

The adapter wires Trazze into a LumiARQ application with minimal boilerplate. It provides four building blocks:

```typescript
import {
  createTrazeAdapter,
  withTraceAction,
  withTraceQuery,
  withErrorReporter,
  createTrazeHonoMiddleware,
} from '@trazze/adapter-lumiarq'
```

---

<a name="createtrazeadapter"></a>
### `createTrazeAdapter(options)`

Factory that creates the shared logger, pre-configured to send log entries to the Trazze ingest API. Returns `{ logger }`.

```typescript
import { createTrazeAdapter } from '@trazze/adapter-lumiarq'
import { env } from './env.js'

export const { logger } = createTrazeAdapter({
  endpoint:    env.TRAZZE_ENDPOINT,   // e.g. http://localhost:4000/v1/ingest
  apiKey:      env.TRAZZE_API_KEY,
  project:     env.TRAZZE_PROJECT ?? 'my-app',
  environment: env.NODE_ENV ?? 'production',
})
```

`TrazeAdapterOptions`:

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `endpoint` | `string` | Yes | Trazze server ingest URL |
| `apiKey` | `string` | Yes | Bearer API key |
| `project` | `string` | Yes | Project  tags all events |slug 
| `environment` | `string` | No | Environment label, default `'production'` |
| `channel` | `Channel` | No | Override transport (useful in tests with `createMemoryChannel()`) |
| `captureErrors` | `boolean` | No | Auto-register error listeners (default `true`) |
| `captureHttp` | `boolean` | No | Auto-add HTTP middleware (default `true`) |

---

<a name="http-capture-middleware"></a>
### HTTP Capture Middleware

`createTrazeHonoMiddleware(logger)` returns a Hono-compatible middleware that records every HTTP  method, path, status code, and  as a structured log entry.duration request 

```typescript
// bootstrap/entry.ts
import { boot } from '@lumiarq/framework/runtime'
import { createTrazeAdapter, createTrazeHonoMiddleware } from '@trazze/adapter-lumiarq'
import { env } from './env.js'

const { logger } = createTrazeAdapter({ ... })

export default boot({
  afterBoot: (app) => {
    app.router.use('*', createTrazeHonoMiddleware(logger))
  },
})
```

Each HTTP log entry looks like:

```json
{
  "level": "info",
  "message": "GET /api/users 200",
  "context": {
    "http": { "method": "GET", "path": "/api/users", "status": 200, "durationMs": 14.2 }
  }
}
```

The middleware fires-and- it never blocks response delivery.forgets 

---

<a name="action-and-query-tracing"></a>
### Action and Query Tracing

`withTraceAction` and `withTraceQuery` wrap existing action/query functions and emit a structured log entry on every call, including duration and success/failure status.

```typescript
import { withTraceAction, withTraceQuery } from '@trazze/adapter-lumiarq'
import { createUserAction } from './logic/actions/create-user.action.js'
import { getUsersQuery } from './logic/queries/get-users.query.js'

// Wrap  use the traced version everywhereonce 
export const tracedCreateUser = withTraceAction('createUser', createUserAction, logger)
export const tracedGetUsers   = withTraceQuery('getUsers', getUsersQuery, logger)
```

On success, logs:
```json
{ "level": "info", "message": "action:createUser completed", "context": { "action": { "name": "createUser", "durationMs": 23, "status": "ok" } } }
```

On failure, logs at `error` level with the error message, then re-throws so the handler's error handling is unaffected.

---

<a name="automatic-error-reporter"></a>
### Automatic Error Reporter

`withErrorReporter(logger)` attaches `uncaughtException` and `unhandledRejection` listeners to the Node.js process and forwards every unhandled error to the Trazze logger. Returns a cleanup function to remove the listeners on shutdown.

```typescript
import { withErrorReporter } from '@trazze/adapter-lumiarq'

const cleanup = withErrorReporter(logger)

// In graceful shutdown handler:
process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})
```

---

<a name="full-bootstrap-example"></a>
### Full Bootstrap Example

```typescript
// bootstrap/providers.ts
import { createTrazeAdapter, createTrazeHonoMiddleware, withErrorReporter } from '@trazze/adapter-lumiarq'
import { env } from './env.js'

const { logger } = createTrazeAdapter({
  endpoint:    env.TRAZZE_ENDPOINT ?? '',
  apiKey:      env.TRAZZE_API_KEY ?? '',
  project:     env.TRAZZE_PROJECT ?? 'my-app',
  environment: env.NODE_ENV ?? 'production',
})

// Register global error reporter
const cleanupErrors = withErrorReporter(logger)

export { logger, cleanupErrors }
export const traceMiddleware = createTrazeHonoMiddleware(logger)

// bootstrap/entry.ts
import { boot } from '@lumiarq/framework/runtime'
import { traceMiddleware, cleanupErrors } from './providers.js'

export default boot({
  afterBoot: (app) => {
    app.router.use('*', traceMiddleware)
  },
  onShutdown: async () => {
    cleanupErrors()
  },
})
```

---

<a name="ignition"></a>
## Ignition Error  `@trazze/ignite`Pages 

`@trazze/ignite` renders rich, Ignition-style error pages in  with parsed stack frames, syntax-highlighted source snippets, editor deep-links, and automatic push of error events to the Trazze dashboard.development 

### Installation

```bash
pnpm add -D @trazze/ignite
```

---

<a name="handleignitionerror"></a>
### `handleIgnitionError`

Wire it into LumiARQ's `boot()` `onError` hook. In development it returns a full HTML error page; in production it returns a plain-text 500 and emits a structured log entry to any attached Trazze channel.

```typescript
// bootstrap/entry.ts
import { boot } from '@lumiarq/framework/runtime'
import { handleIgnitionError } from '@trazze/ignite'

export default boot({
  onError: handleIgnitionError,
})
```

The error page shows:
- Error class name and message
- Full parsed stack trace with file, line, and column numbers
- Source context (3 lines before and after the error line)
- Vendor-frame collapsing (node_modules frames are hidden by default)
- Editor deep-link buttons to open the offending line directly in your IDE

---

<a name="pushtotrazze"></a>
### `pushToTrazze`

`handleIgnitionError` automatically calls `pushToTrazze()` to forward the structured error payload to the Trazze ingest API. You can also call it directly:

```typescript
import { pushToTrazze } from '@trazze/ignite'

try {
  await riskyOperation()
} catch (err) {
  if (err instanceof Error) {
    await pushToTrazze(err, request)
  }
  throw err
}
```

`pushToTrazze` is a no-op if `TRAZZE_URL` or `TRAZZE_API_KEY` are not  it never throws.set 

Environment variables read by `pushToTrazze`:

| Variable | Description |
|----------|-------------|
| `TRAZZE_URL` | Trazze server base URL (e.g. `http://localhost:4000`) |
| `TRAZZE_API_KEY` | API key for the `x-api-key` header |
| `TRAZZE_PROJECT` | Project slug (default: `'default'`) |
| `APP_ENV` / `NODE_ENV` | Environment label sent with every error event |

---

<a name="editor-deep-links"></a>
### Editor Deep-Links

Set the `TRAZZE_EDITOR` environment variable to enable clickable stack frame links that open files directly in your IDE:

```bash
TRAZZE_EDITOR=cursor   # Cursor
TRAZZE_EDITOR=vscode   # VS Code
TRAZZE_EDITOR=webstorm # WebStorm / PhpStorm
TRAZZE_EDITOR=sublime  # Sublime Text
```

Supported values: `vscode`, `cursor`, `phpstorm`, `webstorm`, `sublime`, `textmate`, `atom`.

If `TRAZZE_EDITOR` is not set, Ignite falls back to the `$EDITOR` environment variable and attempts to detect the editor from the executable path.

---

<a name="trazze-cli"></a>
## The Trazze  `@trazze/cli`CLI 

The `traze` CLI connects to a running Trazze server and lets you inspect event streams from the terminal.

```bash
pnpm add -g @trazze/cli
```

### Commands

#### `traze tail`

Stream live log entries from the Trazze server to your terminal:

```bash
traze tail
traze tail --project my-app
traze tail --level error
traze tail --project my-app --level warn
```

#### `traze search`

Search historical log entries:

```bash
traze search "payment failed"
traze search "card_declined" --from "2026-04-01" --to "2026-04-15"
traze search --level error --project billing-api
```

#### `traze status`

Show connection status and project stats:

```bash
traze status
```

Configure the CLI with environment variables or a `.traze` config file:

```bash
TRAZZE_URL=http://localhost:4000
TRAZZE_API_KEY=your-key
TRAZZE_PROJECT=my-app
```

---

<a name="environment-variables"></a>
## Environment Variables

| Variable | Package | Description |
|----------|---------|-------------|
| `TRAZZE_URL` | ignite, cli | Trazze server base URL |
| `TRAZZE_API_KEY` | ignite, adapter | API key for authentication |
| `TRAZZE_PROJECT` | ignite, adapter | Project slug for event tagging |
| `TRAZZE_EDITOR` | ignite | Editor for stack frame deep-links |
| `APP_ENV` / `NODE_ENV` | ignite, adapter | Environment label (production/staging/local) |
| `TRAZZE_ENDPOINT` | adapter | Full ingest URL (`TRAZZE_URL` + `/v1/ingest`) |
