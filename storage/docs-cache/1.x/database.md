---
title: Getting Started
description: Working with databases using Drizzle ORM and BaseRepository
section: Database
order: 1
draft: false
---

# Database

- [Introduction](#introduction)
- [Configuration](#configuration)
- [Defining a Schema](#defining-a-schema)
- [BaseRepository](#baserepository)
- [Pagination](#pagination)
- [Multi-Connection Support](#multi-connection-support)
- [Database Migrations](#database-migrations)

<a name="introduction"></a>

Lumiarq uses [Drizzle ORM](https://orm.drizzle.team) for type-safe database access. Drizzle sits close to SQL — schemas are TypeScript, queries look like SQL, and there is no hidden magic. `BaseRepository` from `@lumiarq/database` adds a thin, consistent CRUD layer on top.

<a name="configuration"></a>
## Configuration

Database connections are configured in `config/database.ts`:

```typescript
import type { DatabaseConfig } from '@lumiarq/framework'

export default {
  default: 'sqlite',

  connections: {
    sqlite: {
      driver: 'better-sqlite3',
      url: process.env.DATABASE_URL ?? 'file:./dev.db',
    },

    pg: {
      driver: 'postgres',
      url: process.env.PG_DATABASE_URL,
      pool: {
        min: 2,
        max: 10,
      },
    },
  },
} satisfies DatabaseConfig
```

The `default` key determines which connection `BaseRepository` uses unless told otherwise.

<a name="defining-a-schema"></a>
## Defining a Schema

Schemas are defined with Drizzle's table builders and live in `src/shared/database/schemas/` so they can be shared across modules:

```typescript
// src/shared/database/schemas/invoices.ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const invoices = sqliteTable('invoices', {
  id:        text('id').primaryKey(),
  userId:    text('user_id').notNull(),
  status:    text('status', { enum: ['draft', 'sent', 'paid', 'void'] })
               .notNull()
               .default('draft'),
  amount:    real('amount').notNull(),
  currency:  text('currency').notNull().default('GBP'),
  notes:     text('notes'),

  // Timestamps — integer with timestamp_ms mode gives you a JS Date automatically
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
               .notNull()
               .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
               .notNull()
               .default(sql`(unixepoch() * 1000)`),
})

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
```

### Timestamp Columns

Always use `integer('col', { mode: 'timestamp_ms' })` with the `(unixepoch() * 1000)` default for timestamp columns. This stores millisecond Unix timestamps, which Drizzle automatically deserialises into JavaScript `Date` objects on select:

```typescript
integer('created_at', { mode: 'timestamp_ms' })
  .notNull()
  .default(sql`(unixepoch() * 1000)`)
```

### Foreign Keys

Declare foreign key references inline:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { users } from './users'

export const invoices = sqliteTable('invoices', {
  id:     text('id').primaryKey(),
  userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
  // ...
})
```

<a name="baserepository"></a>
## BaseRepository

`BaseRepository` in `@lumiarq/database` provides a typed CRUD interface for a single table. Extend it for each entity:

```typescript
// src/modules/Billing/data/repositories/invoice.repository.ts
import { BaseRepository } from '@lumiarq/database'
import { eq, desc } from 'drizzle-orm'
import { invoices, type Invoice, type NewInvoice } from '@shared/database/schemas/invoices'

export class InvoiceRepository extends BaseRepository<typeof invoices> {
  protected readonly table = invoices

  async allForUser(userId: string): Promise<Invoice[]> {
    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, userId))
      .orderBy(desc(invoices.createdAt))
  }

  async findByIdAndUser(id: string, userId: string): Promise<Invoice | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id), eq(invoices.userId, userId))
      .limit(1)

    return rows[0] ?? null
  }
}

export const InvoiceRepository = new InvoiceRepositoryClass()
```

### Built-in Methods

`BaseRepository` exposes these methods out of the box:

| Method | Description |
|--------|-------------|
| `all()` | Fetch every row |
| `find(id)` | Fetch one row by primary key, or `null` |
| `create(data)` | Insert a row and return it |
| `update(id, data)` | Update a row by primary key and return it |
| `delete(id)` | Delete a row by primary key |
| `paginate(page, perPage)` | Offset-based pagination |
| `cursorPaginate(cursor, limit)` | Cursor-based pagination |

### Using Direct Drizzle Queries

For anything beyond simple CRUD, drop down to the `this.db` accessor and write the query yourself:

```typescript
import { and, eq, gte, sql } from 'drizzle-orm'

async sumByUser(userId: string, since: Date): Promise<number> {
  const result = await this.db
    .select({ total: sql<number>`sum(${invoices.amount})` })
    .from(invoices)
    .where(
      and(
        eq(invoices.userId, userId),
        gte(invoices.createdAt, since),
      ),
    )

  return result[0]?.total ?? 0
}
```

<a name="pagination"></a>
## Pagination

### Offset Pagination

`paginate` returns a page of results with total count metadata:

```typescript
const page = await InvoiceRepository.paginate(1, 20)
// {
//   data: Invoice[],
//   meta: { currentPage: 1, perPage: 20, total: 143, lastPage: 8 }
// }
```

### Cursor Pagination

`cursorPaginate` is more efficient for large datasets and infinite scroll:

```typescript
const page = await InvoiceRepository.cursorPaginate(lastSeenId, 20)
// {
//   data: Invoice[],
//   nextCursor: 'inv_abc123' | null
// }
```

<a name="multi-connection-support"></a>
## Multi-Connection Support

When your application uses more than one database, configure the additional connections in `config/database.ts` and set the `connection` property on the repository:

```typescript
// src/modules/Analytics/data/repositories/event.repository.ts
import { BaseRepository } from '@lumiarq/database'
import { events } from '@shared/database/schemas/events'

export class EventRepositoryClass extends BaseRepository<typeof events> {
  protected readonly table = events
  protected readonly connection = 'clickhouse'  // Non-default connection
}

export const EventRepository = new EventRepositoryClass()
```

`BaseRepository.db` resolves the correct database connection at runtime based on the `connection` property.

<a name="database-migrations"></a>
## Database Migrations

Lumiarq wraps Drizzle Kit's migration tooling behind `lumis` commands.

### Generate a Migration

After changing a schema, generate the migration SQL:

```bash
pnpm lumis db:generate
```

Drizzle introspects your schemas and writes migration files to `drizzle/migrations/`.

### Run Migrations

Apply pending migrations to the database:

```bash
pnpm lumis db:migrate
```

### Roll Back

Undo the last applied migration:

```bash
pnpm lumis db:rollback
```

### Seed the Database

Run your seed files to populate development data:

```bash
pnpm lumis db:seed
```

Seed files live in `drizzle/seeds/` and are plain TypeScript:

```typescript
// drizzle/seeds/invoices.ts
import { db } from '@bootstrap/providers'
import { invoices } from '@shared/database/schemas/invoices'

export async function seed() {
  await db.insert(invoices).values([
    {
      id: 'inv_001',
      userId: 'user_001',
      status: 'paid',
      amount: 499.00,
      currency: 'GBP',
    },
    {
      id: 'inv_002',
      userId: 'user_001',
      status: 'draft',
      amount: 199.00,
      currency: 'GBP',
    },
  ])
}
```

### Fresh Database

Drop all tables, re-run all migrations, and seed:

```bash
pnpm lumis db:fresh
```

Useful during development when you want a clean slate.

### Database Status

Check the migration status for all connections:

```bash
pnpm lumis db:status
pnpm lumis db:status --connection all
```

---

**Next:** Learn about key management and data security in [Encryption](/docs/encryption).
