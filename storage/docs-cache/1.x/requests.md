---
title: Requests
description: Accessing request data, headers, and body in Lumiarq handlers
section: The Basics
order: 5
draft: false
---

# Requests

- [Introduction](#introduction)
- [Route Parameters](#route-parameters)
- [Query String Parameters](#query-string-parameters)
- [Request Body](#request-body)
- [Headers](#headers)
- [Request URL and Method](#request-url-and-method)
- [Client Information](#client-information)
- [Validating Input](#validating-input)
- [Old Input (Web Forms)](#old-input-web-forms)

<a name="introduction"></a>

Every handler receives a `ctx` (context) object that provides access to the incoming HTTP request through `ctx.req`.

<a name="route-parameters"></a>
## Route Parameters

```typescript
import { defineHandler } from '@lumiarq/framework'

export const GetInvoiceHandler = defineHandler(async (ctx) => {
  const id = ctx.req.param('id')
  // ...
})

// Route: Route.get('/invoices/:id', GetInvoiceHandler, { ... })
// Request: GET /invoices/42  →  ctx.req.param('id') === '42'
```

<a name="query-string-parameters"></a>
## Query String Parameters

```typescript
export const GetInvoicesHandler = defineHandler(async (ctx) => {
  const page    = ctx.req.query('page') ?? '1'
  const perPage = ctx.req.query('per_page') ?? '15'
  const status  = ctx.req.query('status')

  // All query params as a plain object
  const allParams = ctx.req.queries()
})
```

<a name="request-body"></a>
## Request Body

### JSON (API handlers)

```typescript
import { defineHandler } from '@lumiarq/framework'
import { CreateInvoiceDto } from '../../contracts/dto/create-invoice.dto'

export const CreateInvoiceHandler = defineHandler(async (ctx) => {
  const raw = await ctx.req.json()
  const dto = CreateInvoiceDto.parse(raw)   // Zod validation — throws on bad input
  // ...
})
```

### Form Data (web handlers)

```typescript
export const UpdateProfileHandler = defineHandler(async (ctx) => {
  const body = await ctx.req.parseBody()
  const name = body['name'] as string
  const file = body['avatar'] as File
})
```

### Raw Text

```typescript
const text = await ctx.req.text()
```

<a name="headers"></a>
## Headers

```typescript
export const WebhookHandler = defineHandler(async (ctx) => {
  const signature = ctx.req.header('x-signature')

  if (!signature) return ctx.json({ error: 'Missing signature' }, 400)
})
```

<a name="request-url-and-method"></a>
## Request URL and Method

```typescript
const url    = ctx.req.url      // Full URL string
const method = ctx.req.method   // 'GET', 'POST', etc.
```

<a name="client-information"></a>
## Client Information

Use helpers from `@lumiarq/framework` for safely reading client info behind a reverse proxy:

```typescript
import { getClientIp, expectsJson, isRequestSecure } from '@lumiarq/framework'

export const InfoHandler = defineHandler(async (ctx) => {
  const ip        = getClientIp(ctx.req.raw)       // reads X-Forwarded-For
  const isSecure  = isRequestSecure(ctx.req.raw)    // reads X-Forwarded-Proto
  const wantsJson = expectsJson(ctx.req.raw)         // Accept: application/json
})
```

> Ensure `trustProxiesMiddleware` is registered so forwarded headers are trusted correctly.

<a name="validating-input"></a>
## Validating Input

Define Zod DTOs in `contracts/dto/`:

```typescript
// src/modules/Billing/contracts/dto/create-invoice.dto.ts
import { z } from 'zod'

export const CreateInvoiceDto = z.object({
  customerId: z.string().uuid(),
  amount:     z.coerce.number().positive(),
  dueDate:    z.coerce.date(),
  notes:      z.string().max(500).optional(),
})

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceDto>
```

Then in the handler:

```typescript
export const CreateInvoiceHandler = defineHandler(async (ctx) => {
  const result = CreateInvoiceDto.safeParse(await ctx.req.json())

  if (!result.success) {
    return ctx.json({ errors: result.error.flatten().fieldErrors }, 422)
  }

  const invoice = await CreateInvoiceAction(result.data)
  return ctx.json({ invoice }, 201)
})
```

See [Validation](/docs/validation) for a full reference on DTO patterns.

<a name="old-input-web-forms"></a>
## Old Input (Web Forms)

After a validation failure, redirect back and preserve old input in the session flash:

```typescript
import {
  defineHandler,
  writeOld,
  writeFlash,
  buildBackResponse,
} from '@lumiarq/framework'

export const StoreInvoiceHandler = defineHandler(async (ctx) => {
  const body   = await ctx.req.parseBody()
  const result = CreateInvoiceDto.safeParse(body)

  if (!result.success) {
    const sessionId    = ctx.get('session_id')
    const sessionStore = ctx.get('session_store')

    await writeOld(sessionId, sessionStore, body)
    await writeFlash(sessionId, sessionStore, 'errors', result.error.flatten().fieldErrors)

    return buildBackResponse(ctx.req.raw, '/invoices/create', process.env.APP_URL!)
  }

  await CreateInvoiceAction(result.data)
  return ctx.redirect('/invoices')
})
```

In the page template, `old` values are injected so form fields can repopulate on re-render.

---

**Next:** Learn about [Responses](/docs/responses) to control what your handlers return.
