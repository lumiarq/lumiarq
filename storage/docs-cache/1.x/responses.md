---
title: Responses
description: Returning HTML, JSON, redirects, and files from handlers
section: The Basics
order: 6
draft: false
---

# Responses

- [Introduction](#introduction)
- [HTML Responses](#html-responses)
- [JSON Responses](#json-responses)
- [Redirects](#redirects)
- [Text Responses](#text-responses)
- [Status-Only Responses](#status-only-responses)
- [Setting Response Headers](#setting-response-headers)
- [Cookies](#cookies)
- [Flash Messages](#flash-messages)
- [Not Found](#not-found)
- [Error Responses](#error-responses)
- [Response Caching (Static Routes)](#response-caching-static-routes)

<a name="introduction"></a>

Handlers return responses using helpers on the `ctx` (context) object. The right response method depends on your route's `render` strategy — `'traditional'` and `'redirect'` for web routes; `'json'` / `'static'` for API routes.

<a name="html-responses"></a>
## HTML Responses

Return a full HTML page from a web route:

```typescript
import { defineHandler } from '@lumiarq/framework'

export const WelcomeHandler = defineHandler(async (ctx) => {
  return ctx.html(`
    <!doctype html>
    <html>
      <head><title>Welcome</title></head>
      <body><h1>Hello, Lumiarq!</h1></body>
    </html>
  `)
})
```

Set an explicit status code:

```typescript
return ctx.html('<h1>Not Found</h1>', 404)
```

<a name="json-responses"></a>
## JSON Responses

Return JSON from API routes:

```typescript
export const GetInvoicesApiHandler = defineHandler(async (ctx) => {
  const invoices = await GetInvoicesQuery(ctx.get('user').id)

  return ctx.json({ invoices })
})
```

With an explicit status code:

```typescript
return ctx.json({ invoice }, 201)       // 201 Created
return ctx.json({ error: 'Forbidden' }, 403)
```

<a name="redirects"></a>
## Redirects

Redirect the browser to another URL:

```typescript
export const StoreInvoiceHandler = defineHandler(async (ctx) => {
  const invoice = await CreateInvoiceAction(dto)

  return ctx.redirect(`/invoices/${invoice.id}`)     // 302 by default
})
```

Permanent redirect (301):

```typescript
return ctx.redirect('/new-url', 301)
```

### Redirect Back

Redirect to the previous page (using the `Referer` header) with a fallback:

```typescript
import { buildBackResponse } from '@lumiarq/framework'

return buildBackResponse(ctx.req.raw, '/dashboard', process.env.APP_URL!)
```

<a name="text-responses"></a>
## Text Responses

```typescript
return ctx.text('pong')                  // Content-Type: text/plain
return ctx.text('Not found', 404)
```

<a name="status-only-responses"></a>
## Status-Only Responses

Return a status with no body:

```typescript
return ctx.body(null, 204)              // 204 No Content
```

<a name="setting-response-headers"></a>
## Setting Response Headers

Use `ctx.header()` before returning:

```typescript
export const ExportHandler = defineHandler(async (ctx) => {
  const csv = await GenerateCsvExportAction()

  ctx.header('Content-Type', 'text/csv')
  ctx.header('Content-Disposition', 'attachment; filename="invoices.csv"')

  return ctx.body(csv)
})
```

<a name="cookies"></a>
## Cookies

Set a cookie using the helper:

```typescript
import { buildSetCookieHeader, buildClearCookieHeader } from '@lumiarq/framework'

export const LoginHandler = defineHandler(async (ctx) => {
  const { token } = await LoginAction(dto)

  ctx.header('Set-Cookie', buildSetCookieHeader('token', token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,   // 7 days
  }))

  return ctx.redirect('/dashboard')
})
```

Clear a cookie on logout:

```typescript
ctx.header('Set-Cookie', buildClearCookieHeader('token'))
return ctx.redirect('/login')
```

<a name="flash-messages"></a>
## Flash Messages

Write a one-time flash message into the session before redirecting:

```typescript
import { writeFlash } from '@lumiarq/framework'

export const StoreInvoiceHandler = defineHandler(async (ctx) => {
  await CreateInvoiceAction(dto)

  const sessionId    = ctx.get('session_id')
  const sessionStore = ctx.get('session_store')

  await writeFlash(sessionId, sessionStore, 'success', 'Invoice created.')

  return ctx.redirect('/invoices')
})
```

The flash middleware reads and clears the flash data on the next request, making it available in the render context.

<a name="not-found"></a>
## Not Found

Return a 404 response:

```typescript
export const GetInvoiceHandler = defineHandler(async (ctx) => {
  const invoice = await GetInvoiceQuery(ctx.req.param('id'))

  if (!invoice) return ctx.notFound()

  return ctx.json({ invoice })
})
```

<a name="error-responses"></a>
## Error Responses

Throw a typed error — the global error handler maps it to the correct HTTP status:

```typescript
import { AuthorizationError, ValidationError } from '@lumiarq/framework'

// 403
throw new AuthorizationError('You cannot access this resource.')

// 422
throw new ValidationError('Invalid input.', { field: ['message'] })
```

See [Errors & Logging](/docs/errors-logging) for the full list of typed errors and how to define a global error handler.

<a name="response-caching-static-routes"></a>
## Response Caching (Static Routes)

For API routes with `render: 'static'`, the framework caches the response at the CDN/edge level. The handler is only called on cache miss.

```typescript
Route.get('/api/docs', DocsListApiHandler, {
  name:   'docs.api.list',
  render: 'static',
})
```

Cache invalidation is managed at the infrastructure level (CDN purge, ISR revalidation).

---

**Next:** Explore [More Features](/docs/authentication) — authentication, authorization, events, and more.
