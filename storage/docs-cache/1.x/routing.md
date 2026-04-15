---
title: Routing
description: Defining URL routes with the Route DSL
section: The Basics
order: 1
draft: false
---

# Routing

- [Introduction](#introduction)
- [File Convention](#file-convention)
- [The Route DSL](#the-route-dsl)
- [Defining Web Routes](#defining-web-routes)
- [Defining API Routes](#defining-api-routes)
- [Route Options](#route-options)
- [Rendering Strategies](#rendering-strategies)
- [Named Routes and URL Generation](#named-routes-and-url-generation)
- [Route-Level Middleware](#route-level-middleware)
- [Route Metadata](#route-metadata)
- [Route Model Binding](#route-model-binding)
- [Generating Route Files](#generating-route-files)
- [Inspecting Registered Routes](#inspecting-registered-routes)
- [Validating Routes](#validating-routes)
- [Route Caching](#route-caching)

<a name="introduction"></a>
## Introduction

Lumiarq uses a Domain-Specific Language (DSL)-style route builder rather than file-system-based routing. Routes are defined in explicit route files inside `http/routes/` and registered with the `Route` object from `@lumiarq/framework`.

<a name="file-convention"></a>
## File Convention

The file suffix determines the route type:

| File | Route type | Auth | CSRF |
|---|---|---|---|
| `*.web.ts` | Web (browser) routes | Session cookie | Yes |
| `*.api.ts` | API routes | JWT Bearer token | No |

The framework infers these constraints from the filename at startup and enforces them. A web route file that defines an API-style route (missing CSRF configuration) produces an `InvalidApiRouteError`. A route file with neither suffix produces a `MissingRenderStrategyError`.

<a name="the-route-dsl"></a>
## The Route DSL

The `Route` object exposes one method per HTTP verb:

```ts
Route.get(path, handler, options)
Route.post(path, handler, options)
Route.put(path, handler, options)
Route.patch(path, handler, options)
Route.delete(path, handler, options)
```

Each method registers the route internally. The adapter reads from the registry at startup.

<a name="defining-web-routes"></a>
## Defining Web Routes

```ts
// src/modules/Billing/http/routes/billing.web.ts
import { Route } from '@lumiarq/framework'
import { listInvoicesHandler } from '@modules/Billing/http/handlers/list-invoices.handler'
import { showInvoiceHandler } from '@modules/Billing/http/handlers/show-invoice.handler'
import { createInvoiceHandler } from '@modules/Billing/http/handlers/create-invoice.handler'

Route.get('/billing/invoices', listInvoicesHandler, {
  name: 'billing.invoices.index',
  render: 'dynamic',
})

Route.get('/billing/invoices/:id', showInvoiceHandler, {
  name: 'billing.invoices.show',
  render: 'dynamic',
})

Route.post('/billing/invoices', createInvoiceHandler, {
  name: 'billing.invoices.store',
  render: 'dynamic',
})
```

<a name="defining-api-routes"></a>
## Defining API Routes

```ts
// src/modules/Billing/http/routes/billing.api.ts
import { Route } from '@lumiarq/framework'
import { listInvoicesHandler } from '@modules/Billing/http/handlers/list-invoices.handler'
import { createInvoiceHandler } from '@modules/Billing/http/handlers/create-invoice.handler'
import { deleteInvoiceHandler } from '@modules/Billing/http/handlers/delete-invoice.handler'

Route.get('/api/billing/invoices', listInvoicesHandler, {
  name: 'api.billing.invoices.index',
  render: 'dynamic',
})

Route.post('/api/billing/invoices', createInvoiceHandler, {
  name: 'api.billing.invoices.store',
  render: 'dynamic',
})

Route.delete('/api/billing/invoices/:id', deleteInvoiceHandler, {
  name: 'api.billing.invoices.destroy',
  render: 'dynamic',
})
```

<a name="route-options"></a>
## Route Options

Every route registration accepts an options object:

| Option | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Unique route name for URL generation. |
| `render` | `'dynamic' \| 'static'` | Yes | Rendering strategy. |
| `revalidate` | `number \| false` | No | ISR revalidation interval in seconds. Only valid with `render: 'static'`. `false` disables revalidation (pure SSG). |
| `meta` | `(ctx) => MetaData` | No | Function returning SEO metadata (title, description, og, jsonLd). |
| `bind` | `Record<string, BindingDefinition>` | No | Route model bindings. |
| `middleware` | `string[]` | No | Route-specific middleware names. |

<a name="rendering-strategies"></a>
## Rendering Strategies

The `render` option tells the framework how to serve the route:

```ts
// Dynamic — rendered fresh on every request (server-side rendering)
Route.get('/billing/invoices', listInvoicesHandler, {
  name: 'billing.invoices.index',
  render: 'dynamic',
})

// Static — rendered once at build time, served as a static file (SSG)
Route.get('/billing/pricing', pricingHandler, {
  name: 'billing.pricing',
  render: 'static',
  revalidate: false, // never revalidate
})

// ISR — statically rendered, revalidated after N seconds
Route.get('/billing/invoices/:id', showInvoiceHandler, {
  name: 'billing.invoices.show',
  render: 'static',
  revalidate: 60, // revalidate every 60 seconds
})
```

<a name="named-routes-and-url-generation"></a>
## Named Routes and URL Generation

Every route should have a unique name. Use the `route()` helper to generate URLs from named routes, which avoids hardcoding paths throughout the application.

```ts
import { route } from '@lumiarq/framework'

// Basic named route
route('billing.invoices.index')
// => '/billing/invoices'

// Route with path parameters
route('billing.invoices.show', { id: 'inv_123' })
// => '/billing/invoices/inv_123'

// Route with query string
route('billing.invoices.index', {}, { page: '2', status: 'open' })
// => '/billing/invoices?page=2&status=open'
```

If the route name is not registered, `route()` throws a `RouteNotFoundError`. Route names must be globally unique — registering a duplicate name produces a `DuplicateRouteError` at startup.

<a name="route-level-middleware"></a>
## Route-Level Middleware

Middleware applied to a specific route runs only for that route, after global and module-level middleware.

```ts
import { Route } from '@lumiarq/framework'
import { requireSubscription } from '@shared/middleware/require-subscription.middleware'

Route.get('/billing/invoices', listInvoicesHandler, {
  name: 'billing.invoices.index',
  render: 'dynamic',
  middleware: [requireSubscription],
})
```

<a name="route-metadata"></a>
## Route Metadata

The `meta` option is a function that returns SEO and Open Graph metadata for the route. It receives resolved params and loader data so you can build dynamic titles and descriptions.

```ts
Route.get('/billing/invoices/:id', showInvoiceHandler, {
  name: 'billing.invoices.show',
  render: 'static',
  revalidate: 120,
  meta: async ({ params, loaderData }) => ({
    title: `Invoice ${params.id}`,
    description: 'View your invoice details',
    og: {
      title: `Invoice ${params.id}`,
      type: 'article',
    },
  }),
})
```

Middleware can access `meta` via the route registry to implement permission guards without coupling route definitions to middleware implementations.

<a name="route-model-binding"></a>
## Route Model Binding

Route model binding automatically resolves a URL parameter into a domain object before the handler runs. Define a binding with `defineBinding`, attach it to the route with the `bind` option, and retrieve the resolved object with `ctx.bound()`.

```ts
// src/modules/Billing/http/bindings/invoice.binding.ts
import { defineBinding } from '@lumiarq/framework'
import { getInvoice } from '@modules/Billing/logic/queries/get-invoice.query'

export const invoiceBinding = defineBinding(async (id: string) => {
  // returning null triggers an automatic 404
  return getInvoice({ id })
})
```

```ts
// Route registration with binding
import { invoiceBinding } from '@modules/Billing/http/bindings/invoice.binding'

Route.get('/billing/invoices/:id', showInvoiceHandler, {
  name: 'billing.invoices.show',
  render: 'dynamic',
  bind: { id: invoiceBinding },
})
```

```ts
// Handler retrieves the pre-resolved object
export const showInvoiceHandler = defineHandler(async (ctx) => {
  const invoice = ctx.bound<Invoice>('id')
  return ctx.json({ invoice })
})
```

If `invoiceBinding` returns `null`, the framework responds with `404 Not Found` automatically — no manual check needed in the handler.

<a name="generating-route-files"></a>
## Generating Route Files

```bash
pnpm lumis make:route Billing
```

This creates `billing.web.ts` and `billing.api.ts` stubs inside `src/modules/Billing/http/routes/`.

<a name="inspecting-registered-routes"></a>
## Inspecting Registered Routes

```bash
pnpm lumis route:list
```

```
METHOD  PATH                        HANDLER                    MIDDLEWARE  RENDER       MODULE
GET     /billing/invoices           listInvoicesHandler        auth        dynamic      Billing
POST    /billing/invoices           createInvoiceHandler       auth        dynamic      Billing
GET     /billing/invoices/:id       showInvoiceHandler         auth        dynamic      Billing
```

Use `--json` for machine-readable output:

```bash
pnpm lumis route:list --json
```

<a name="validating-routes"></a>
## Validating Routes

```bash
pnpm lumis route:check
```

`route:check` validates all registered routes for:

- Missing `render` strategy
- Invalid API route in a web file (or vice versa)
- Duplicate route names
- Missing `meta` on ISR routes

Failures are printed as errors and the process exits with code `1`, making it suitable for CI.

<a name="route-caching"></a>
## Route Caching

For production builds, `lumis route:cache` statically parses all route files and writes a `bootstrap/cache/routes.json` manifest. This allows the adapter to load routes without importing every route module at startup.

```bash
pnpm lumis route:cache
pnpm lumis route:clear  # delete the cache
```

`lumis build` runs `route:cache` automatically before bundling.
