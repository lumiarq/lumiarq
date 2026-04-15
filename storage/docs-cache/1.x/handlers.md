---
title: Handlers
description: Processing HTTP requests with handler functions
section: The Basics
order: 4
draft: false
---

# Handlers

- [Introduction](#introduction)
- [Defining a Handler](#defining-a-handler)
- [HandlerContext](#handlercontext)
- [Generating a Handler](#generating-a-handler)
- [A Web Handler](#a-web-handler)
- [An API Handler](#an-api-handler)
- [Reading URL Parameters](#reading-url-parameters)
- [Returning a 422 Validation Error](#returning-a-422-validation-error)
- [Returning a 404 Not Found](#returning-a-404-not-found)
- [Redirecting from a Handler](#redirecting-from-a-handler)
- [Accessing Context State](#accessing-context-state)
- [Handler Composition](#handler-composition)
- [Authorization Guards](#authorization-guards)
- [Content Negotiation](#content-negotiation)
- [Testing Handlers](#testing-handlers)

<a name="introduction"></a>
## Introduction

A **handler** is an async function that receives an HTTP request and returns a response. Handlers sit in the `http/handlers/` directory of a module and are created with `defineHandler`. They are the entry point for all HTTP traffic into a module.

Handlers should be thin. They read from the request, delegate to actions or queries, and return a response. Business logic belongs in actions and queries — not in handlers.

<a name="defining-a-handler"></a>
## Defining a Handler

```ts
import { defineHandler } from '@lumiarq/framework'

export const listInvoicesHandler = defineHandler(async (ctx) => {
  return ctx.json({ invoices: [] })
})
```

`defineHandler` receives an async function with a single `ctx` argument — the `HandlerContext`. It returns a `Response`.

<a name="handlercontext"></a>
## HandlerContext

The `HandlerContext` (`ctx`) provides everything you need to read the request and write the response.

```ts
import { defineHandler } from '@lumiarq/framework'
import type { HandlerContext } from '@lumiarq/framework'

export const exampleHandler = defineHandler(async (ctx: HandlerContext) => {
  // Reading the request
  const id = ctx.req.param('id')          // URL path parameter
  const page = ctx.req.query('page')      // Query string value
  const body = await ctx.req.json()       // Parsed JSON body
  const token = ctx.req.header('Authorization') // Request header

  // Writing the response
  return ctx.json({ id, page })           // JSON response
})
```

<a name="generating-a-handler"></a>
## Generating a Handler

```bash
pnpm lumis make:handler Billing ProcessPayment
```

This creates `src/modules/Billing/http/handlers/process-payment.handler.ts` with a `defineHandler` stub ready to fill in.

<a name="a-web-handler"></a>
## A Web Handler

Web handlers serve HTML pages. They are registered in `*.web.ts` route files. The `render` option on the route determines the rendering strategy.

```ts
// src/modules/Billing/http/handlers/invoices.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { getInvoices } from '@modules/Billing/logic/queries/get-invoices.query'

export const invoicesHandler = defineHandler(async (ctx) => {
  const userId = ctx.get('userId') as string
  const invoices = await getInvoices({ userId })

  // Render an HTML page using your UI framework of choice
  const html = renderInvoicesPage({ invoices })

  return ctx.html(html)
})
```

```ts
// src/modules/Billing/http/routes/billing.web.ts
import { Route } from '@lumiarq/framework'
import { invoicesHandler } from '@modules/Billing/http/handlers/invoices.handler'

Route.get('/invoices', invoicesHandler, {
  name: 'billing.invoices',
  render: 'traditional',
})
```

<a name="an-api-handler"></a>
## An API Handler

API handlers return JSON. They are registered in `*.api.ts` route files and authenticated via JWT rather than session cookies.

```ts
// src/modules/Billing/http/handlers/create-invoice.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { createInvoice } from '@modules/Billing/logic/actions/create-invoice.action'
import { createInvoiceSchema } from '@modules/Billing/logic/validators/create-invoice.validator'

export const createInvoiceHandler = defineHandler(async (ctx) => {
  const body = await ctx.req.json()

  const parsed = createInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return ctx.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      422,
    )
  }

  const invoice = await createInvoice(parsed.data)

  return ctx.json({ invoice }, 201)
})
```

```ts
// src/modules/Billing/http/routes/billing.api.ts
import { Route } from '@lumiarq/framework'
import { createInvoiceHandler } from '@modules/Billing/http/handlers/create-invoice.handler'

Route.post('/invoices', createInvoiceHandler, {
  name: 'billing.invoices.create',
  render: 'traditional',
})
```

<a name="reading-url-parameters"></a>
## Reading URL Parameters

Path parameters are defined with a colon in the route path and read with `ctx.req.param()`.

```ts
// Route: Route.get('/invoices/:id', showInvoiceHandler, { ... })

export const showInvoiceHandler = defineHandler(async (ctx) => {
  const id = ctx.req.param('id')

  if (!id) {
    return ctx.notFound()
  }

  const invoice = await getInvoice({ id })

  if (!invoice) {
    return ctx.notFound()
  }

  return ctx.json({ invoice })
})
```

<a name="returning-a-422-validation-error"></a>
## Returning a 422 Validation Error

The conventional status code for failed request validation is `422 Unprocessable Entity`. Return a structured error body so API clients can display field-level error messages.

```ts
import { defineHandler } from '@lumiarq/framework'
import { z } from 'zod'

const bodySchema = z.object({
  email: z.string().email(),
  amount: z.number().int().positive(),
})

export const createPaymentHandler = defineHandler(async (ctx) => {
  const body = await ctx.req.json()
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    return ctx.json(
      {
        message: 'The given data was invalid.',
        errors: parsed.error.flatten().fieldErrors,
      },
      422,
    )
  }

  // proceed with valid data
  return ctx.json({ success: true }, 201)
})
```

<a name="returning-a-404-not-found"></a>
## Returning a 404 Not Found

```ts
export const showInvoiceHandler = defineHandler(async (ctx) => {
  const id = ctx.req.param('id')
  const invoice = await getInvoice({ id })

  if (!invoice) {
    return ctx.notFound()
  }

  return ctx.json({ invoice })
})
```

<a name="redirecting-from-a-handler"></a>
## Redirecting from a Handler

```ts
export const legacyInvoiceHandler = defineHandler(async (ctx) => {
  const id = ctx.req.param('id')
  return ctx.redirect(`/billing/invoices/${id}`, 301)
})
```

<a name="accessing-context-state"></a>
## Accessing Context State

Middleware can attach data to the request context using `ctx.set()`. Handlers retrieve it with `ctx.get()`. This is the standard pattern for passing authentication state from middleware to handlers.

```ts
// Middleware sets the user id
ctx.set('userId', decodedToken.sub)

// Handler reads it
export const profileHandler = defineHandler(async (ctx) => {
  const userId = ctx.get('userId') as string
  const profile = await getProfile({ userId })
  return ctx.json({ profile })
})
```

<a name="handler-composition"></a>
## Handler Composition

For repeated logic, extract it into a shared helper rather than duplicating it across handlers. Keep the shared file in a `shared/` directory or co-locate it within the module.

```ts
// src/modules/Billing/http/handlers/_helpers/resolve-invoice.ts
import { HandlerContext } from '@lumiarq/framework'
import { getInvoice } from '@modules/Billing/logic/queries/get-invoice.query'

export async function resolveInvoice(ctx: HandlerContext) {
  const id = ctx.req.param('id')
  const invoice = await getInvoice({ id })
  if (!invoice) return ctx.notFound()
  return invoice
}
```

```ts
export const showInvoiceHandler = defineHandler(async (ctx) => {
  const invoice = await resolveInvoice(ctx)
  return ctx.json({ invoice })
})

export const deleteInvoiceHandler = defineHandler(async (ctx) => {
  const invoice = await resolveInvoice(ctx)
  await deleteInvoice({ id: invoice.id })
  return ctx.json({ success: true })
})
```

> **Note:** Shared helpers used inside `defineHandler` should return a Response for errors (`return ctx.notFound()`) rather than throwing, so the early-return is visible to TypeScript's control-flow analysis.

<a name="authorization-guards"></a>
## Authorization Guards

Authorization logic that applies to multiple handlers can be extracted into a guard function. A guard returns `undefined` on success and a `Response` on failure — the handler checks for a response and short-circuits:

```ts
// src/modules/Billing/http/handlers/_guards/ensure-invoice-owner.ts
import { HandlerContext } from '@lumiarq/framework'
import { Invoice } from '@modules/Billing/contracts/types/invoice.types'

export function ensureInvoiceOwner(
  ctx: HandlerContext,
  invoice: Invoice,
): Response | undefined {
  const userId = ctx.get('userId') as string

  if (invoice.ownerId !== userId) {
    return ctx.json({ message: 'Forbidden' }, 403)
  }

  // undefined means "access granted"
}
```

```ts
export const showInvoiceHandler = defineHandler(async (ctx) => {
  const id = ctx.req.param('id')
  const invoice = await getInvoice({ id })

  if (!invoice) return ctx.notFound()

  const denied = ensureInvoiceOwner(ctx, invoice)
  if (denied) return denied

  return ctx.json({ invoice })
})

export const deleteInvoiceHandler = defineHandler(async (ctx) => {
  const id = ctx.req.param('id')
  const invoice = await getInvoice({ id })

  if (!invoice) return ctx.notFound()

  const denied = ensureInvoiceOwner(ctx, invoice)
  if (denied) return denied

  await deleteInvoice({ id })
  return ctx.json({ success: true })
})
```

<a name="content-negotiation"></a>
## Content Negotiation

A single route can serve both HTML and JSON by inspecting the `Accept` header. This is useful for endpoints that are shared between a browser UI and a mobile/CLI client.

```ts
export const showInvoiceHandler = defineHandler(async (ctx) => {
  const id = ctx.req.param('id')
  const invoice = await getInvoice({ id })

  if (!invoice) return ctx.notFound()

  const accepts = ctx.req.header('Accept') ?? ''

  if (accepts.includes('application/json')) {
    return ctx.json({ invoice })
  }

  // Default: serve HTML
  const html = renderInvoicePage({ invoice })
  return ctx.html(html)
})
```

<a name="testing-handlers"></a>
## Testing Handlers

Test handlers through their HTTP routes using the `withTestContext` helper. This lets you assert on response status, headers, and body without spinning up a real server:

```ts
import { withTestContext, buildTestApp } from '@lumiarq/framework/testing'
import { describe, it, expect } from 'vitest'

describe('showInvoiceHandler', () => {
  it('returns 200 with invoice data for the owner', () => withTestContext(async (ctx) => {
    ctx.actingAs({ id: 'user_1' })

    const invoice = await ctx.factory('invoice').create({ ownerId: 'user_1' })

    const response = await ctx.fetch(`/billing/invoices/${invoice.id}`, {
      headers: { Accept: 'application/json' },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.invoice.id).toBe(invoice.id)
  }))

  it('returns 403 when requesting another user\'s invoice', () => withTestContext(async (ctx) => {
    ctx.actingAs({ id: 'user_2' })

    const invoice = await ctx.factory('invoice').create({ ownerId: 'user_1' })

    const response = await ctx.fetch(`/billing/invoices/${invoice.id}`, {
      headers: { Accept: 'application/json' },
    })

    expect(response.status).toBe(403)
  }))

  it('returns 404 for a non-existent invoice', () => withTestContext(async (ctx) => {
    ctx.actingAs({ id: 'user_1' })

    const response = await ctx.fetch('/billing/invoices/inv_nonexistent', {
      headers: { Accept: 'application/json' },
    })

    expect(response.status).toBe(404)
  }))
})
```

---

**Next:** Learn how to define validation schemas with [Validation](/docs/validation).
```
