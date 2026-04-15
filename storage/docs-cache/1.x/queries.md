---
title: Queries
description: Reading data with type-safe query functions
section: Architecture Concepts
order: 8
draft: false
---

# Queries

- [Introduction](#introduction)
- [Defining a Query](#defining-a-query)
- [A Complete Query](#a-complete-query)
- [Generating a Query](#generating-a-query)
- [Using BaseRepository in a Query](#using-baserepository-in-a-query)
- [Calling a Query from a Handler](#calling-a-query-from-a-handler)
- [Calling a Query from a Content Loader](#calling-a-query-from-a-content-loader)
- [Cursor-Based Pagination](#cursor-based-pagination)
- [Queries Are Not for Writes](#queries-are-not-for-writes)
- [Exporting Queries from the Module's Public Contract](#exporting-queries-from-the-modules-public-contract)
- [Testing a Query](#testing-a-query)

<a name="introduction"></a>

A **query** is a read-only operation that fetches data from the application's data store. Queries live in `logic/queries/` inside a module and are created with `defineQuery`. They are the only mechanism handlers and content loaders should use to read data.

The contract is strict: queries do not write, do not mutate state, do not emit events, and do not call actions or tasks. They return data. That constraint makes them predictable, cacheable, and trivially testable.

<a name="defining-a-query"></a>
## Defining a Query

```ts
import { defineQuery } from '@lumiarq/framework'

export const getInvoices = defineQuery(async ({ userId }: GetInvoicesDto) => {
  // fetch and return invoices
})
```

`defineQuery` wraps your function and registers it as a read-only query. The wrapped function is called with the DTO directly.

<a name="a-complete-query"></a>
## A Complete Query

```ts
// src/modules/Billing/logic/queries/get-invoices.query.ts
import { defineQuery } from '@lumiarq/framework'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'

const repo = new InvoiceRepository()

export interface GetInvoicesDto {
  userId: string
  status?: 'draft' | 'open' | 'paid' | 'void'
  page?: number
  perPage?: number
}

export const getInvoices = defineQuery(async (dto: GetInvoicesDto) => {
  const { page = 1, perPage = 20, ...filters } = dto

  return repo.paginate({ filters, page, perPage })
})
```

The return value is the data your handler or loader needs. No transformation layer required — what the query returns is what the caller receives.

<a name="generating-a-query"></a>
## Generating a Query

```bash
pnpm lumis make:query Billing GetInvoices
```

This creates:

```
src/modules/Billing/logic/queries/get-invoices.query.ts
src/modules/Billing/contracts/dto/get-invoices.dto.ts
src/modules/Billing/tests/get-invoices.test.ts
```

The generated test stub uses `withTestContext` and is pre-wired with a failing assertion so it shows up as a required task in your test run.

<a name="using-baserepository-in-a-query"></a>
## Using BaseRepository in a Query

`BaseRepository` from `@lumiarq/framework` provides standard data access methods. Queries use its read methods — `find`, `findMany`, `paginate`, `cursorPaginate` — and never its write methods.

```ts
// src/modules/Billing/logic/repositories/invoice.repository.ts
import { BaseRepository } from '@lumiarq/framework'
import { invoicesTable } from '@modules/Billing/infrastructure/database/schema'

export class InvoiceRepository extends BaseRepository {
  async findById(id: string) {
    return this.db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, id))
      .get()
  }

  async paginate(opts: { filters: Record<string, unknown>; page: number; perPage: number }) {
    return super.paginate(invoicesTable, {
      where: buildWhereClause(opts.filters),
      page: opts.page,
      perPage: opts.perPage,
    })
  }
}
```

```ts
// src/modules/Billing/logic/queries/get-invoice.query.ts
import { defineQuery } from '@lumiarq/framework'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'

const repo = new InvoiceRepository()

export const getInvoice = defineQuery(async ({ id }: { id: string }) => {
  return repo.findById(id)
})
```

<a name="calling-a-query-from-a-handler"></a>
## Calling a Query from a Handler

```ts
// src/modules/Billing/http/handlers/invoices.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { getInvoices } from '@modules/Billing/logic/queries/get-invoices.query'

export const listInvoicesHandler = defineHandler(async (ctx) => {
  const userId = ctx.get('userId') as string
  const page = Number(ctx.req.query('page') ?? '1')

  const result = await getInvoices({ userId, page, perPage: 20 })

  return ctx.json({
    data: result.data,
    meta: { page: result.page, total: result.total, perPage: result.perPage },
  })
})
```

<a name="calling-a-query-from-a-content-loader"></a>
## Calling a Query from a Content Loader

Static and ISR pages use content loaders to fetch data at build time or at revalidation time. Loaders call queries — never actions, never repositories directly.

```ts
// src/modules/Billing/ui/loaders/invoices.loader.ts
import { getInvoices } from '@modules/Billing/logic/queries/get-invoices.query'

export async function invoicesLoader({ userId }: { userId: string }) {
  return getInvoices({ userId })
}
```

<a name="cursor-based-pagination"></a>
## Cursor-Based Pagination

For large datasets where offset pagination is inefficient, use `cursorPaginate`:

```ts
// src/modules/Billing/logic/queries/get-invoices-cursor.query.ts
import { defineQuery } from '@lumiarq/framework'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'

const repo = new InvoiceRepository()

export interface GetInvoicesCursorDto {
  userId: string
  cursor?: string
  perPage?: number
}

export const getInvoicesCursor = defineQuery(async (dto: GetInvoicesCursorDto) => {
  return repo.cursorPaginate(invoicesTable, {
    where: eq(invoicesTable.userId, dto.userId),
    cursor: dto.cursor,
    perPage: dto.perPage ?? 20,
    cursorField: 'id',
  })
})
```

The response includes `{ data, nextCursor }`. The client passes `nextCursor` back as `cursor` on the next request.

<a name="queries-are-not-for-writes"></a>
## Queries Are Not for Writes

A query must never call a write method. This constraint is intentional and enforced by code review and convention. If you find yourself wanting to write inside a query, that logic belongs in an action.

```ts
// WRONG — do not write inside a query
export const getInvoice = defineQuery(async ({ id }: { id: string }) => {
  const invoice = await repo.findById(id)
  await repo.update({ id, lastViewedAt: new Date() }) // mutation inside a query
  return invoice
})

// CORRECT — put the mutation in an action, call the query separately
export const getInvoice = defineQuery(async ({ id }: { id: string }) => {
  return repo.findById(id)
})

// In the action:
export const viewInvoice = defineAction(async ({ id }: { id: string }) => {
  await repo.update({ id, lastViewedAt: new Date() })
  return getInvoice({ id })
})
```

<a name="exporting-queries-from-the-modules-public-contract"></a>
## Exporting Queries from the Module's Public Contract

If another module needs to read data from your module, expose the query result type in `contracts/`, not the query itself. The other module should call its own query or an action that calls yours — never import a query implementation directly.

```ts
// src/modules/Billing/contracts/index.ts
export type { Invoice, PaginatedInvoices } from './invoice.types'
```

If cross-module data access is truly necessary, the preferred pattern is to expose it via an event that the other module subscribes to, or to pass the data through a shared DTO when the calling module invokes an action from your module's public API.

<a name="testing-a-query"></a>
## Testing a Query

```ts
// src/modules/Billing/tests/get-invoices.test.ts
import { describe, it, expect } from 'vitest'
import { withTestContext } from '@lumiarq/framework'
import { getInvoices } from '@modules/Billing/logic/queries/get-invoices.query'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'

describe('getInvoices', () => {
  it(
    'returns paginated invoices for a user',
    withTestContext({}, async () => {
      const repo = new InvoiceRepository()
      await repo.create({ userId: 'user_1', totalCents: 5000, status: 'open', dueDateIso: '2026-04-01' })
      await repo.create({ userId: 'user_1', totalCents: 12000, status: 'paid', dueDateIso: '2026-03-01' })
      await repo.create({ userId: 'user_2', totalCents: 8000, status: 'open', dueDateIso: '2026-05-01' })

      const result = await getInvoices({ userId: 'user_1', page: 1, perPage: 20 })

      expect(result.data).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.data.every((inv) => inv.userId === 'user_1')).toBe(true)
    }),
  )
})
```
