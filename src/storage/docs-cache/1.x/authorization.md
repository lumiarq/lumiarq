---
title: Authorization
description: Controlling access with policies and middleware
section: Security
order: 2
draft: false
---

# Authorization

- [Introduction](#introduction)
- [Policies](#policies)
- [Using Policies in Handlers](#using-policies-in-handlers)
- [Route-Level Authorization](#route-level-authorization)
- [Route Model Binding with Authorization](#route-model-binding-with-authorization)
- [Confirming Sensitive Actions](#confirming-sensitive-actions)
- [Role-Based Access Control](#role-based-access-control)
- [Testing Policies](#testing-policies)

<a name="introduction"></a>

Lumiarq separates authentication (who you are) from authorization (what you can do). Authorization is expressed through policies — plain TypeScript functions that return a boolean.

<a name="policies"></a>
## Policies

A policy is a function created with `definePolicy` that receives the current user and the resource being accessed, then returns `true` to allow or `false` to deny.

### Defining a Policy

```typescript
// src/modules/Billing/logic/policies/invoice.policy.ts
import { definePolicy } from '@lumiarq/framework'
import type { AuthUser } from '@lumiarq/framework/auth'
import type { Invoice } from '../../contracts/types/invoice.types'

export const InvoicePolicy = {
  view: definePolicy((user: AuthUser, invoice: Invoice) => {
    return invoice.userId === user.id || user.role === 'admin'
  }),

  update: definePolicy((user: AuthUser, invoice: Invoice) => {
    return invoice.userId === user.id && invoice.status === 'draft'
  }),

  delete: definePolicy((user: AuthUser, invoice: Invoice) => {
    return user.role === 'admin'
  }),
}
```

`definePolicy` is a thin wrapper that provides type safety and integrates with the framework's policy runner. The inner function is synchronous or async — both are supported.

### Async Policies

Policies can be async when they need to consult the database:

```typescript
import { definePolicy } from '@lumiarq/framework'
import type { AuthUser } from '@lumiarq/framework/auth'
import type { Project } from '../../contracts/types/project.types'
import { ProjectMemberRepository } from '../../data/repositories/project-member.repository'

export const ProjectPolicy = {
  access: definePolicy(async (user: AuthUser, project: Project) => {
    if (project.ownerId === user.id) return true

    const membership = await ProjectMemberRepository.findByUserAndProject(
      user.id,
      project.id,
    )

    return membership !== null
  }),
}
```

<a name="using-policies-in-handlers"></a>
## Using Policies in Handlers

Import the policy and call it directly in your handler. Throw an `AuthorizationError` when access is denied:

```typescript
// src/modules/Billing/http/handlers/update-invoice.handler.ts
import { defineHandler, AuthorizationError } from '@lumiarq/framework'
import { InvoicePolicy } from '../../logic/policies/invoice.policy'
import { GetInvoiceQuery } from '../../logic/queries/get-invoice.query'
import { UpdateInvoiceAction } from '../../logic/actions/update-invoice.action'

export const UpdateInvoiceHandler = defineHandler(async (ctx) => {
  const user = ctx.get('user')
  const invoiceId = ctx.req.param('id')

  const invoice = await GetInvoiceQuery(invoiceId)

  if (!invoice) {
    return ctx.json({ error: 'Not found' }, 404)
  }

  const allowed = await InvoicePolicy.update(user, invoice)

  if (!allowed) {
    throw new AuthorizationError('You are not allowed to edit this invoice.')
  }

  const dto = await ctx.req.json()
  const updated = await UpdateInvoiceAction({ id: invoiceId, ...dto })

  return ctx.json(updated)
})
```

### Returning 403 vs Throwing

For API routes, throwing `AuthorizationError` produces a `403 Forbidden` JSON response automatically. For web routes, it redirects to the configured forbidden page. You can also return a manual response if you need custom behaviour:

```typescript
const allowed = await InvoicePolicy.view(user, invoice)

if (!allowed) {
  return ctx.json({ error: 'Forbidden' }, 403)
}
```

<a name="route-level-authorization"></a>
## Route-Level Authorization

You can attach middleware directly to route definitions to gate access before the handler runs:

```typescript
// src/modules/Billing/http/routes/invoice.web.ts
import { Route } from '@lumiarq/framework'
import { UpdateInvoiceHandler } from '../handlers/update-invoice.handler'
import { DeleteInvoiceHandler } from '../handlers/delete-invoice.handler'

Route.put('/invoices/:id', UpdateInvoiceHandler, {
  name: 'billing.invoices.update',
  render: 'redirect',
  middleware: ['auth', 'verified'],
})

Route.delete('/invoices/:id', DeleteInvoiceHandler, {
  name: 'billing.invoices.delete',
  render: 'redirect',
  middleware: ['auth', 'verified', 'role:admin'],
})
```

<a name="route-model-binding-with-authorization"></a>
## Route Model Binding with Authorization

Route model binding resolves a URL parameter into a domain object before the handler is called. Combining binding with a policy check is the cleanest way to express resource-level authorization.

### Defining a Binding

```typescript
// src/modules/Billing/http/bindings/invoice.binding.ts
import { defineBinding } from '@lumiarq/framework'
import type { Invoice } from '../../contracts/types/invoice.types'
import { GetInvoiceQuery } from '../../logic/queries/get-invoice.query'

export const InvoiceBinding = defineBinding<Invoice>(async (id) => {
  return GetInvoiceQuery(id) // returns null → automatic 404
})
```

### Using a Binding in a Route

```typescript
Route.get('/invoices/:invoice', ShowInvoiceHandler, {
  name: 'billing.invoices.show',
  render: 'traditional',
  middleware: ['auth'],
  bind: { invoice: InvoiceBinding },
})
```

### Accessing the Bound Resource

```typescript
export const ShowInvoiceHandler = defineHandler(async (ctx) => {
  const user = ctx.get('user')
  const invoice = ctx.bound<Invoice>('invoice')

  const allowed = await InvoicePolicy.view(user, invoice)

  if (!allowed) {
    throw new AuthorizationError()
  }

  return ctx.html(InvoicePage({ invoice }))
})
```

The binding runs before your handler. If `GetInvoiceQuery` returns `null`, the framework responds with `404` automatically — your handler only runs when the resource exists.

<a name="confirming-sensitive-actions"></a>
## Confirming Sensitive Actions

Some actions — deleting an account, changing a password, viewing billing details — should require the user to re-enter their password even if they are already logged in. Use `confirmedMiddleware` for this:

```typescript
// bootstrap/providers.ts (register the middleware)
import { confirmedMiddleware } from '@lumiarq/framework'
import { sessionStore } from './providers'

app.use(
  '/settings/danger-zone/*',
  confirmedMiddleware({
    sessionStore,
    window: 3 * 60 * 60 * 1000, // 3 hours in milliseconds
    redirectTo: '/confirm-password',
  }),
)
```

When a user hits a guarded route without a recent confirmation:

- **Web routes** — they are redirected to `/confirm-password`
- **API routes** — they receive a `423 Locked` JSON response

After the user re-enters their password, write the confirmation timestamp to the session:

```typescript
// src/modules/Auth/http/handlers/confirm-password.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { writeConfirmedAt } from '@lumiarq/framework'
import { VerifyPasswordAction } from '../../logic/actions/verify-password.action'

export const ConfirmPasswordHandler = defineHandler(async (ctx) => {
  const user = ctx.get('user')
  const { password } = await ctx.req.json()

  await VerifyPasswordAction({ userId: user.id, password })

  const sessionId = ctx.get('sessionId')
  const store = ctx.get('sessionStore')

  await writeConfirmedAt(sessionId, store)

  return ctx.redirect(ctx.req.header('Referer') ?? '/dashboard')
})
```

<a name="role-based-access-control"></a>
## Role-Based Access Control

For coarse-grained access control, store a `role` field on your user record and check it inside policies:

```typescript
// src/modules/Admin/logic/policies/admin.policy.ts
import { definePolicy } from '@lumiarq/framework'
import type { AuthUser } from '@lumiarq/framework/auth'

export const AdminPolicy = {
  access: definePolicy((user: AuthUser) => {
    return user.role === 'admin' || user.role === 'superadmin'
  }),

  manageUsers: definePolicy((user: AuthUser) => {
    return user.role === 'superadmin'
  }),
}
```

For fine-grained permission systems — roles, permissions, team membership — install the IAM bounded context:

```bash
pnpm lumis auth:install --iam
```

The IAM module provides a self-contained implementation of roles, permissions, and resource-based access control with its own database tables and logic layer.

<a name="testing-policies"></a>
## Testing Policies

Policies are plain functions — test them directly without an HTTP context:

```typescript
// src/modules/Billing/tests/invoice.policy.test.ts
import { describe, it, expect } from 'vitest'
import { InvoicePolicy } from '@modules/Billing/logic/policies/invoice.policy'
import type { AuthUser } from '@lumiarq/framework/auth'
import type { Invoice } from '@modules/Billing/contracts/types/invoice.types'

const owner: AuthUser = { id: 'user_1', role: 'user', email: 'owner@example.com' }
const admin: AuthUser = { id: 'user_2', role: 'admin', email: 'admin@example.com' }
const stranger: AuthUser = { id: 'user_3', role: 'user', email: 'other@example.com' }

const draftInvoice: Invoice = {
  id:       'inv_001',
  userId:   'user_1',
  status:   'draft',
  totalCents: 5000,
}

const paidInvoice: Invoice = { ...draftInvoice, status: 'paid' }

describe('InvoicePolicy', () => {
  describe('view', () => {
    it('allows the owner to view their invoice', () => {
      expect(InvoicePolicy.view(owner, draftInvoice)).toBe(true)
    })

    it('allows admins to view any invoice', () => {
      expect(InvoicePolicy.view(admin, draftInvoice)).toBe(true)
    })

    it('denies strangers from viewing the invoice', () => {
      expect(InvoicePolicy.view(stranger, draftInvoice)).toBe(false)
    })
  })

  describe('update', () => {
    it('allows the owner to update a draft invoice', () => {
      expect(InvoicePolicy.update(owner, draftInvoice)).toBe(true)
    })

    it('denies the owner from updating a paid invoice', () => {
      expect(InvoicePolicy.update(owner, paidInvoice)).toBe(false)
    })

    it('denies admins from updating invoices they do not own', () => {
      expect(InvoicePolicy.update(admin, draftInvoice)).toBe(false)
    })
  })

  describe('delete', () => {
    it('allows admins to delete any invoice', () => {
      expect(InvoicePolicy.delete(admin, draftInvoice)).toBe(true)
    })

    it('denies non-admins from deleting invoices', () => {
      expect(InvoicePolicy.delete(owner, draftInvoice)).toBe(false)
    })
  })
})
```

For async policies that call the database, wrap the test in `withTestContext` so the database connection is available and the writes are rolled back:

```typescript
import { withTestContext } from '@lumiarq/framework/testing'
import { ProjectPolicy } from '@modules/Projects/logic/policies/project.policy'

it('allows project members to access a private project', withTestContext(async (ctx) => {
  const owner  = await ctx.factory('user').create()
  const member = await ctx.factory('user').create()
  const project = await ctx.factory('project').create({ ownerId: owner.id, visibility: 'private' })

  // Create the membership record
  await ctx.factory('projectMember').create({ userId: member.id, projectId: project.id })

  const allowed = await ProjectPolicy.access(member, project)
  expect(allowed).toBe(true)
}))
```

---

**Next:** Learn about caching expensive operations with the [Cache](/docs/cache) system.

**Next:** Learn about caching expensive operations with the [Cache](/docs/cache) system.
