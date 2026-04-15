---
title: Getting Started
description: Testing your Lumiarq application with Vitest
section: Testing
order: 1
draft: false
---

# Testing

- [Introduction](#introduction)
- [Setup](#setup)
- [withTestContext](#withtestcontext)
- [Writing Action Tests](#writing-action-tests)
- [Writing Query Tests](#writing-query-tests)
- [Scaffolding Tests with the CLI](#scaffolding-tests-with-the-cli)
- [Test File Location](#test-file-location)
- [Running Tests](#running-tests)
- [Mocking External Services](#mocking-external-services)
- [Factory Helpers](#factory-helpers)
- [HTTP Integration Tests](#http-integration-tests)

<a name="introduction"></a>

Lumiarq applications are tested with [Vitest](https://vitest.dev/). The framework ships a `withTestContext` helper from `@lumiarq/runtime` that wraps each test in an isolated database transaction which is always rolled back — regardless of whether the test passes or throws. This means tests never leave dirty data behind and can run in parallel without interfering with one another.

<a name="setup"></a>
## Setup

Add Vitest to your project if it is not already present:

```bash
pnpm add -D vitest @vitest/coverage-v8
```

A minimal `vitest.config.ts` at the project root:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
  },
})
```

Create a global setup file to point `APP_ENV` at `'testing'` before any test runs:

```typescript
// tests/setup.ts
process.env.APP_ENV = 'testing'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? ':memory:'
```

<a name="withtestcontext"></a>
## withTestContext

`withTestContext` from `@lumiarq/runtime` is the central testing primitive. It returns a zero-argument async function, which is exactly what `it()` expects as its second argument:

```typescript
import { withTestContext } from '@lumiarq/runtime'

it('description', withTestContext(overrides, async () => {
  // your test body
}))
```

Internally, `withTestContext`:

1. Opens a nested database transaction (using savepoints on SQLite/Postgres).
2. Runs your test function inside that transaction.
3. Rolls back the transaction unconditionally via `TestRollbackSentinel`, whether or not the test threw.

This means `INSERT`, `UPDATE`, and `DELETE` operations performed during a test are never committed to the database.

### Overrides

The first argument to `withTestContext` accepts optional overrides for the test context:

```typescript
interface WithTestContextOverrides {
  db?: string        // Override the database connection name (default: 'default')
  locale?: string    // Override the request locale (default: 'en')
  testId?: string    // Explicit test identifier (auto-generated when omitted)
}
```

Most tests use an empty overrides object:

```typescript
withTestContext({}, async () => { /* ... */ })
```

When you need to test behaviour against a secondary database connection:

```typescript
withTestContext({ db: 'reporting' }, async () => { /* ... */ })
```

<a name="writing-action-tests"></a>
## Writing Action Tests

Actions are plain async functions and are easy to test directly. `withTestContext` handles the transactional isolation:

```typescript
// src/modules/Billing/tests/create-invoice.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'
import { CreateInvoiceAction } from '@modules/Billing/logic/actions/create-invoice.action'

describe('CreateInvoiceAction', () => {
  it(
    'creates an invoice with the correct total',
    withTestContext({}, async () => {
      const invoice = await CreateInvoiceAction({
        userId: 'user-abc',
        lineItems: [
          { description: 'Design work', amount: 3500 },
          { description: 'Development', amount: 7200 },
        ],
      })

      expect(invoice.id).toBeDefined()
      expect(invoice.userId).toBe('user-abc')
      expect(invoice.total).toBe(10700)
      expect(invoice.status).toBe('pending')
    })
  )

  it(
    'throws when line items are empty',
    withTestContext({}, async () => {
      await expect(
        CreateInvoiceAction({ userId: 'user-abc', lineItems: [] })
      ).rejects.toThrow('at least one line item is required')
    })
  )
})
```

<a name="writing-query-tests"></a>
## Writing Query Tests

Queries are read-only and equally straightforward. Seed data inserted during the test is rolled back afterwards:

```typescript
// src/modules/Billing/tests/get-invoices.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'
import { db } from '@bootstrap/providers'
import { invoices } from '@modules/Billing/infrastructure/schema'
import { GetInvoicesQuery } from '@modules/Billing/logic/queries/get-invoices.query'

describe('GetInvoicesQuery', () => {
  it(
    'returns only invoices belonging to the requested user',
    withTestContext({}, async () => {
      // Seed — will be rolled back when the test finishes
      await db.insert(invoices).values([
        { id: 'inv-1', userId: 'alice', status: 'paid', total: 1000 },
        { id: 'inv-2', userId: 'alice', status: 'pending', total: 2000 },
        { id: 'inv-3', userId: 'bob', status: 'pending', total: 500 },
      ])

      const result = await GetInvoicesQuery('alice')

      expect(result).toHaveLength(2)
      expect(result.every((inv) => inv.userId === 'alice')).toBe(true)
    })
  )
})
```

<a name="scaffolding-tests-with-the-cli"></a>
## Scaffolding Tests with the CLI

The `--with-task` flag on `lumis make:action` generates four files at once — the action, the task it delegates to, a shared DTO, and a pre-wired failing test:

```bash
lumis make:action Billing CreateInvoice --with-task
```

Generated files:

```
src/modules/Billing/logic/actions/create-invoice.action.ts
src/modules/Billing/logic/tasks/create-invoice.task.ts
src/modules/Billing/contracts/dto/create-invoice.dto.ts
src/modules/Billing/tests/create-invoice.test.ts
```

The generated test stub uses `withTestContext` with a deliberately failing assertion, reminding you to fill in real assertions:

```typescript
// generated: src/modules/Billing/tests/create-invoice.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'

describe('CreateInvoiceAction', () => {
  it(
    'creates an invoice',
    withTestContext({}, async () => {
      expect(true).toBe(false) // TODO: implement test
    })
  )
})
```

<a name="test-file-location"></a>
## Test File Location

Tests live alongside the logic they exercise inside the module:

```
src/modules/Billing/
├── logic/
│   ├── actions/
│   │   └── create-invoice.action.ts
│   └── queries/
│       └── get-invoices.query.ts
└── tests/
    ├── create-invoice.test.ts
    └── get-invoices.test.ts
```

Keeping tests co-located with their module makes it clear which module owns which test and avoids a monolithic top-level `tests/` directory that grows unwieldy.

<a name="running-tests"></a>
## Running Tests

```bash
# Run all tests
pnpm vitest run

# Watch mode
pnpm vitest

# Run tests for a specific module
pnpm vitest run src/modules/Billing

# Coverage report
pnpm vitest run --coverage
```

<a name="mocking-external-services"></a>
## Mocking External Services

When you need to assert that a service was called without actually executing it, use Vitest's `vi.doMock` to replace the provider before importing the module under test:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'

describe('RegisterUserAction — email side-effect', () => {
  it(
    'dispatches a welcome email task on success',
    withTestContext({}, async () => {
      const sendSpy = vi.fn().mockResolvedValue(undefined)
      vi.doMock('@bootstrap/providers', () => ({
        db: vi.fn(), // replaced with real db in real tests — simplified here
        mailer: { send: sendSpy },
      }))

      const { RegisterUserAction } = await import(
        '@modules/Auth/logic/actions/register-user.action'
      )

      await RegisterUserAction({
        email: 'alice@example.com',
        name: 'Alice',
        passwordHash: 'hashed',
      })

      expect(sendSpy).toHaveBeenCalledOnce()
    })
  )
})
```

<a name="factory-helpers"></a>
## Factory Helpers

Raw `db.insert()` calls in tests are verbose and tightly coupled to the schema. Factory helpers give you a clean, reusable way to seed test records with sensible defaults and override only what matters for the test.

Define factories in `tests/factories/` inside the owning module:

```typescript
// src/modules/Billing/tests/factories/invoice.factory.ts
import { db } from '@bootstrap/providers'
import { invoices } from '@modules/Billing/infrastructure/schema'
import { faker } from '@faker-js/faker'
import { randomUUID } from 'node:crypto'
import type { InferInsertModel } from 'drizzle-orm'

type InvoiceInsert = InferInsertModel<typeof invoices>

export async function invoiceFactory(
  overrides: Partial<InvoiceInsert> = {},
) {
  const [row] = await db
    .insert(invoices)
    .values({
      id:          randomUUID(),
      userId:      randomUUID(),
      status:      'pending',
      totalCents:  faker.number.int({ min: 100, max: 100_000 }),
      dueDate:     new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning()

  return row
}
```

Use the factory in tests:

```typescript
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'
import { invoiceFactory } from '../factories/invoice.factory'
import { GetInvoiceQuery } from '@modules/Billing/logic/queries/get-invoice.query'

describe('GetInvoiceQuery', () => {
  it('returns the invoice when it exists', withTestContext(async () => {
    const seeded = await invoiceFactory({ status: 'paid', totalCents: 5000 })

    const result = await GetInvoiceQuery(seeded.id)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(seeded.id)
    expect(result!.status).toBe('paid')
  }))

  it('returns null for a non-existent id', withTestContext(async () => {
    const result = await GetInvoiceQuery('inv_does_not_exist')
    expect(result).toBeNull()
  }))
})
```

The factory inserts a row inside the test's transaction scope, so it is rolled back automatically when the test ends — no manual cleanup needed.

<a name="http-integration-tests"></a>
## HTTP Integration Tests

For end-to-end tests that exercise the full request stack (middleware → handler → response), use `buildTestApp` from `@lumiarq/framework/testing`. It boots the application with its route module but replaces the database with the test transaction:

```typescript
// src/modules/Billing/tests/create-invoice.http.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'
import { buildTestApp } from '@lumiarq/framework/testing'
import { BillingModule } from '@modules/Billing/billing.module'

describe('POST /billing/invoices', () => {
  it('creates an invoice and returns 201', withTestContext(async () => {
    const app = buildTestApp([BillingModule], {
      // Simulate an authenticated user
      headers: { Authorization: 'Bearer test-token-user_1' },
    })

    const response = await app.request('/billing/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: 'cust_001',
        lineItems:  [{ description: 'Consulting', quantity: 1, unitCents: 5000 }],
        dueDateIso: '2026-06-30',
      }),
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.invoice.id).toBeDefined()
    expect(body.invoice.totalCents).toBe(5000)
  }))

  it('returns 422 when line items are empty', withTestContext(async () => {
    const app = buildTestApp([BillingModule], {
      headers: { Authorization: 'Bearer test-token-user_1' },
    })

    const response = await app.request('/billing/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: 'cust_001', lineItems: [] }),
    })

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.errors.lineItems).toBeDefined()
  }))
})
```

---

**Next:** Learn how to validate request data with [Validation](/docs/validation).
