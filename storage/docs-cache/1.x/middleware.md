---
title: Middleware
description: Intercepting requests with middleware functions
section: The Basics
order: 2
draft: false
---

# Middleware

- [Introduction](#introduction)
- [The MiddlewareFn Type](#the-middlewarefn-type)
- [Middleware Execution Order](#middleware-execution-order)
- [Built-In Middleware](#built-in-middleware)
- [Module-Level Middleware](#module-level-middleware)
- [Route-Level Middleware](#route-level-middleware)
- [Writing a Custom Middleware](#writing-a-custom-middleware)
- [Confirm Password Middleware](#confirm-password-middleware)
- [Testing Middleware](#testing-middleware)

<a name="introduction"></a>
## Introduction

Middleware functions run before your handler processes a request. They can read and modify the request, attach data to the context, short-circuit with a response, or simply pass the request on to the next function in the chain.

<a name="the-middlewarefn-type"></a>
## The MiddlewareFn Type

All middleware in Lumiarq conforms to the `MiddlewareFn` type exported from `@lumiarq/framework`:

```ts
import type { MiddlewareFn } from '@lumiarq/framework'

const myMiddleware: MiddlewareFn = async (ctx, next) => {
  // Do work before the handler
  await next()
  // Do work after the handler (e.g. modify response headers)
}
```

`ctx` is the `HandlerContext`. `next` is an async function — call it to proceed to the next middleware or the handler. Not calling `next()` short-circuits the chain and returns the response you set on `ctx`.

<a name="middleware-execution-order"></a>
## Middleware Execution Order

Middleware runs in this order for every request:

1. **Global middleware** — registered in `bootstrap/providers.ts` or the framework boot sequence
2. **Module middleware** — defined in `defineModule({ middleware: [...] })`
3. **Route middleware** — defined in the route options `{ middleware: [...] }`
4. **Handler**

The framework's built-in middleware pipeline runs before any of the above:

```
trust-proxies → maintenance → security-headers → session → locale → csrf → request-id → cors → rate-limit → cache-control → handler
```

<a name="built-in-middleware"></a>
## Built-In Middleware

All built-in middleware is exported from `@lumiarq/framework`.

### Security Headers

Adds sensible default HTTP security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.):

```ts
import { securityHeadersMiddleware } from '@lumiarq/framework'
```

No configuration required for defaults. The middleware is included in the built-in pipeline automatically.

### CORS

```ts
import { corsMiddleware } from '@lumiarq/framework'
import type { CorsOptions } from '@lumiarq/framework'

const cors = corsMiddleware({
  origin: ['https://app.example.com', 'https://admin.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
} satisfies CorsOptions)
```

### Rate Limiting

```ts
import { rateLimitMiddleware } from '@lumiarq/framework'
import type { RateLimitOptions } from '@lumiarq/framework'

const rateLimit = rateLimitMiddleware({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,             // requests per window
  keyBy: (ctx) => ctx.req.header('cf-connecting-ip') ?? 'unknown',
} satisfies RateLimitOptions)
```

### Session

Mounts a session store and makes the session available via `ctx.get('session')`:

```ts
import { sessionMiddleware } from '@lumiarq/framework'
import { InMemorySessionStore } from '@lumiarq/framework'

const session = sessionMiddleware({
  store: new InMemorySessionStore(),
  secret: process.env.SESSION_SECRET!,
  cookieName: 'sid',
})
```

### CSRF Protection

Validates CSRF tokens on mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) in web routes. API routes (JWT-authenticated) are exempt.

```ts
import { csrfMiddleware } from '@lumiarq/framework'

const csrf = csrfMiddleware({ sessionStore: mySessionStore })
```

### Locale

Reads the `Accept-Language` header (or a `locale` query param) and attaches a locale string to the request context:

```ts
import { localeMiddleware } from '@lumiarq/framework'

const locale = localeMiddleware({
  supported: ['en', 'fr', 'de'],
  fallback: 'en',
})
```

Access the resolved locale in handlers:

```ts
const locale = ctx.get('locale') as string
```

### Maintenance Mode

Serves a `503 Service Unavailable` response when maintenance mode is active. Skip specific IPs with `allow`:

```ts
import { maintenanceMiddleware } from '@lumiarq/framework'

const maintenance = maintenanceMiddleware({
  allow: ['127.0.0.1', '::1'],
})
```

Toggle maintenance mode with the CLI:

```bash
pnpm lumis down --secret=my-bypass-secret
pnpm lumis up
```

### Trust Proxies

When running behind a load balancer or reverse proxy, this middleware ensures `ctx.req.header('x-forwarded-for')` and related headers are trusted correctly:

```ts
import { trustProxiesMiddleware } from '@lumiarq/framework'

const trustProxies = trustProxiesMiddleware({ proxies: 1 })
```

<a name="module-level-middleware"></a>
## Module-Level Middleware

Middleware defined on `defineModule` runs after global middleware and before any route middleware, for every request in the module:

```ts
// src/modules/Billing/module.ts
import { defineModule } from '@lumiarq/framework'
import { requireAuth } from '@shared/middleware/require-auth.middleware'
import { requireActiveSubscription } from '@shared/middleware/require-subscription.middleware'

export default defineModule({
  name: 'Billing',
  middleware: [requireAuth, requireActiveSubscription],
})
```

Every route in the `Billing` module will have `requireAuth` and `requireActiveSubscription` applied automatically, without needing to add them to each route individually.

<a name="route-level-middleware"></a>
## Route-Level Middleware

Apply middleware to a single route by passing an array in the route options:

```ts
import { Route } from '@lumiarq/framework'
import { requireRole } from '@shared/middleware/require-role.middleware'

Route.delete('/billing/invoices/:id', deleteInvoiceHandler, {
  name: 'billing.invoices.destroy',
  render: 'traditional',
  middleware: [requireRole('billing:admin')],
})
```

<a name="writing-a-custom-middleware"></a>
## Writing a Custom Middleware

A custom middleware is any function that matches the `MiddlewareFn` signature.

```ts
// src/shared/middleware/require-auth.middleware.ts
import { type MiddlewareFn } from '@lumiarq/framework'
import { verifyJwt } from '@lumiarq/framework/auth'

export const requireAuth: MiddlewareFn = async (ctx, next) => {
  const authHeader = ctx.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return ctx.json({ message: 'Unauthorized.' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    const payload = await verifyJwt(token)
    ctx.set('userId', payload.sub)
    await next()
  } catch {
    return ctx.json({ message: 'Token is invalid or expired.' }, 401)
  }
}
```

The middleware returns a response directly (short-circuiting) when authentication fails, and calls `next()` only when the user is authenticated.

### Middleware with Configuration

Use a factory function when the middleware needs runtime options:

```ts
// src/shared/middleware/require-role.middleware.ts
import type { MiddlewareFn } from '@lumiarq/framework'

export function requireRole(role: string): MiddlewareFn {
  return async (ctx, next) => {
    const userRole = ctx.get('userRole') as string | undefined

    if (userRole !== role) {
      return ctx.json({ message: 'Forbidden.' }, 403)
    }

    await next()
  }
}
```

Usage:

```ts
Route.delete('/admin/users/:id', deleteUserHandler, {
  name: 'admin.users.destroy',
  render: 'traditional',
  middleware: [requireRole('admin')],
})
```

### Modifying the Response After the Handler

Call `await next()` and then modify the context after it returns to add or change response headers:

```ts
import type { MiddlewareFn } from '@lumiarq/framework'

export const addRequestIdHeader: MiddlewareFn = async (ctx, next) => {
  const requestId = crypto.randomUUID()
  ctx.set('requestId', requestId)

  await next()

  ctx.header('X-Request-Id', requestId)
}
```

<a name="confirm-password-middleware"></a>
## Confirm Password Middleware

The built-in `confirmedMiddleware` protects sensitive routes by requiring the user to re-confirm their password within a recent time window. Unconfirmed API requests receive `423 Locked`. Unconfirmed web requests are redirected to the confirm-password page.

```ts
import { confirmedMiddleware } from '@lumiarq/framework'

Route.post('/billing/payment-methods', addPaymentMethodHandler, {
  name: 'billing.payment-methods.store',
  render: 'traditional',
  middleware: [
    confirmedMiddleware({
      window: 3600,          // seconds since last confirmation
      redirectTo: '/auth/confirm-password',
      sessionStore: mySessionStore,
    }),
  ],
})
```

After the user re-enters their password, call `writeConfirmedAt` to record the confirmation timestamp:

```ts
import { writeConfirmedAt } from '@lumiarq/framework'

await writeConfirmedAt(sessionId, store)
```

<a name="testing-middleware"></a>
## Testing Middleware

Middleware functions are plain async functions — test them directly by constructing a minimal context and a `next` function, without spinning up a server.

Lumiarq's `buildTestContext` helper from `@lumiarq/framework/testing` creates a mock `HandlerContext` you can configure with custom headers, set values, and inspect:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildTestContext } from '@lumiarq/framework/testing'
import { requireAuth } from '@shared/middleware/require-auth.middleware'

describe('requireAuth', () => {
  it('calls next() when a valid Bearer token is provided', async () => {
    const ctx  = buildTestContext({
      headers: { Authorization: 'Bearer valid-test-token' },
    })
    const next = vi.fn().mockResolvedValue(undefined)

    // vi.mock the JWT verifier to return a known payload
    vi.mock('@lumiarq/framework/auth', () => ({
      verifyJwt: vi.fn().mockResolvedValue({ sub: 'user_001' }),
    }))

    await requireAuth(ctx, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.get('userId')).toBe('user_001')
  })

  it('returns 401 when no Authorization header is present', async () => {
    const ctx  = buildTestContext({ headers: {} })
    const next = vi.fn()

    const response = await requireAuth(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(response?.status).toBe(401)
  })

  it('returns 401 when the token is malformed', async () => {
    const ctx  = buildTestContext({
      headers: { Authorization: 'Bearer bad-token' },
    })
    const next = vi.fn()

    vi.mock('@lumiarq/framework/auth', () => ({
      verifyJwt: vi.fn().mockRejectedValue(new Error('Invalid signature')),
    }))

    const response = await requireAuth(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(response?.status).toBe(401)
  })
})
```

Test configurable middleware factories by calling the factory first:

```ts
import { requireRole } from '@shared/middleware/require-role.middleware'

describe('requireRole', () => {
  it('calls next() when the user has the required role', async () => {
    const ctx  = buildTestContext()
    ctx.set('userRole', 'admin')
    const next = vi.fn().mockResolvedValue(undefined)

    await requireRole('admin')(ctx, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('returns 403 when the user has an insufficient role', async () => {
    const ctx  = buildTestContext()
    ctx.set('userRole', 'user')
    const next = vi.fn()

    const response = await requireRole('admin')(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(response?.status).toBe(403)
  })
})

---

**Next:** Learn how to process requests with [Handlers](/docs/handlers).
