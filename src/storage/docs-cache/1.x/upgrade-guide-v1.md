---
title: Upgrade Guide — v1.0
description: Upgrading your Lumiarq application from v0.x (beta) to v1.0
section: Prologue
order: 4
draft: false
---

# Upgrade Guide — v1.0

## Table of Contents

- [Introduction](#introduction)
- [High-Impact Breaking Changes](#breaking-changes)
  - [defineRoute() Removed](#define-route-removed)
  - [velo/* Packages Removed](#velo-packages-removed)
  - [bootstrap/providers.ts Now Required](#providers-required)
  - [Config Files Use satisfies Pattern](#config-satisfies)
  - [Global Middleware Moved to bootstrap/middleware.ts](#global-middleware)
- [New in v1.0](#new-in-v1)
- [Step-by-Step Migration](#migration-steps)
- [Testing Your Upgrade](#testing-upgrade)

---

<a name="introduction"></a>
## Introduction

LumiARQ v1.0 is the first stable release of the framework. It brings real, production-grade service drivers, a richer CLI, a stabilised public API, and a set of breaking changes that clean up the rough edges from the beta period.

This guide covers every breaking change and provides concrete before/after code examples for each. Most applications will complete the upgrade in under two hours.

### Estimated Migration Time

| Application size | Estimated time |
|-----------------|---------------|
| Small (< 10 modules) | 30–60 minutes |
| Medium (10–30 modules) | 1–3 hours |
| Large (30+ modules) | 3–8 hours |

### Prerequisites

- Node.js 20.x or later (Node 18 LTS is still supported but Node 20 is recommended)
- pnpm 8.x or later (or npm 10 / yarn 4)
- A passing test suite on v0.x before you begin

---

<a name="breaking-changes"></a>
## High-Impact Breaking Changes

<a name="define-route-removed"></a>
### 1. `defineRoute()` Removed — Use `Route` DSL

**Impact: All applications**

In v0.x, routes were registered using `defineRoute()`:

```typescript
// ❌ v0.x — no longer works
import { defineRoute } from '@lumiarq/framework'

defineRoute({
  method:  'GET',
  path:    '/users/:id',
  handler: getUser,
})
```

In v1.0, use the `Route` class DSL imported from `@lumiarq/framework/core`. This is the same API used throughout the v1.0 documentation:

```typescript
// ✅ v1.0
import { Route } from '@lumiarq/framework/core'

Route.get('/users/:id', getUser)
Route.post('/users', createUser)
Route.put('/users/:id', updateUser)
Route.delete('/users/:id', deleteUser)
Route.patch('/users/:id', patchUser)
```

Group related routes with a prefix:

```typescript
Route.group('/users', () => {
  Route.get('/',    listUsers)
  Route.post('/',   createUser)
  Route.get('/:id', getUser)
  Route.put('/:id', updateUser)
})
```

**How to migrate:**

Run the following search to find all `defineRoute` usages:

```bash
grep -r "defineRoute" src/ --include="*.ts" -l
```

Replace each call with the equivalent `Route.*()` method. No logic changes are needed — only the registration syntax changes.

---

<a name="velo-packages-removed"></a>
### 2. `velo/*` Packages Removed — Import from `@lumiarq/framework`

**Impact: All applications**

In v0.x, internal beta packages were published under `@lumiarq/velo/*`. These packages no longer exist. All exports have been consolidated into `@lumiarq/framework` and its sub-paths.

**Import migration table:**

| v0.x import | v1.0 import |
|------------|-------------|
| `@lumiarq/velo/core` | `@lumiarq/framework/core` |
| `@lumiarq/velo/runtime` | `@lumiarq/framework/runtime` |
| `@lumiarq/velo/testing` | `@lumiarq/framework/testing` |
| `@lumiarq/velo/contracts` | `@lumiarq/framework` (type re-exports) |
| `@lumiarq/velo/http` | `@lumiarq/framework/core` |
| `@lumiarq/velo/queue` | `@lumiarq/framework/runtime` |

**Bulk migration with sed:**

```bash
# Replace all @lumiarq/velo/* imports
find src -name '*.ts' -exec sed -i \
  -e "s|@lumiarq/velo/core|@lumiarq/framework/core|g" \
  -e "s|@lumiarq/velo/runtime|@lumiarq/framework/runtime|g" \
  -e "s|@lumiarq/velo/testing|@lumiarq/framework/testing|g" \
  -e "s|@lumiarq/velo/contracts|@lumiarq/framework|g" \
  -e "s|@lumiarq/velo/http|@lumiarq/framework/core|g" \
  -e "s|@lumiarq/velo/queue|@lumiarq/framework/runtime|g" \
  {} +
```

Then remove the old package references from `package.json`:

```bash
pnpm remove @lumiarq/velo
```

---

<a name="providers-required"></a>
### 3. `bootstrap/providers.ts` Is Now Required

**Impact: Applications missing this file**

In v0.x, `bootstrap/providers.ts` was optional — you could wire dependencies directly in your handlers. In v1.0, this file is **required** because:

- CLI commands (`lumis schedule:list`, `lumis worker:list`, `lumis db:seed`) import it to resolve registered services
- The framework's health check reads it to verify driver configuration
- It is the canonical place to instantiate and export service drivers

**Create the file if it does not exist:**

```typescript
// bootstrap/providers.ts
import { SMTPMailer, BullMQQueue, LocalStorage } from '@lumiarq/framework/runtime'
import { env } from '@lumiarq/framework'

export const mailer = new SMTPMailer({
  host: env('MAIL_HOST', 'localhost'),
  port: Number(env('MAIL_PORT', '1025')),
  auth: {
    user: env('MAIL_USERNAME', ''),
    pass: env('MAIL_PASSWORD', ''),
  },
  defaults: { from: env('MAIL_FROM', 'noreply@example.com') },
})

export const queue = new BullMQQueue({
  connection: {
    host:     env('REDIS_HOST', '127.0.0.1'),
    port:     Number(env('REDIS_PORT', '6379')),
    password: env('REDIS_PASSWORD'),
  },
})

export const storage = new LocalStorage({
  root:      'storage/app',
  publicUrl: env('APP_URL', 'http://localhost:3000') + '/storage',
})
```

---

<a name="config-satisfies"></a>
### 4. Config Files Now Use the `satisfies` Pattern

**Impact: Applications with typed config files**

In v0.x, config files were typed via generic annotations:

```typescript
// ❌ v0.x
import type { DatabaseConfig } from '@lumiarq/framework'

const config: DatabaseConfig = {
  // ...
}

export default config
```

In v1.0, config files use the `satisfies` operator (TypeScript 4.9+) so that the type is checked at declaration time while the inferred type flows through to consumers:

```typescript
// ✅ v1.0
import type { DatabaseConfig } from '@lumiarq/framework'

export default {
  client:     'postgresql',
  connection: { ... },
  migrations: { directory: './database/migrations' },
} satisfies DatabaseConfig
```

The difference is subtle but important: `satisfies` checks the shape without widening the type, so `config.client` is inferred as `'postgresql'` instead of `string`. This enables better auto-complete throughout your codebase.

**How to migrate:** Run a search-replace across your `config/` directory, changing `: ConfigType = {` to `} satisfies ConfigType`. The scaffold command `lumis publish config all` generates v1.0-style config files you can use as reference.

---

<a name="global-middleware"></a>
### 5. Global Middleware Moved to `bootstrap/middleware.ts`

**Impact: Applications using global or module-level middleware**

In v0.x, some patterns allowed defining global middleware either in `bootstrap/entry.ts` inline or in individual module route files via a root-level `middleware` array:

```typescript
// ❌ v0.x — inline in entry.ts
const app = createApp({
  router,
  middleware: [corsMiddleware, authMiddleware, rateLimitMiddleware],
})

// ❌ v0.x — root-level middleware array in a module's routes.ts
export const middleware = [corsMiddleware]
export const routes = [...]
```

In v1.0, **all global middleware is registered in `bootstrap/middleware.ts`**. Module-level middleware arrays at the root level are no longer supported — use route groups with per-group middleware instead.

```typescript
// ✅ v1.0 — bootstrap/middleware.ts
import {
  cors,
  rateLimit,
  requestId,
  securityHeaders,
} from '@lumiarq/framework/middleware'
import type { MiddlewareStack } from '@lumiarq/framework'

export const middleware: MiddlewareStack = [
  requestId(),
  securityHeaders(),
  cors({ origin: process.env.CORS_ORIGIN ?? '*' }),
  rateLimit({ max: 100, windowMs: 60_000 }),
]
```

```typescript
// ✅ v1.0 — bootstrap/entry.ts
import { createApp }  from '@lumiarq/framework/core'
import { middleware } from './middleware.js'
import { router }     from './router.js'

export default createApp({ router, middleware })
```

For module-specific middleware, use route groups:

```typescript
// ✅ v1.0 — module-specific middleware via route groups
Route.group('/admin', () => {
  Route.get('/users',   listUsers)
  Route.delete('/users/:id', deleteUser)
}, {
  middleware: [requireAdmin],
})
```

---

<a name="new-in-v1"></a>
## New in v1.0

v1.0 ships a large number of new capabilities alongside the breaking changes.

### Real Service Drivers

All service contracts now have first-party production drivers:

| Contract | v0.x | v1.0 Drivers |
|----------|------|-------------|
| Mailer | In-memory only | `SMTPMailer`, `ResendMailer` |
| Queue | In-memory only | `BullMQQueue` |
| Worker | None | `BullMQWorker` |
| Storage | None | `LocalStorage`, `S3Storage` |
| Cache | None | `RedisCacheDriver`, `MemoryCacheDriver` |
| Scheduler | None | `CronScheduler` |

### NotificationService

Multi-channel notification dispatcher built on top of the mailer and queue:

```typescript
import { NotificationService } from '@lumiarq/framework/runtime'

const notifications = new NotificationService({ mailer, queue })

// Send immediately
await notifications.send(new WelcomeNotification(), user)

// Send via queue
await notifications.sendQueued(new PasswordResetNotification(url), user)

// Fan out to many recipients
await notifications.sendBulk(new NewsletterNotification(), subscribers)
```

See [Notifications](/notifications) for the full guide.

### DatabaseAudit

Automatic audit logging for database mutations. Attach it to any table to log who changed what and when:

```typescript
import { DatabaseAudit } from '@lumiarq/framework/runtime'

const audit = new DatabaseAudit({ db, table: auditLogs })

// In a handler or action
await audit.log({
  userId:    ctx.state.userId,
  action:    'update',
  entity:    'Post',
  entityId:  post.id,
  before:    originalPost,
  after:     updatedPost,
})
```

### `parseBody()` / `parseQuery()` with Zod

Validate and parse incoming request data in a single call:

```typescript
import { parseBody, parseQuery } from '@lumiarq/framework/runtime'

// Throws ValidationError automatically on failure
const body  = await parseBody(ctx.request, createPostSchema)
const query = parseQuery(ctx.request, listQuerySchema)
```

### `defineResource()` Transformer Factory

Shape API responses with a typed transformer. See [API Resources](/api-resources).

```typescript
import { defineResource } from '@lumiarq/framework/core'

export const UserResource = defineResource<User, PublicUser>((user) => ({
  id:       user.id,
  name:     user.name,
  joinedAt: user.createdAt.toISOString(),
}))

UserResource.make(user)
UserResource.collection(users)
UserResource.paginated(paginatedResult)
```

### `defineExceptionHandler()` + HttpException Hierarchy

Register a global exception handler and use typed HTTP exception classes. See [Exception Handling](/exception-handling).

```typescript
import {
  defineExceptionHandler,
  NotFoundError,
  ValidationError,
} from '@lumiarq/framework/runtime'

export const exceptionHandler = defineExceptionHandler(async (error, ctx) => {
  if (error instanceof NotFoundError) {
    return ctx.json({ error: error.message }, 404)
  }
})
```

### Per-Route Throttle Middleware

Apply rate limiting to individual routes using a named middleware string:

```typescript
Route.post('/auth/login', login).middleware('lumiarq.throttle:5,1')
//                                                              ↑ ↑
//                                                       max   window (minutes)
```

### Deprecation and Sunset Headers

Mark routes as deprecated with automatic response headers:

```typescript
Route.get('/v1/users', listUsersV1).deprecated({
  sunset:      '2026-01-01',
  replacement: '/v2/users',
})
// Adds: Deprecation: true
//       Sunset: Wed, 01 Jan 2026 00:00:00 GMT
//       Link: </v2/users>; rel="successor-version"
```

### New CLI Commands

| Command | Description |
|---------|-------------|
| `lumis publish config <name>` | Generate config file stubs |
| `lumis worker:start [--dev]` | Start the background worker process |
| `lumis worker:list` | List registered workers and scheduled jobs |
| `lumis schedule:list` | List all scheduled jobs with next run times |
| `lumis schedule:run <name>` | Run a scheduled job immediately |
| `lumis db:seed` | Run database seeders |
| `lumis db:fresh` | Drop all tables, re-run migrations, seed |
| `lumis db:reset` | Re-run migrations without dropping |
| `lumis db:studio` | Open Drizzle Studio |
| `lumis health` | Validate config files and driver connectivity |

---

<a name="migration-steps"></a>
## Step-by-Step Migration

Follow these steps in order to upgrade your application from v0.x to v1.0.

### Step 1 — Update Dependencies

```bash
pnpm remove @lumiarq/velo
pnpm add @lumiarq/framework@^1.0.0
pnpm add -D lumis@^1.0.0
```

If you use the Drizzle adapter:

```bash
pnpm add @lumiarq/drizzle@^1.0.0
```

### Step 2 — Generate Config Stubs

```bash
lumis publish config all
```

This generates config stubs under `config/` for all known service contracts. Review each file and fill in environment-specific values. Do not overwrite existing config files — the command will skip files that already exist unless you pass `--force`.

### Step 3 — Update Imports

Run the bulk import replacement from the [breaking changes section](#velo-packages-removed):

```bash
find src -name '*.ts' -exec sed -i \
  -e "s|@lumiarq/velo/core|@lumiarq/framework/core|g" \
  -e "s|@lumiarq/velo/runtime|@lumiarq/framework/runtime|g" \
  -e "s|@lumiarq/velo/testing|@lumiarq/framework/testing|g" \
  -e "s|@lumiarq/velo/contracts|@lumiarq/framework|g" \
  {} +
```

Verify with TypeScript:

```bash
pnpm tsc --noEmit
```

Fix any remaining import errors before proceeding.

### Step 4 — Move Global Middleware

Create `bootstrap/middleware.ts` and move any global middleware out of `bootstrap/entry.ts` and module route files:

```typescript
// bootstrap/middleware.ts
import {
  cors,
  rateLimit,
  requestId,
  securityHeaders,
  compress,
} from '@lumiarq/framework/middleware'
import type { MiddlewareStack } from '@lumiarq/framework'

export const middleware: MiddlewareStack = [
  requestId(),
  securityHeaders(),
  cors({ origin: process.env.CORS_ORIGIN }),
  compress(),
  rateLimit({ max: 200, windowMs: 60_000 }),
]
```

Update `bootstrap/entry.ts`:

```typescript
// bootstrap/entry.ts
import { createApp }  from '@lumiarq/framework/core'
import { middleware } from './middleware.js'
import { router }     from './router.js'
import { exceptionHandler } from '#exceptions/exceptionHandler.js'

export default createApp({ router, middleware, exceptionHandler })
```

### Step 5 — Replace `defineRoute()` Calls

Search for `defineRoute`:

```bash
grep -r "defineRoute" src/ --include="*.ts"
```

Replace each call with the `Route` DSL. Example conversion:

```typescript
// Before
defineRoute({ method: 'GET',    path: '/posts',     handler: listPosts   })
defineRoute({ method: 'POST',   path: '/posts',     handler: createPost  })
defineRoute({ method: 'GET',    path: '/posts/:id', handler: getPost     })
defineRoute({ method: 'PUT',    path: '/posts/:id', handler: updatePost  })
defineRoute({ method: 'DELETE', path: '/posts/:id', handler: deletePost  })

// After
Route.group('/posts', () => {
  Route.get('/',    listPosts)
  Route.post('/',   createPost)
  Route.get('/:id', getPost)
  Route.put('/:id', updatePost)
  Route.delete('/:id', deletePost)
})
```

### Step 6 — Update `bootstrap/providers.ts`

Replace any in-memory or stub drivers with real v1.0 drivers. Here is a complete providers file for a typical v1.0 application:

```typescript
// bootstrap/providers.ts
import {
  SMTPMailer,
  ResendMailer,
  BullMQQueue,
  LocalStorage,
  S3Storage,
  RedisCacheDriver,
  NotificationService,
} from '@lumiarq/framework/runtime'
import { env } from '@lumiarq/framework'

// ─── Mailer ──────────────────────────────────────────────────────────────────

export const mailer = env('MAIL_DRIVER') === 'resend'
  ? new ResendMailer({ apiKey: env('RESEND_API_KEY') })
  : new SMTPMailer({
      host:     env('MAIL_HOST', 'localhost'),
      port:     Number(env('MAIL_PORT', '1025')),
      secure:   env('MAIL_SECURE', 'false') === 'true',
      auth:     {
        user: env('MAIL_USERNAME', ''),
        pass: env('MAIL_PASSWORD', ''),
      },
      defaults: {
        from: `${env('MAIL_FROM_NAME', 'App')} <${env('MAIL_FROM_ADDRESS', 'noreply@example.com')}>`,
      },
    })

// ─── Queue ───────────────────────────────────────────────────────────────────

const redisConnection = {
  host:     env('REDIS_HOST', '127.0.0.1'),
  port:     Number(env('REDIS_PORT', '6379')),
  password: env('REDIS_PASSWORD'),
}

export const queue = new BullMQQueue({
  connection:   redisConnection,
  defaultQueue: 'default',
})

// ─── Cache ───────────────────────────────────────────────────────────────────

export const cache = new RedisCacheDriver({
  connection: redisConnection,
  prefix:     env('CACHE_PREFIX', 'lumiarq:cache:'),
})

// ─── Storage ─────────────────────────────────────────────────────────────────

export const storage = env('STORAGE_DISK') === 's3'
  ? new S3Storage({
      bucket:          env('AWS_BUCKET'),
      region:          env('AWS_REGION', 'us-east-1'),
      accessKeyId:     env('AWS_ACCESS_KEY_ID'),
      secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
      endpoint:        env('AWS_ENDPOINT'),
    })
  : new LocalStorage({
      root:      'storage/app',
      publicUrl: env('APP_URL', 'http://localhost:3000') + '/storage',
    })

// ─── Notifications ───────────────────────────────────────────────────────────

export const notifications = new NotificationService({ mailer, queue })
```

### Step 7 — Set Environment Variables

Ensure your `.env` file (and your production environment's secrets) includes variables for all the drivers you've configured. At minimum:

```bash
# App
APP_URL=http://localhost:3000
APP_KEY=your-32-char-secret-key

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

# Redis (for queue + cache)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Mail (choose one)
MAIL_DRIVER=smtp
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM_ADDRESS=noreply@example.com
MAIL_FROM_NAME=MyApp

# Storage
STORAGE_DISK=local
```

---

<a name="testing-upgrade"></a>
## Testing Your Upgrade

### Run the Framework Health Check

```bash
lumis health
```

This command:

1. Validates all `config/*.ts` files against their expected types
2. Checks that `bootstrap/providers.ts` exists and exports the expected contracts
3. Tests connectivity for each configured driver (database, Redis, S3)
4. Lists any missing or misconfigured environment variables

Example output after a successful migration:

```
✓ config/app.ts       — valid
✓ config/database.ts  — valid
✓ config/queue.ts     — valid
✓ config/storage.ts   — valid
✓ bootstrap/providers.ts — mailer, queue, storage, notifications

✓ Database — connected (postgresql @ localhost:5432)
✓ Redis    — connected (127.0.0.1:6379)
✓ Storage  — local disk at storage/app

All checks passed.
```

### Run Your Test Suite

```bash
pnpm test
```

If tests fail after the upgrade, common causes are:

- **Missing `FakeQueue` / `FakeMailer` imports** — these moved from `@lumiarq/velo/testing` to `@lumiarq/framework/testing`
- **`withTestContext` signature changed** — the second argument is now always a callback
- **Handler tests expecting old error shapes** — update assertions to match the new `HttpException` JSON format `{ error, status }`

### TypeScript Compilation

Always finish the upgrade with a clean TypeScript compile:

```bash
pnpm tsc --noEmit
```

Zero errors is the goal. Do not proceed to production deployment with TypeScript errors present.
