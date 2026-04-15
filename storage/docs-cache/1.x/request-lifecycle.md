---
title: Request Lifecycle
description: How an HTTP request flows through the Lumiarq framework from entry to response
section: Architecture Concepts
order: 1
draft: false
---

# Request Lifecycle

- [Introduction](#introduction)
- [Lifecycle at a glance](#lifecycle-at-a-glance)
- [Entry point](#entry-point)
- [Middleware pipeline](#middleware-pipeline)
- [Handler execution](#handler-execution)
- [Context propagation](#context-propagation)
- [Response](#response)
- [Error propagation](#error-propagation)

<a name="introduction"></a>
## Introduction

Every HTTP request that arrives at a LumiARQ application travels through a well-defined sequence of steps before a response is returned. Understanding this sequence helps you reason about where to place middleware, how context propagates, and what guarantees each layer provides.

<a name="lifecycle-at-a-glance"></a>
## Lifecycle at a glance

```
Incoming request (HTTP / Cloudflare fetch)
      │
      ▼
bootstrap/entry.ts
  ├─ 1. env validation  (Zod schema — exits on failure)
  ├─ 2. provider boot   (binds contracts to implementations)
  └─ 3. set ambient ctx (AsyncLocalStorage fallback for jobs)
      │
      ▼
Hono router — middleware pipeline (runs in order, top to bottom)
  ├─ trust-proxies
  ├─ maintenance
  ├─ security-headers
  ├─ session
  ├─ locale
  ├─ csrf
  ├─ request-id
  ├─ cors
  ├─ rate-limit
  └─ cache-control
      │
      ▼
Route match → Handler function
  ├─ reads request (ctx.req.param, ctx.req.json, …)
  ├─ delegates to Queries (reads) and Actions (writes)
  └─ returns Response
      │
      ▼
Middleware pipeline (reverse order — onResponse hooks)
  ├─ cache-control appends Cache-Control header
  ├─ request-id echoes X-Request-Id
  ├─ cors appends Access-Control-* headers
  ├─ security-headers appends defensive headers
  └─ flash middleware encodes flash data
      │
      ▼
Platform adapter writes response to socket / returns from fetch handler
```

---

---

<a name="entry-point"></a>
## Entry point

All incoming traffic is handled by `bootstrap/entry.ts`. This file is the single import that the runtime adapter (Node.js or Cloudflare Workers) loads at cold-start. It performs three things in order:

1. **Environment validation** — `bootstrap/env.ts` runs a Zod schema check against `process.env`. If any required variable is missing or malformed, the process exits with a human-readable error before accepting a single connection.
2. **Provider boot** — `bootstrap/providers.ts` registers all service providers. Providers bind concrete implementations against contracts (`MailerContract`, `QueueContract`, `StorageContract`, etc.) in the service container. This is the only place where implementation details (SMTP driver, S3 adapter, Redis queue) are resolved.
3. **Application context** — `setApplicationContext(ctx)` from `@lumiarq/runtime` stores a boot-time fallback context in the runtime's async-local-storage layer. Subsequent calls to `getContext()` that fire outside a live request (e.g. from a scheduled job) resolve to this ambient context rather than throwing.

After boot, the adapter hands the Hono application instance to the platform (an HTTP server for Node.js, an `ExportedHandler` for Cloudflare Workers) and begins accepting connections.

---

<a name="middleware-pipeline"></a>
## Middleware pipeline

Each request passes through a fixed middleware pipeline before reaching your handler. The pipeline order is:

```
trust-proxies
  └─ maintenance
       └─ security-headers
            └─ session
                 └─ locale
                      └─ csrf
                           └─ request-id
                                └─ cors
                                     └─ rate-limit
                                          └─ cache-control
                                               └─ handler
```

### trust-proxies

Rewrites `req.socket.remoteAddress`, the `Host` header, and the protocol using `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`. All subsequent middleware and handlers see the correct client IP and scheme. Configured via `config/security.ts` (`trustedProxies`).

### maintenance

Reads a `.maintenance` flag file (managed by `lumis down` / `lumis up`). If the flag is present, the middleware short-circuits the pipeline and returns a `503 Service Unavailable` response — or a bypass response for requests carrying a valid maintenance token.

### security-headers

Sets defensive HTTP response headers on every response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a configurable `Content-Security-Policy`. Configured via `config/security.ts` (`headers`).

### session

Loads or creates the session for the current request. The session is backed by whichever `SessionStore` implementation was registered in `bootstrap/providers.ts` (in-memory by default, Redis or database in production). The session object is attached to the request context and is available in all subsequent middleware and handlers as `ctx.session`.

### locale

Resolves the active locale from, in order of priority: the `Accept-Language` header, a `locale` query parameter, or the user's session. Sets `ctx.locale` and makes it available for `t()` translation calls throughout the request.

### csrf

Validates the CSRF token on all state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) that arrive on `*.web.ts` routes. API routes (files ending in `*.api.ts`) bypass this middleware entirely — they rely on JWT bearer tokens instead. Tokens are stored in the session and compared with the `_token` body field or the `X-CSRF-Token` header.

### request-id

Assigns a unique identifier to the request. If the incoming request carries an `X-Request-Id` header and the value is a valid UUID, that value is used as-is (useful for tracing in reverse-proxy setups). Otherwise a new UUID v4 is generated. The ID is stored on the context and echoed back in the `X-Request-Id` response header.

### cors

Applies Cross-Origin Resource Sharing headers. On pre-flight `OPTIONS` requests it responds immediately with the configured `Access-Control-Allow-*` headers. On regular requests it appends the appropriate headers to the response. Configured via `config/security.ts` (`cors`).

### rate-limit

Enforces per-IP (or per-user, once authenticated) request quotas using a sliding-window counter backed by the configured cache store. Returns `429 Too Many Requests` with a `Retry-After` header when the limit is exceeded. Configured via `config/security.ts` (`rateLimit`).

### cache-control

Sets `Cache-Control` response headers according to the route's render strategy. Static (ISR) routes receive a `s-maxage` directive; dynamic routes receive `no-store`. This middleware runs last before the handler so it can read the route metadata that the router resolved.

---

<a name="handler-execution"></a>
## Handler execution

After the middleware pipeline, the router matches the request path and method against the routes registered by all loaded modules. Route files follow the `*.web.ts` / `*.api.ts` naming convention, and the router infers the route type from the file suffix:

- `*.web.ts` — CSRF and session are in scope; the route must use a server-render strategy.
- `*.api.ts` — CSRF is skipped; the route is expected to return JSON.

The matched handler receives a `HandlerContext` object that exposes:

```typescript
ctx.req.json()          // parsed request body
ctx.req.header(name)    // request header
ctx.req.param(name)     // URL path parameter
ctx.req.query(name)     // query string parameter
ctx.bound<T>(name)      // route-model-bound entity (null → auto 404)
ctx.json(data, status?) // JSON response helper
ctx.text(data, status?) // plain-text response helper
ctx.get(key)            // read from context store
ctx.set(key, value)     // write to context store
```

Inside the handler, business logic is invoked through Actions (for writes) and Queries (for reads). Neither the handler nor the middleware layer touches the database directly — that boundary is enforced by the `no-static-repository-methods` ESLint rule and the dispatch-boundary rules in `eslint-plugin-lumivel`.

---

<a name="response"></a>
## Response

Once the handler returns a `Response` object, it travels back up the middleware stack in reverse order. Each middleware that registered an `onResponse` hook (the security-headers, cors, request-id, and cache-control middleware do) has the opportunity to append or modify headers before the response is flushed to the client.

The `flashMiddleware`, when configured, also runs at this stage: it base64-encodes any flash data written during the request and injects it into the `x-flash-data` response header so that the client can read it on the next page load without an additional round-trip.

The final response is handed back to the platform adapter, which writes it to the socket (Node.js) or returns it from the `fetch` handler (Cloudflare Workers).

---

<a name="context-propagation"></a>
## Context propagation

The `ctx` object is the carrier for per-request state. Middleware layers write values with `ctx.set()` and downstream code
— including handlers, actions, and queries — reads them with `ctx.get()`. The context is scoped to the current request via
`AsyncLocalStorage`, so `ctx.set` / `ctx.get` are safe in concurrent environments.

**Example: an authentication middleware writing the resolved user to context**

```ts
// src/shared/middleware/authenticate.ts
import { defineMiddleware } from '@lumiarq/framework'
import { getUserById } from '@modules/Auth/logic/queries/get-user.query'

export const authenticateMiddleware = defineMiddleware(async (ctx, next) => {
  const token   = ctx.req.header('Authorization')?.replace('Bearer ', '')
  const payload = token ? verifyJwt(token) : null

  if (payload) {
    const user = await getUserById({ id: payload.sub })
    ctx.set('user', user)
    ctx.set('userId', user?.id ?? null)
  }

  return next()
})
```

**Reading in the handler:**

```ts
export const UpdateProfileHandler = defineHandler(async (ctx) => {
  const user = ctx.get('user')

  if (!user) return ctx.json({ error: 'Unauthenticated' }, 401)

  const body = await ctx.req.json()
  const updated = await updateProfile({ userId: user.id, ...body })

  return ctx.json({ user: updated })
})
```

**Session access** — The session middleware writes both the session ID and the store reference to context so handlers can
read session state without depending on the session middleware implementation:

```ts
const sessionId    = ctx.get('session_id')    // string
const sessionStore = ctx.get('session_store')  // SessionStore implementation
const session      = await sessionStore.get(sessionId)  // Record<string, unknown>
```

**Locale access:**

```ts
const locale = ctx.get('locale')   // e.g. 'en', 'fr'
```

---

<a name="error-propagation"></a>
## Error propagation

Unhandled errors thrown from middleware or handlers are caught by the global error handler registered in
`bootstrap/entry.ts`. The error handler maps typed framework errors to HTTP status codes:

| Error class            | HTTP status |
|------------------------|-------------|
| `NotFoundError`        | 404         |
| `ValidationError`      | 422         |
| `AuthorizationError`   | 403         |
| `AuthenticationError`  | 401         |
| `ConflictError`        | 409         |
| Any other `Error`      | 500         |

**Throwing typed errors from anywhere in the call stack:**

```ts
import { NotFoundError, AuthorizationError } from '@lumiarq/framework'

// In a query
export const getInvoice = defineQuery(async ({ id }) => {
  const invoice = await repo.findById(id)
  if (!invoice) throw new NotFoundError('Invoice not found.')
  return invoice
})

// In an action
export const voidInvoice = defineAction(async ({ id, actorId }) => {
  const invoice = await repo.findById(id)
  if (!invoice) throw new NotFoundError('Invoice not found.')
  if (invoice.ownerId !== actorId) throw new AuthorizationError('Cannot void this invoice.')
  // ...
})
```

**Customising the global error handler** in `bootstrap/entry.ts`:

```ts
import { createApp } from '@lumiarq/framework'
import { NotFoundError, ValidationError } from '@lumiarq/framework'

const app = createApp()

app.onError((err, ctx) => {
  if (err instanceof NotFoundError) {
    return ctx.expectsJson()
      ? ctx.json({ error: err.message }, 404)
      : ctx.html(renderNotFoundPage(), 404)
  }

  if (err instanceof ValidationError) {
    return ctx.json({ message: err.message, errors: err.errors }, 422)
  }

  // Log unexpected errors
  logger.error({ err, requestId: ctx.get('requestId') }, 'Unhandled error')
  return ctx.json({ error: 'Internal Server Error' }, 500)
})
```

Errors thrown during the middleware pipeline short-circuit the remaining middleware layers and route directly to the error
handler — subsequent middleware `next()` calls are not reached.

