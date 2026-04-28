---
title: Execution Context (ALS)
description: Request-scoped execution state in LumiArq with guaranteed non-null context access
section: Architecture Concepts
order: 4
draft: false
---

# Execution Context (ALS)

- [Introduction](#introduction)
- [The Four Context Types](#the-four-context-types)
- [Reading the Current Context](#reading-the-current-context)
- [The ExecutionContext Type](#the-executioncontext-type)
- [Authentication Context](#authentication-context)
- [Context-Scoped Logging](#context-scoped-logging)
- [Helper Functions](#helper-functions)
- [The Audit Trail](#the-audit-trail)
- [Running Code in an Isolated Scope](#running-code-in-an-isolated-scope)
- [Context in Tests](#context-in-tests)

<a name="introduction"></a>
## Introduction

LumiARQ provides request-scoped state through Node's [AsyncLocalStorage](https://nodejs.org/api/async_context.html) (ALS). This gives every call inside a single request, job, or CLI command access to a shared `ExecutionContext` — without threading that context through every function parameter.

The key guarantee: **`getContext()` never throws and never returns `null`**. Inside any framework-managed pipeline (HTTP request, scheduled job, or CLI command), context access is always available. Application code does not need nullable guards in normal execution paths.

```ts
import { getContext } from '@lumiarq/framework'

// Inside a handler, action, query, or task:
const ctx = getContext()
const requestId = ctx.contextId          // unique per request
const locale = ctx.locale                // 'en', 'fr', etc.
const user = await ctx.auth.getUser()    // AuthUser | null
ctx.logger.info('Invoice created', { invoiceId: '...' })
```

<a name="the-four-context-types"></a>
## The Four Context Types

LumiARQ creates a different context shape depending on what initiated execution. Use `ctx.contextType` to discriminate.

| `contextType` | When it is set | Auth state |
|---|---|---|
| `'request'` | HTTP request lifecycle, set by runtime middleware before handlers run | Populated from JWT or session by auth middleware |
| `'job'` | Scheduled job lifecycle, set by the scheduler before running each job | Always unauthenticated |
| `'command'` | CLI command lifecycle, set by `lumis` before running a command | Always unauthenticated |
| `'test'` | Test lifecycle, set by `withTestContext()` — wraps in a database transaction | Configurable |

You can branch on `contextType` when behaviour must differ by lifecycle:

```ts
import { getContext } from '@lumiarq/framework'

const ctx = getContext()

if (ctx.contextType === 'request') {
  const user = await ctx.auth.getUser()
  ctx.logger.info('Serving request', { userId: user?.id })
} else if (ctx.contextType === 'job') {
  ctx.logger.info('Running scheduled job')
}
```

<a name="reading-the-current-context"></a>
## Reading the Current Context

Call `getContext()` from anywhere inside a framework-managed scope. Resolution order:

1. **Active ALS scope** — set by `runWithContext()` for the current async call stack.
2. **Application context** — the stable `command` context set at boot time by `setApplicationContext()`.
3. **Ambient fallback** — a fresh `command` context with a new UUID, returned when called from outside any scope (bare scripts, REPL).

```ts
import { getContext } from '@lumiarq/framework'

// In a handler:
export const createInvoiceHandler = defineHandler(async (ctx) => {
  const execCtx = getContext()
  execCtx.logger.info('Creating invoice')
  const invoice = await createInvoice(parsed.data)
  return ctx.json({ invoice }, 201)
})

// In an action — no context was passed, but it is still available:
export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  const execCtx = getContext()
  execCtx.logger.info('Persisting invoice', { customerId: dto.customerId })
  // ...
})
```

The execution context propagates automatically across `await` boundaries and through `Promise.all()` calls without any manual threading.

<a name="the-executioncontext-type"></a>
## The ExecutionContext Type

```ts
interface ExecutionContext {
  /** Discriminates the lifecycle variant: 'request' | 'job' | 'command' | 'test' */
  readonly contextType: 'request' | 'job' | 'command' | 'test'

  /** Unique identifier for this execution. For HTTP requests this is derived
   *  from the incoming X-Request-Id header, or generated if absent. */
  readonly contextId: string

  /** Timestamp when this execution began. */
  readonly startedAt: Date

  /** Authentication context for this execution. */
  readonly auth: AuthContext

  /** Context-scoped logger — every log line is tagged with contextId. */
  readonly logger: RequestLogger

  /** BCP 47 locale tag for this execution. Defaults to 'en'. */
  readonly locale: string
}
```

<a name="authentication-context"></a>
## Authentication Context

The `auth` field on `ExecutionContext` is an `AuthContext` object. Auth middleware populates it before handlers run during HTTP requests.

```ts
interface AuthContext {
  readonly isAuthenticated: boolean
  getUser(): Promise<AuthUser | null>
}

interface AuthUser {
  readonly id: string
  readonly email: string
  readonly role: string
  readonly locale?: string   // User's preferred locale (BCP 47)
}
```

Access the authenticated user from anywhere in the call stack:

```ts
import { getContext } from '@lumiarq/framework'

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  const { auth } = getContext()

  if (!auth.isAuthenticated) {
    throw new Error('Unauthenticated')
  }

  const user = await auth.getUser()

  // user is AuthUser here (not null, because isAuthenticated is true)
  return repo.create({ ...dto, createdBy: user!.id })
})
```

> **Note** — Prefer checking `isAuthenticated` before calling `getUser()`. Outside a request context (jobs, commands), `isAuthenticated` is always `false` and `getUser()` always resolves to `null`.

<a name="context-scoped-logging"></a>
## Context-Scoped Logging

The `logger` on `ExecutionContext` is a `RequestLogger` automatically tagged with `contextId`. Every log line from the same request, job, or command shares the same `contextId`, making distributed tracing straightforward.

```ts
interface RequestLogger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}
```

Using the context logger instead of `console.log` ensures all output is correlated:

```ts
import { getContext } from '@lumiarq/framework'

export const markInvoicePaid = defineAction(async (dto: { invoiceId: string }) => {
  const { logger } = getContext()

  logger.info('Marking invoice as paid', { invoiceId: dto.invoiceId })

  const invoice = await repo.findOrFail(dto.invoiceId)

  await repo.update(invoice.id, { status: 'paid', paidAt: new Date() })

  logger.info('Invoice marked paid', { invoiceId: invoice.id })

  return invoice
})
```

<a name="helper-functions"></a>
## Helper Functions

LumiARQ exports ergonomic helpers that read common fields from the current context without requiring a manual `getContext()` call.

### `getRequestId()`

Returns `contextId` for the current execution.

```ts
import { getRequestId } from '@lumiarq/framework'

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  const requestId = getRequestId()
  await externalService.create({ ...dto, idempotencyKey: requestId })
})
```

### `getUserId()`

Resolves the authenticated user's `id`, or `undefined` if unauthenticated.

```ts
import { getUserId } from '@lumiarq/framework'

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  const userId = await getUserId()
  return repo.create({ ...dto, createdBy: userId })
})
```

### `withContext()`

A thin alias for `runWithContext()`. Wraps a function in an isolated ALS scope bound to the given context.

```ts
import { withContext, createRequestContext } from '@lumiarq/framework'

const ctx = createRequestContext({ locale: 'fr' })

const result = withContext(ctx, () => {
  // getContext() inside here returns the 'fr' request context
  return processOrder(orderData)
})
```

<a name="the-audit-trail"></a>
## The Audit Trail

The execution context integrates with LumiARQ's audit system. When auditing is enabled, you can log structured audit entries and retrieve the full trail for the current execution.

```ts
import { logAuditEntry, getAuditTrail } from '@lumiarq/framework'

// Log an entry anywhere in the call stack
logAuditEntry({
  action: 'invoice.created',
  metadata: { invoiceId: 'inv_123', customerId: 'cust_456' },
})

// Retrieve all entries logged so far in this execution
const trail = getAuditTrail()
// trail: AuditEntry[]
```

Enable auditing in `config/app.ts`:

```ts
export default {
  audit: {
    enabled: true,
  },
}
```

<a name="running-code-in-an-isolated-scope"></a>
## Running Code in an Isolated Scope

The framework uses `runWithContext()` internally to wrap every request, job, and command. You rarely need to call it directly, but it is useful for writing custom adapters or test utilities.

```ts
import { runWithContext, createRequestContext } from '@lumiarq/framework'

const ctx = createRequestContext({
  headers: { 'x-request-id': 'my-id', 'accept-language': 'fr' },
  locale: 'fr',
})

const result = await runWithContext(ctx, async () => {
  // getContext() inside here returns ctx
  return handleBillingRequest(req)
})
```

The four factory functions mirror the four context types:

```ts
import {
  createRequestContext,
  createJobContext,
  createCommandContext,
  createTestContext,
} from '@lumiarq/framework'
```

<a name="context-in-tests"></a>
## Context in Tests

Use `withTestContext()` to wrap test code in an isolated execution scope backed by a database transaction. The transaction is automatically rolled back at the end of the test, keeping the database clean.

```ts
import { withTestContext } from '@lumiarq/framework'
import { createInvoice } from '@modules/Billing/logic/actions/create-invoice.action'

test('creates an invoice and emits InvoiceCreatedEvent', async () => {
  await withTestContext(async () => {
    const invoice = await createInvoice({
      customerId: 'cust_123',
      lineItems: [{ description: 'Consulting', quantity: 1, unitCents: 10000 }],
      dueDateIso: '2025-12-31',
    })

    expect(invoice.id).toBeDefined()
    expect(invoice.status).toBe('draft')

    // getContext() inside withTestContext() returns a 'test' contextType
    const ctx = getContext()
    expect(ctx.contextType).toBe('test')
  })
})
```

To test behaviour that depends on an authenticated user, pass auth into the test context:

```ts
import { withTestContext, createTestContext } from '@lumiarq/framework'

test('records createdBy from auth context', async () => {
  await withTestContext(
    async () => {
      const invoice = await createInvoice({ /* ... */ })
      expect(invoice.createdBy).toBe('user_42')
    },
    {
      auth: {
        isAuthenticated: true,
        getUser: async () => ({ id: 'user_42', email: 'alice@example.com', role: 'admin' }),
      },
    },
  )
})
```
