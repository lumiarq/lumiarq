---
title: Exception Handling
description: Defining custom exception handlers and HTTP exception classes
section: The Basics
order: 9
draft: false
---

# Exception Handling

## Table of Contents

- [Introduction](#introduction)
- [The HttpException Hierarchy](#http-exception-hierarchy)
- [Throwing Exceptions in Handlers](#throwing-exceptions)
- [Defining a Custom Exception Handler](#custom-exception-handler)
- [Handler Signature](#handler-signature)
- [Wiring the Handler](#wiring-the-handler)
- [JSON vs HTML Responses](#json-vs-html)
- [Logging Errors](#logging-errors)
- [Per-Module Exception Boundaries](#per-module-boundaries)
- [Full Example](#full-example)
- [Testing Exception Handling](#testing-exceptions)

---

<a name="introduction"></a>
## Introduction

Every web application will encounter errors: a resource is not found, a user is not authenticated, a third-party API call fails. LumiARQ provides a structured, predictable exception system so these errors are handled consistently rather than crashing the server or leaking stack traces to clients.

When an unhandled exception propagates out of a route handler, LumiARQ catches it at the framework level and routes it to the active **exception handler**. The built-in handler covers the most common cases out of the box; you can override it entirely or extend it for your application's needs.

---

<a name="http-exception-hierarchy"></a>
## The HttpException Hierarchy

LumiARQ ships a set of pre-built HTTP exception classes, all importable from `@lumiarq/framework/runtime`. Each maps to a specific HTTP status code and carries a structured error body.

```typescript
import {
  HttpException,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  BadRequestError,
  ConflictError,
} from '@lumiarq/framework/runtime'
```

### Class Reference

| Class | Status | Default Message |
|-------|--------|-----------------|
| `HttpException` | Configurable | "An error occurred" |
| `NotFoundError` | `404` | "Not Found" |
| `UnauthorizedError` | `401` | "Unauthorized" |
| `ForbiddenError` | `403` | "Forbidden" |
| `ValidationError` | `422` | "Unprocessable Entity" |
| `BadRequestError` | `400` | "Bad Request" |
| `ConflictError` | `409` | "Conflict" |

### HttpException — Base Class

All HTTP exception classes extend `HttpException`. You can use the base class directly when you need a custom status code:

```typescript
throw new HttpException('Payment Required', 402)
throw new HttpException('Too Many Requests', 429, { retryAfter: 60 })
```

The third argument is an optional `details` object that is merged into the error response body.

### Pre-Built Classes

```typescript
// 404 — resource not found
throw new NotFoundError('Post not found')

// 401 — missing or invalid credentials
throw new UnauthorizedError()
throw new UnauthorizedError('Token expired')

// 403 — authenticated but not permitted
throw new ForbiddenError('You do not own this resource')

// 422 — input validation failed
throw new ValidationError('Validation failed', {
  fields: {
    email: ['Email is required', 'Email must be valid'],
    password: ['Password must be at least 8 characters'],
  },
})

// 400 — malformed request
throw new BadRequestError('Invalid JSON body')

// 409 — state conflict
throw new ConflictError('A user with this email already exists')
```

### ValidationError

`ValidationError` has a special `fields` property for per-field error messages, matching the output of `parseBody()`:

```typescript
import { ValidationError } from '@lumiarq/framework/runtime'
import type { FieldErrors } from '@lumiarq/framework'

throw new ValidationError('Validation failed', {
  fields: {
    title:   ['Title is required'],
    content: ['Content must be at least 10 characters'],
  } satisfies FieldErrors,
})
```

---

<a name="throwing-exceptions"></a>
## Throwing Exceptions in Handlers

Throw exceptions anywhere in your handler or in actions called from your handler. The framework will catch them before they reach the Node.js process uncaught handler.

```typescript
// src/modules/Posts/handlers/getPost.ts
import { defineHandler }  from '@lumiarq/framework/core'
import { NotFoundError }  from '@lumiarq/framework/runtime'
import { findPostById }   from '../queries/findPostById.js'

export const getPost = defineHandler(async (ctx) => {
  const { id } = ctx.params

  const post = await findPostById(id)
  if (!post) {
    throw new NotFoundError(`Post "${id}" not found`)
  }

  return ctx.json(post)
})
```

```typescript
// src/modules/Auth/actions/requireAuth.ts
import { UnauthorizedError } from '@lumiarq/framework/runtime'

export function requireAuth(ctx: ExecutionContext): string {
  const token = ctx.request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) throw new UnauthorizedError()

  const userId = verifyToken(token)
  if (!userId) throw new UnauthorizedError('Token is invalid or expired')

  return userId
}
```

---

<a name="custom-exception-handler"></a>
## Defining a Custom Exception Handler

The built-in exception handler converts `HttpException` instances to structured JSON responses and swallows the rest as `500 Internal Server Error`. For production applications you will want to:

- Log errors to an observability service (e.g., Sentry, Highlight, Axiom)
- Return branded HTML error pages for browser requests
- Mask internal error details in production

`defineExceptionHandler` creates a custom handler:

```typescript
import { defineExceptionHandler } from '@lumiarq/framework/runtime'

export const exceptionHandler = defineExceptionHandler(async (error, ctx) => {
  // Return a Response to short-circuit the default handler.
  // Return void to fall through to the built-in handler.
})
```

---

<a name="handler-signature"></a>
## Handler Signature

```typescript
type ExceptionHandlerFn = (
  error: unknown,
  ctx:   ExecutionContext
) => Promise<Response | void>
```

| Parameter | Description |
|-----------|-------------|
| `error` | The caught value — could be an `HttpException`, a `ZodError`, a native `Error`, or anything thrown |
| `ctx` | The same `ExecutionContext` available in route handlers — gives access to `ctx.request`, `ctx.logger`, `ctx.json()`, `ctx.html()`, etc. |

Return a `Response` to send that response to the client and stop further processing. Return `void` (or `undefined`) to let the framework's built-in handler take over — useful when you only want to handle a subset of errors.

---

<a name="wiring-the-handler"></a>
## Wiring the Handler

Register your custom exception handler in `bootstrap/entry.ts`:

```typescript
// bootstrap/entry.ts
import { createApp }        from '@lumiarq/framework/core'
import { exceptionHandler } from '#exceptions/exceptionHandler'
import { router }           from './router.js'

const app = createApp({
  router,
  exceptionHandler,
})

export default app
```

Only one exception handler is active at a time. Registering a new handler via `createApp` replaces the built-in default entirely. If you want the built-in behaviour as a fallback, call `defaultExceptionHandler` explicitly:

```typescript
import {
  defineExceptionHandler,
  defaultExceptionHandler,
  HttpException,
} from '@lumiarq/framework/runtime'

export const exceptionHandler = defineExceptionHandler(async (error, ctx) => {
  // Handle our custom cases
  if (error instanceof MyDomainError) {
    return ctx.json({ error: error.message }, 422)
  }

  // Fall through to the built-in handler for everything else
  return defaultExceptionHandler(error, ctx)
})
```

---

<a name="json-vs-html"></a>
## JSON vs HTML Responses

A best-practice exception handler inspects the `Accept` header to determine whether the client expects JSON or HTML:

```typescript
import {
  defineExceptionHandler,
  HttpException,
} from '@lumiarq/framework/runtime'

function wantsJson(ctx: ExecutionContext): boolean {
  const accept = ctx.request.headers.get('Accept') ?? ''
  return accept.includes('application/json') || accept.includes('*/*')
}

export const exceptionHandler = defineExceptionHandler(async (error, ctx) => {
  if (error instanceof HttpException) {
    if (wantsJson(ctx)) {
      return ctx.json(
        {
          error:   error.message,
          status:  error.statusCode,
          ...(error.details ?? {}),
        },
        error.statusCode
      )
    }

    // Return an HTML error page for browser requests
    const html = renderErrorPage(error.statusCode, error.message)
    return ctx.html(html, error.statusCode)
  }

  // Unexpected errors — never expose internals
  ctx.logger.error({ err: error }, 'Unhandled exception')

  if (wantsJson(ctx)) {
    return ctx.json({ error: 'Internal Server Error' }, 500)
  }

  return ctx.html(renderErrorPage(500, 'Something went wrong'), 500)
})
```

---

<a name="logging-errors"></a>
## Logging Errors

The `ExecutionContext` provides a structured logger via `ctx.logger`. Use it inside your exception handler to record errors with full request context:

```typescript
export const exceptionHandler = defineExceptionHandler(async (error, ctx) => {
  const isHttpError = error instanceof HttpException

  // Only log 5xx errors (or non-HTTP errors) as errors; 4xx are warnings
  if (!isHttpError || error.statusCode >= 500) {
    ctx.logger.error(
      {
        err:    error,
        method: ctx.request.method,
        url:    ctx.request.url,
        userId: ctx.state.userId ?? null,
      },
      'Unhandled exception'
    )
  } else {
    ctx.logger.warn(
      { status: error.statusCode, message: error.message },
      'HTTP exception'
    )
  }
})
```

---

<a name="per-module-boundaries"></a>
## Per-Module Exception Boundaries

For fine-grained error handling within a module, wrap action calls in a `try/catch` at the handler level:

```typescript
// src/modules/Payments/handlers/processPayment.ts
import { defineHandler }    from '@lumiarq/framework/core'
import { BadRequestError }  from '@lumiarq/framework/runtime'
import { StripeError }      from 'stripe'

export const processPayment = defineHandler(async (ctx) => {
  const body = await parseBody(ctx.request, paymentSchema)

  try {
    const charge = await stripe.paymentIntents.create({ ... })
    return ctx.json({ chargeId: charge.id })
  } catch (error) {
    if (error instanceof StripeError) {
      // Translate Stripe errors into our own error types
      if (error.code === 'card_declined') {
        throw new BadRequestError('Your card was declined')
      }
      if (error.code === 'insufficient_funds') {
        throw new BadRequestError('Insufficient funds')
      }
    }
    // Re-throw anything we don't recognise — the global handler will catch it
    throw error
  }
})
```

---

<a name="full-example"></a>
## Full Example

### Custom Error Renderer with Sentry Integration

```typescript
// src/exceptions/exceptionHandler.ts
import {
  defineExceptionHandler,
  HttpException,
  ValidationError,
} from '@lumiarq/framework/runtime'
import * as Sentry from '@sentry/node'
import { renderErrorPage } from '#views/errors.js'

function wantsJson(ctx: ExecutionContext): boolean {
  const accept = ctx.request.headers.get('Accept') ?? ''
  return (
    accept.includes('application/json') ||
    ctx.request.url.includes('/api/')
  )
}

export const exceptionHandler = defineExceptionHandler(async (error, ctx) => {
  const requestId = ctx.request.headers.get('X-Request-Id') ?? crypto.randomUUID()

  // ── Validation errors (422) ──────────────────────────────────────────────
  if (error instanceof ValidationError) {
    return ctx.json(
      {
        error:      'Validation failed',
        status:     422,
        requestId,
        fields:     error.details?.fields ?? {},
      },
      422
    )
  }

  // ── Known HTTP errors ────────────────────────────────────────────────────
  if (error instanceof HttpException) {
    const status = error.statusCode

    if (status < 500) {
      // Client errors — log as warning, don't send to Sentry
      ctx.logger.warn({ status, message: error.message, requestId }, 'HTTP error')

      if (wantsJson(ctx)) {
        return ctx.json({ error: error.message, status, requestId }, status)
      }
      return ctx.html(renderErrorPage(status, error.message), status)
    }
  }

  // ── Unexpected server errors ─────────────────────────────────────────────
  Sentry.withScope((scope) => {
    scope.setTag('requestId', requestId)
    scope.setExtra('url', ctx.request.url)
    scope.setExtra('method', ctx.request.method)
    if (ctx.state.userId) scope.setUser({ id: ctx.state.userId })
    Sentry.captureException(error)
  })

  ctx.logger.error(
    { err: error, requestId, url: ctx.request.url },
    'Unhandled server error'
  )

  if (wantsJson(ctx)) {
    return ctx.json(
      {
        error:     'Internal Server Error',
        status:    500,
        requestId,
      },
      500
    )
  }

  return ctx.html(renderErrorPage(500, 'Something went wrong'), 500)
})
```

```typescript
// bootstrap/entry.ts
import { createApp }        from '@lumiarq/framework/core'
import { exceptionHandler } from '#exceptions/exceptionHandler'
import { router }           from './router.js'
import { middleware }       from './middleware.js'

export default createApp({ router, middleware, exceptionHandler })
```

---

<a name="testing-exceptions"></a>
## Testing Exception Handling

### Asserting Thrown Exceptions in Actions

```typescript
// tests/modules/Posts/getPost.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext }       from '@lumiarq/framework/testing'
import { getPost }               from '#modules/Posts/handlers/getPost'
import { NotFoundError }         from '@lumiarq/framework/runtime'

describe('getPost handler', () => {
  it('throws NotFoundError when post does not exist', async () => {
    await withTestContext(
      {
        method: 'GET',
        params: { id: 'nonexistent-id' },
      },
      async (ctx) => {
        await expect(getPost(ctx)).rejects.toThrow(NotFoundError)
      }
    )
  })

  it('returns a 404 JSON response for an unknown post', async () => {
    const res = await withTestContext(
      {
        method:  'GET',
        params:  { id: 'nonexistent-id' },
        headers: { Accept: 'application/json' },
      },
      (ctx) => getPost(ctx)
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })
})
```

### Testing the Exception Handler Directly

```typescript
import { describe, it, expect, vi } from 'vitest'
import { withTestContext }           from '@lumiarq/framework/testing'
import { exceptionHandler }          from '#exceptions/exceptionHandler'
import { NotFoundError, ForbiddenError } from '@lumiarq/framework/runtime'

describe('exceptionHandler', () => {
  it('returns 404 JSON for NotFoundError', async () => {
    await withTestContext(
      { method: 'GET', headers: { Accept: 'application/json' } },
      async (ctx) => {
        const res = await exceptionHandler(new NotFoundError('Not here'), ctx)
        expect(res?.status).toBe(404)
        const body = await res?.json()
        expect(body.error).toBe('Not here')
      }
    )
  })

  it('reports server errors to Sentry', async () => {
    const capture = vi.spyOn(Sentry, 'captureException')

    await withTestContext({ method: 'GET' }, async (ctx) => {
      await exceptionHandler(new Error('boom'), ctx)
    })

    expect(capture).toHaveBeenCalledWith(expect.any(Error))
  })
})
```
