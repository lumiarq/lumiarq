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
- [Route Versioning](#route-versioning)
- [The Route DSL](#the-route-dsl)
- [Defining Web Routes](#defining-web-routes)
- [Defining API Routes](#defining-api-routes)
- [Route Groups](#route-groups)
- [Resource Routes](#resource-routes)
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

The file suffix determines the route type and the security constraints the framework enforces:

| File suffix | Route type | Auth | CSRF |
|---|---|---|---|
| `*.web.ts` | Web (browser) routes | Session cookie | Yes |
| `*.api.ts` | API routes | JWT Bearer token | No |

The framework infers these constraints from the filename at startup. A web route file that defines an API-style route produces an `InvalidApiRouteError`. A route file with neither suffix produces a `MissingRenderStrategyError`.

You can have as many route files per module as you like — the framework scans all files matching either suffix pattern inside `http/routes/`.

<a name="route-versioning"></a>
## Route Versioning

LumiARQ supports two complementary approaches to API versioning. You can use either or both in the same project.

### Versioning by filename

Prefix the filename with the version: `v1.api.ts`, `v2.api.ts`. The framework picks up any file whose name ends in `.api.ts` or `.web.ts`, regardless of what comes before the suffix.

```
src/modules/Billing/http/routes/
├── v1.api.ts     ← /api/v1/billing/...
├── v2.api.ts     ← /api/v2/billing/...
└── billing.web.ts
```

This is the **zero-config approach**: no code change needed to introduce a new version — just create the file and define routes with the appropriate prefix in the path. It also makes it immediately obvious which files to delete when deprecating a version.

```ts
// src/modules/Billing/http/routes/v1.api.ts
import { Route } from '@lumiarq/framework'
import { listInvoicesV1Handler } from '../handlers/list-invoices-v1.handler'

Route.get('/api/v1/billing/invoices', listInvoicesV1Handler, {
  name: 'v1.billing.invoices.index',
  render: 'dynamic',
})
```

```ts
// src/modules/Billing/http/routes/v2.api.ts
import { Route } from '@lumiarq/framework'
import { listInvoicesHandler } from '../handlers/list-invoices.handler'

Route.get('/api/v2/billing/invoices', listInvoicesHandler, {
  name: 'v2.billing.invoices.index',
  render: 'dynamic',
})
```

Similarly for web routes, `v1.web.ts` and `v2.web.ts` are valid filenames.

### Versioning by folder

Group version-specific routes into subdirectories:

```
src/modules/Billing/http/routes/
├── v1/
│   └── billing.api.ts    ← /api/v1/billing/...
├── v2/
│   └── billing.api.ts    ← /api/v2/billing/...
└── billing.web.ts
```

This works well when a version has many route files — the folder boundary makes the scope explicit and lets you co-locate version-specific handlers nearby.

### Versioning with `Route.group()`

For programmatic control — shared middleware, deprecation headers, or deriving the prefix from config — use `Route.group()`. See [Route Groups](#route-groups) below.

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

<a name="route-groups"></a>
## Route Groups

`Route.group()` applies shared options — a path prefix, middleware, or version — to a set of routes without repeating them on each individual registration. The callback receives no arguments; routes registered inside it inherit the group's options.

```ts
// src/modules/Billing/http/routes/v2.api.ts
import { Route } from '@lumiarq/framework'
import { requireAuth } from '@shared/middleware/require-auth.middleware'
import { listInvoicesHandler } from '../handlers/list-invoices.handler'
import { showInvoiceHandler } from '../handlers/show-invoice.handler'
import { createInvoiceHandler } from '../handlers/create-invoice.handler'
import { deleteInvoiceHandler } from '../handlers/delete-invoice.handler'

Route.group({ prefix: '/api/v2', middleware: [requireAuth] }, () => {
  Route.get('/billing/invoices', listInvoicesHandler, {
    name: 'v2.billing.invoices.index',
    render: 'dynamic',
  })

  Route.get('/billing/invoices/:id', showInvoiceHandler, {
    name: 'v2.billing.invoices.show',
    render: 'dynamic',
  })

  Route.post('/billing/invoices', createInvoiceHandler, {
    name: 'v2.billing.invoices.store',
    render: 'dynamic',
  })

  Route.delete('/billing/invoices/:id', deleteInvoiceHandler, {
    name: 'v2.billing.invoices.destroy',
    render: 'dynamic',
  })
})
```

Groups resolve their prefix by prepending it to each route's path. Middleware listed in the group runs before route-level middleware but after module-level middleware.

**Groups can be nested.** A nested group's prefix is appended to the parent's:

```ts
Route.group({ prefix: '/api/v2', middleware: [requireAuth] }, () => {
  Route.group({ prefix: '/admin', middleware: [requireAdmin] }, () => {
    Route.get('/billing/invoices', adminListInvoicesHandler, {
      name: 'v2.admin.billing.invoices.index',
      render: 'dynamic',
    })
    // resolves to: /api/v2/admin/billing/invoices
  })
})
```

### Group options

| Option | Type | Description |
|---|---|---|
| `prefix` | `string` | Path prefix prepended to every route in the group. |
| `middleware` | `Middleware[]` | Middleware applied to every route in the group. |
| `name` | `string` | Name prefix prepended to every route name in the group. |
| `version` | `number` | Semantic version tag — used by `route:list` and deprecation middleware. |

### Deprecating a version

Pass `deprecated: true` to a group (or set it on individual routes) to signal that the version is sunset. The framework automatically injects a `Deprecation` and `Sunset` response header on every matched route.

```ts
Route.group({ prefix: '/api/v1', version: 1, deprecated: true, sunset: '2026-01-01' }, () => {
  Route.get('/billing/invoices', listInvoicesV1Handler, {
    name: 'v1.billing.invoices.index',
    render: 'dynamic',
  })
})
// All v1 responses include:
// Deprecation: true
// Sunset: Sun, 01 Jan 2026 00:00:00 GMT
```

<a name="resource-routes"></a>
## Resource Routes

`Route.resource()` registers a full set of CRUD routes for a resource with one call, following LumiARQ's naming conventions.

```ts
import { Route } from '@lumiarq/framework'
import * as InvoiceHandlers from '../handlers/invoice.handlers'

Route.resource('/billing/invoices', InvoiceHandlers, {
  render: 'dynamic',
})
```

This registers the following routes automatically:

| Method | Path | Handler export | Route name |
|---|---|---|---|
| `GET` | `/billing/invoices` | `index` | `billing.invoices.index` |
| `GET` | `/billing/invoices/create` | `create` | `billing.invoices.create` |
| `POST` | `/billing/invoices` | `store` | `billing.invoices.store` |
| `GET` | `/billing/invoices/:id` | `show` | `billing.invoices.show` |
| `GET` | `/billing/invoices/:id/edit` | `edit` | `billing.invoices.edit` |
| `PUT` | `/billing/invoices/:id` | `update` | `billing.invoices.update` |
| `DELETE` | `/billing/invoices/:id` | `destroy` | `billing.invoices.destroy` |

The handler file exports a named function per action:

```ts
// src/modules/Billing/http/handlers/invoice.handlers.ts
import { defineHandler } from '@lumiarq/framework'

export const index   = defineHandler(async (ctx) => { /* list */ })
export const create  = defineHandler(async (ctx) => { /* new form */ })
export const store   = defineHandler(async (ctx) => { /* persist */ })
export const show    = defineHandler(async (ctx) => { /* single record */ })
export const edit    = defineHandler(async (ctx) => { /* edit form */ })
export const update  = defineHandler(async (ctx) => { /* update */ })
export const destroy = defineHandler(async (ctx) => { /* delete */ })
```

**Limiting resource actions** — use `only` or `except` to register a subset:

```ts
// Register only index + show
Route.resource('/billing/invoices', InvoiceHandlers, {
  render: 'dynamic',
  only: ['index', 'show'],
})

// Register everything except create + edit (useful for API-only resources)
Route.resource('/api/v2/billing/invoices', InvoiceHandlers, {
  render: 'dynamic',
  except: ['create', 'edit'],
})
```

**API resources** — `Route.apiResource()` is shorthand for `except: ['create', 'edit']`, since those actions serve HTML forms which don't exist in pure JSON APIs:

```ts
Route.apiResource('/api/v2/billing/invoices', InvoiceHandlers, {
  render: 'dynamic',
})
// Registers: index, store, show, update, destroy
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
| `middleware` | `Middleware[]` | No | Route-specific middleware. Runs after group and module middleware. |
| `deprecated` | `boolean` | No | Marks the route as deprecated. Injects `Deprecation: true` response header. |
| `sunset` | `string` | No | ISO 8601 date after which the route will be removed. Injects a `Sunset` response header. |

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
# Standard web + API stubs
pnpm lumis make:route Billing

# Versioned — creates v2.api.ts
pnpm lumis make:route Billing --api --version 2

# Resource route — creates the handler file with all 7 exports pre-filled
pnpm lumis make:route Billing --resource
```

`make:route Billing` without flags creates `billing.web.ts` and `billing.api.ts` stubs inside `src/modules/Billing/http/routes/`.

`--version 2` prefixes the filename: `v2.api.ts` or `v2.web.ts`.

`--resource` creates both the route file with a `Route.resource()` call and the handler file with named `index`, `create`, `store`, `show`, `edit`, `update`, and `destroy` exports.

<a name="inspecting-registered-routes"></a>
## Inspecting Registered Routes

```bash
pnpm lumis route:list
```

```
METHOD  PATH                          HANDLER                  MIDDLEWARE  RENDER    VERSION  MODULE
GET     /api/v1/billing/invoices      listInvoicesV1Handler    auth        dynamic   v1 ⚠    Billing
GET     /api/v2/billing/invoices      listInvoicesHandler      auth        dynamic   v2       Billing
POST    /api/v2/billing/invoices      createInvoiceHandler     auth        dynamic   v2       Billing
GET     /api/v2/billing/invoices/:id  showInvoiceHandler       auth        dynamic   v2       Billing
```

The `⚠` marker appears on deprecated routes. Use `--deprecated` to filter to deprecated routes only:

```bash
pnpm lumis route:list --deprecated
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
