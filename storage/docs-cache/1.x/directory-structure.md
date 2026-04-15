---
title: Directory Structure
description: Understanding the Lumiarq application directory structure
section: Getting Started
order: 3
draft: false
---

# Directory Structure

- [Introduction](#introduction)
- [The Root Directory](#the-root-directory)
    - [The `bootstrap` Directory](#the-bootstrap-directory)
    - [The `config` Directory](#the-config-directory)
    - [The `src` Directory](#the-src-directory)
    - [The `lang` Directory](#the-lang-directory)
    - [The `storage` Directory](#the-storage-directory)
    - [The `tests` Directory](#the-tests-directory)
    - [The `public` Directory](#the-public-directory)
- [The `src` Directory](#the-src-directory-detail)
    - [The `modules` Directory](#the-modules-directory)
    - [The `shared` Directory](#the-shared-directory)
- [Module Directory Structure](#module-directory-structure)
    - [Full-Stack Module](#full-stack-module)
    - [API-Only Module](#api-only-module)
    - [Domain-Only Module](#domain-only-module)
- [Module Layer Reference](#module-layer-reference)

<a name="introduction"></a>
## Introduction

A LumiARQ application follows a deliberate, convention-driven layout. Every top-level directory has a single responsibility, and the module system under `src/modules/` mirrors that same discipline at the feature level.

Understanding this structure is the foundation for navigating and scaling any LumiARQ codebase. By the end of this page you will know exactly where every file lives and why it lives there.

<a name="the-root-directory"></a>
## The Root Directory

A freshly generated LumiARQ project looks like this:

```
my-app/
  bootstrap/
  config/
  lang/
  public/
  src/
  storage/
  tests/
  package.json
  tsconfig.json
  vitest.config.ts
```

<a name="the-bootstrap-directory"></a>
### The `bootstrap` Directory

The `bootstrap` directory wires the application together before the first request arrives. It contains three files:

| File | Purpose |
|---|---|
| `entry.ts` | Application entry point. Calls `boot()` and exports the adapter. |
| `env.ts` | Declares and validates all environment variables with Zod. |
| `providers.ts` | Registers framework service providers (logger, cache, mailer, queue, etc.). |

You normally only edit `providers.ts` when adding or swapping infrastructure services, and `env.ts` when adding new environment variables. The `entry.ts` file rarely needs touching.

```ts
// bootstrap/entry.ts
import { boot } from '@lumiarq/framework'
import './env'
import './providers'
import '@/storage/framework/cache/routes.loader'

export default boot()
```

<a name="the-config-directory"></a>
### The `config` Directory

The `config` directory contains typed configuration objects consumed by framework providers. Each file exports a single object.

```
config/
  app.ts        ← Application name, URL, locale, timezone
  auth.ts       ← JWT secrets, session TTLs
  cache.ts      ← Cache driver and TTL settings
  database.ts   ← Database connection parameters
  logging.ts    ← Log transports and levels
  mail.ts       ← SMTP / SES credentials
  queue.ts      ← Queue driver, retry policy
  security.ts   ← CORS origins, rate limits
  session.ts    ← Session driver and cookie settings
  storage.ts    ← Disk and cloud storage buckets
```

> **Note** — You do not need all files. A docs site or API-only application can delete `mail.ts`, `queue.ts`, `session.ts`, and `storage.ts`. The framework only reads config files that the registered providers depend on.

<a name="the-src-directory"></a>
### The `src` Directory

All application code lives inside `src/`. There are two top-level subdirectories:

```
src/
  modules/   ← One subdirectory per feature domain
  shared/    ← Cross-module utilities (middleware, base classes, database schemas)
```

<a name="the-lang-directory"></a>
### The `lang` Directory

The `lang` directory holds translation files. Each locale gets its own JSON file named with a BCP 47 tag.

```
lang/
  en.json
  fr.json
  es.json
```

These files are loaded by the framework's localisation helpers. The default locale is `en` and falls back to `en.json` when a key is missing from another locale file.

<a name="the-storage-directory"></a>
### The `storage` Directory

The `storage` directory holds generated artefacts and runtime data that should not be committed to version control.

```
storage/
  framework/
    cache/
      routes.loader.ts   ← Auto-generated route manifest (lumis route:cache)
    views/               ← Pre-compiled template output
  logs/                  ← Rotating log files (local log driver)
  uploads/               ← File uploads (local storage driver)
```

> **Warning** — Do not commit the `storage/` directory to source control. Add it to `.gitignore` — except for `storage/framework/cache/routes.loader.ts`, which is committed and regenerated on every build.

<a name="the-tests-directory"></a>
### The `tests` Directory

The `tests` directory at the project root holds integration and end-to-end tests that span multiple modules. Unit tests for individual features live inside `src/modules/{Module}/tests/`.

```
tests/
  integration/
    billing-flow.test.ts
  e2e/
    checkout.test.ts
```

<a name="the-public-directory"></a>
### The `public` Directory

The `public` directory contains static assets served directly by the web server. Files placed here are accessible at the root URL without framework routing.

```
public/
  favicon.ico
  robots.txt
  images/
  fonts/
```

<a name="the-src-directory-detail"></a>
## The `src` Directory

<a name="the-modules-directory"></a>
### The `modules` Directory

Each subdirectory inside `src/modules/` represents a single bounded context. A module owns every file related to its domain: routes, handlers, actions, queries, tasks, events, validators, UI templates, and tests. Nothing outside the module directory imports from its internals.

```
src/modules/
  Billing/
  Users/
  Notifications/
  Shared/         ← Cross-module helpers attached as a module
```

See [Module Directory Structure](#module-directory-structure) for the internal layout.

<a name="the-shared-directory"></a>
### The `shared` Directory

The `shared` directory holds code that is genuinely cross-cutting — elements that do not belong to any single business domain.

```
src/shared/
  database/
    migrations/       ← Drizzle migration files
    schemas/          ← Drizzle table schemas
    seeds/            ← Optional seed scripts
  middlewares/        ← Global authentication, locale, rate-limit middleware
  exceptions/         ← Base error classes
  providers/          ← Custom service provider implementations
  security/           ← Hashing helpers, token utilities
```

> **Note** — If you find yourself adding business logic to `shared/`, it is a signal that the code should live in a dedicated module instead.

<a name="module-directory-structure"></a>
## Module Directory Structure

Every module follows the same four-layer layout. What changes between presets is which layers are present.

<a name="full-stack-module"></a>
### Full-Stack Module

A full-stack module includes all four layers: HTTP, logic, UI, and contracts.

```
src/modules/Billing/
  module.ts                            ← Module registration
  index.ts                             ← Public barrel export
  contracts/
    index.ts
    dto/
      create-invoice.dto.ts
      update-invoice.dto.ts
    events/
      invoice-created.event.ts
      invoice-paid.event.ts
    types/
      invoice.types.ts
  http/
    handlers/
      create-invoice.handler.ts
      list-invoices.handler.ts
      show-invoice.handler.ts
    routes/
      billing.web.ts
      billing.api.ts
    bindings/
      invoice.binding.ts
  logic/
    actions/
      create-invoice.action.ts
      mark-invoice-paid.action.ts
    tasks/
      send-invoice-email.task.ts
    queries/
      get-invoices.query.ts
      get-invoice.query.ts
    validators/
      create-invoice.validator.ts
    repositories/
      invoice.repository.ts
  ui/
    pages/
      InvoicesPage.tsx
      ShowInvoicePage.tsx
    mail/
      InvoiceEmail.tsx
    components/
      InvoiceCard.tsx
  bootstrap/
    providers.ts
    listeners.ts
    schedule.ts
  tests/
    create-invoice.test.ts
    get-invoices.test.ts
```

<a name="api-only-module"></a>
### API-Only Module

An API-only module omits the `ui/` layer. Every handler returns JSON.

```
src/modules/Orders/
  module.ts
  index.ts
  contracts/
    dto/
      create-order.dto.ts
    events/
      order-placed.event.ts
  http/
    handlers/
      create-order.handler.ts
      list-orders.handler.ts
    routes/
      orders.api.ts
  logic/
    actions/
      place-order.action.ts
    tasks/
      reserve-inventory.task.ts
    queries/
      get-orders.query.ts
    validators/
      create-order.validator.ts
  bootstrap/
    providers.ts
    listeners.ts
  tests/
    place-order.test.ts
```

<a name="domain-only-module"></a>
### Domain-Only Module

A domain-only module has no HTTP layer at all. It exposes actions and queries for other modules to call, and registers listeners and scheduled jobs.

```
src/modules/Reporting/
  module.ts
  index.ts
  contracts/
    dto/
      generate-report.dto.ts
    events/
      report-generated.event.ts
  logic/
    actions/
      generate-monthly-report.action.ts
    tasks/
      export-report-to-storage.task.ts
    queries/
      get-report-summary.query.ts
  bootstrap/
    listeners.ts
    schedule.ts
  tests/
    generate-report.test.ts
```

<a name="module-layer-reference"></a>
## Module Layer Reference

| Directory | Layer | Purpose |
|---|---|---|
| `contracts/` | Contracts | Shared DTOs, events, and type definitions. Other modules may import from here. |
| `http/handlers/` | HTTP | Entry points for HTTP requests. Thin — validates input, delegates, returns response. |
| `http/routes/` | HTTP | Route registration files (`*.web.ts`, `*.api.ts`). |
| `http/bindings/` | HTTP | Route-model binding resolvers. |
| `logic/actions/` | Logic | Write-side business operations. Created with `defineAction`. |
| `logic/tasks/` | Logic | Side-effect operations (email, storage, queue dispatch). Created with `defineTask`. |
| `logic/queries/` | Logic | Read-side data projections. Created with `defineQuery`. |
| `logic/validators/` | Logic | Zod schemas used by handlers to validate request bodies. |
| `logic/repositories/` | Logic | Database access abstractions. |
| `ui/pages/` | UI | Server-rendered HTML page components. |
| `ui/mail/` | UI | Email template components. |
| `ui/components/` | UI | Reusable UI components scoped to the module. |
| `bootstrap/` | Bootstrap | Per-module providers, event listeners, and scheduled jobs. |
| `tests/` | Tests | Unit and integration tests for this module. |

For a deeper explanation of how these layers interact, see [The Unidirectional Flow](/docs/unidirectional-flow).
