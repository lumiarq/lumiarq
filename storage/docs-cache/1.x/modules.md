---
title: Module System
description: Creating and configuring application modules
section: Architecture Concepts
order: 2
draft: false
---

# Modules

- [Introduction](#introduction)
- [Defining a Module](#defining-a-module)
- [Full Module Configuration](#full-module-configuration)
- [Module Directory Structure](#module-directory-structure)
- [Generating a Module](#generating-a-module)
- [Module Boot Order](#module-boot-order)
- [Module Middleware](#module-middleware)
- [Module Bootstrap Files](#module-bootstrap-files)
- [Listing Modules](#listing-modules)

<a name="introduction"></a>
## Introduction

A **module** in Lumiarq is a self-contained unit that groups all code related to a single business domain. Each module owns its routes, handlers, actions, queries, tasks, events, and tests. Modules map directly to bounded contexts — nothing outside the module directory imports from its internals.

<a name="defining-a-module"></a>
## Defining a Module

Every module has a `module.ts` file at its root that registers it with the framework.

```ts
// src/modules/Billing/module.ts
import { defineModule } from '@lumiarq/framework'

export default defineModule({
  name: 'Billing',
})
```

`defineModule` accepts an options object:

| Option | Type | Description |
|---|---|---|
| `name` | `string` | Required. PascalCase module name. |
| `alias` | `string` | Optional. Lowercase alias used internally. Derived from `name` if omitted. |
| `priority` | `number` | Optional. Boot order. Lower numbers boot first. Defaults to `50`. |
| `prefix` | `string` | Optional. URL prefix applied to all routes in this module. |
| `middleware` | `MiddlewareFn[]` | Optional. Middleware applied to every request in this module. |

<a name="full-module-configuration"></a>
## Full Module Configuration

```ts
// src/modules/Billing/module.ts
import { defineModule } from '@lumiarq/framework'
import { requireAuth } from '@shared/middleware/require-auth.middleware'

export default defineModule({
  name: 'Billing',
  alias: 'billing',
  priority: 30,
  prefix: '/billing',
  middleware: [requireAuth],
})
```

With `prefix: '/billing'`, all routes inside `Billing/http/routes/` are served under `/billing/*` automatically.

<a name="module-directory-structure"></a>
## Module Directory Structure

The directory layout depends on which preset you choose when generating the module.

### Full-Stack Module

A full-stack module includes HTTP routes and handlers, business logic, UI templates, and contracts.

```
src/modules/Billing/
  module.ts
  contracts/
    index.ts
    dto/
      create-invoice.dto.ts
    events/
      invoice-created.event.ts
  http/
    handlers/
      create-invoice.handler.ts
      list-invoices.handler.ts
    routes/
      billing.web.ts
      billing.api.ts
    bindings/
      invoice.binding.ts
  logic/
    actions/
      create-invoice.action.ts
    tasks/
      send-invoice-email.task.ts
    queries/
      get-invoices.query.ts
    validators/
      create-invoice.validator.ts
  ui/
    pages/
      InvoicesPage.tsx
    mail/
      InvoiceEmail.tsx
  bootstrap/
    providers.ts
    listeners.ts
    schedule.ts
  tests/
    create-invoice.test.ts
    get-invoices.test.ts
```

### API-Only Module

An API-only module omits UI templates. Suitable for services that respond purely with JSON.

```
src/modules/Billing/
  module.ts
  contracts/
    index.ts
    dto/
      create-invoice.dto.ts
    events/
      invoice-created.event.ts
  http/
    handlers/
      create-invoice.handler.ts
      list-invoices.handler.ts
    routes/
      billing.api.ts
    bindings/
      invoice.binding.ts
  logic/
    actions/
      create-invoice.action.ts
    tasks/
      send-invoice-email.task.ts
    queries/
      get-invoices.query.ts
  bootstrap/
    providers.ts
    listeners.ts
    schedule.ts
  tests/
    create-invoice.test.ts
```

### Domain-Only Module

A domain-only module has no HTTP layer at all. Useful for shared domain logic or background processing modules.

```
src/modules/Billing/
  module.ts
  contracts/
    index.ts
    dto/
      create-invoice.dto.ts
    events/
      invoice-created.event.ts
  logic/
    actions/
      create-invoice.action.ts
    tasks/
      send-invoice-email.task.ts
    queries/
      get-invoices.query.ts
  bootstrap/
    providers.ts
    listeners.ts
    schedule.ts
  tests/
    create-invoice.test.ts
```

<a name="generating-a-module"></a>
## Generating a Module

The `lumis make:module` command scaffolds the full directory structure and boilerplate files.

```bash
# Full-stack module (routes, handlers, UI, logic, contracts)
pnpm lumis make:module Billing --full-stack

# API-only module (routes, handlers, logic, contracts — no UI)
pnpm lumis make:module Billing --api-only

# Domain-only module (logic and contracts only — no HTTP layer)
pnpm lumis make:module Billing --domain-only
```

The command creates `module.ts`, the correct subdirectories with `.gitkeep` placeholders, and a `contracts/index.ts` ready to export your public surface.

<a name="module-boot-order"></a>
## Module Boot Order

The `priority` option controls the order in which modules boot during application startup. Modules with a lower priority number boot first.

```ts
// src/modules/Core/module.ts
export default defineModule({ name: 'Core', priority: 1 })

// src/modules/Auth/module.ts
export default defineModule({ name: 'Auth', priority: 10 })

// src/modules/Billing/module.ts
export default defineModule({ name: 'Billing', priority: 30 })
```

This matters when one module's `bootstrap/providers.ts` registers services that another module depends on at boot time. Register foundational modules with a low priority number so they are ready before the modules that rely on them.

<a name="module-middleware"></a>
## Module Middleware

Middleware defined on `defineModule` runs before every handler in the module, after global middleware. This is the right place for concerns like authentication guards or role checks that apply to all routes within a domain.

```ts
// src/modules/Admin/module.ts
import { defineModule } from '@lumiarq/framework'
import { requireAuth } from '@shared/middleware/require-auth.middleware'
import { requireRole } from '@shared/middleware/require-role.middleware'

export default defineModule({
  name: 'Admin',
  prefix: '/admin',
  middleware: [requireAuth, requireRole('admin')],
})
```

All routes under `src/modules/Admin/http/routes/` inherit these middleware functions automatically. You do not need to apply them individually to each route.

<a name="module-bootstrap-files"></a>
## Module Bootstrap Files

Each module can optionally include bootstrap files that run during application startup:

```ts
// src/modules/Billing/bootstrap/providers.ts
// Register services, bindings, and singletons for this module
import { app } from '@lumiarq/framework'

app.singleton('billing.pdf', () => new PdfService())
```

```ts
// src/modules/Billing/bootstrap/listeners.ts
// Register event listeners for this module
import { EventBus } from '@lumiarq/framework'
import { InvoiceCreatedEvent } from '@modules/Billing/contracts'
import { sendInvoiceEmail } from '@modules/Billing/logic/tasks/send-invoice-email.task'

EventBus.on(InvoiceCreatedEvent, async (payload) => {
  await sendInvoiceEmail({ invoiceId: payload.invoiceId })
})
```

```ts
// src/modules/Billing/bootstrap/schedule.ts
// Register scheduled jobs for this module
import { schedule } from '@lumiarq/framework'
import { generateMonthlyInvoices } from '@modules/Billing/logic/actions/generate-monthly-invoices.action'

schedule.call(generateMonthlyInvoices, '0 0 1 * *') // 1st of every month
```

<a name="listing-modules"></a>
## Listing Modules

Use `lumis module:list` to see all registered modules, their aliases, priorities, and prefixes:

```bash
pnpm lumis module:list
```

```
MODULE     ALIAS    PRIORITY  PREFIX
Core       core     1         /
Auth       auth     10        /auth
User       user     20        /user
Billing    billing  30        /billing
```
