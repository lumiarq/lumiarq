---
title: Cache
description: Caching data with the Cache contract
section: Digging Deeper
order: 2
draft: false
---

# Cache

- [Introduction](#introduction)
- [Configuration](#configuration)
- [Registering a Cache Provider](#registering-a-cache-provider)
- [Reading and Writing](#reading-and-writing)
- [The `remember` Pattern](#the-remember-pattern)
- [Caching Query Results](#caching-query-results)
- [Using Multiple Stores](#using-multiple-stores)
- [Tagging (Redis Only)](#tagging-redis-only)
- [Cache Keys](#cache-keys)
- [Remember Forever](#remember-forever)
- [Cache Warming](#cache-warming)
- [Testing with a Fake Cache](#testing-with-a-fake-cache)

<a name="introduction"></a>

Lumiarq provides a unified caching interface through `CacheContract`. Your application code always talks to the contract — the underlying driver (in-memory, Redis, filesystem) is swapped in configuration without touching application logic.

<a name="configuration"></a>
## Configuration

Configure caching in `config/cache.ts`:

```typescript
import type { CacheConfig } from '@lumiarq/framework'

export default {
  default: 'redis',

  stores: {
    redis: {
      driver: 'redis',
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      prefix: 'myapp:',
      ttl: 3600,        // Default TTL in seconds
    },

    memory: {
      driver: 'memory',
      prefix: 'myapp:',
      ttl: 300,
    },

    file: {
      driver: 'file',
      path: '.cache',
      prefix: 'myapp:',
      ttl: 86400,
    },
  },
} satisfies CacheConfig
```

The `default` key names the store that is injected when you resolve `CacheContract` without specifying a store explicitly.

<a name="registering-a-cache-provider"></a>
## Registering a Cache Provider

In `bootstrap/providers.ts`, bind your cache implementation to the `CacheContract`:

```typescript
// bootstrap/providers.ts
import { createRedisCache } from '@lumiarq/framework'
import type { CacheContract } from '@lumiarq/contracts'
import cacheConfig from '@config/cache'

export let cache: CacheContract

export async function bootProviders() {
  const storeConfig = cacheConfig.stores[cacheConfig.default]

  cache = createRedisCache({
    url: storeConfig.url,
    prefix: storeConfig.prefix,
    ttl: storeConfig.ttl,
  })
}
```

<a name="reading-and-writing"></a>
## Reading and Writing

The `CacheContract` exposes a small, predictable API.

### `cache.set(key, value, ttl?)`

Write a value. The optional `ttl` (seconds) overrides the store default:

```typescript
import { cache } from '@bootstrap/providers'

await cache.set('user:42:profile', profileData)
await cache.set('promo:flash-sale', true, 3600)   // expires in 1 hour
```

### `cache.get(key)`

Read a value. Returns `null` when the key does not exist or has expired:

```typescript
const profile = await cache.get<UserProfile>('user:42:profile')

if (profile === null) {
  // Cache miss — fetch from database
}
```

### `cache.forget(key)`

Delete a single key:

```typescript
await cache.forget('user:42:profile')
```

### `cache.flush()`

Delete every key in the store (use carefully in production):

```typescript
await cache.flush()
```

<a name="the-remember-pattern"></a>
## The `remember` Pattern

The most common caching pattern is "fetch from cache, fall back to the source of truth, then store the result". `cache.remember` handles this in one call:

```typescript
import { cache } from '@bootstrap/providers'

const profile = await cache.remember(
  'user:42:profile',
  300,                          // TTL in seconds
  async () => {
    return UserRepository.findById(42)
  },
)
```

If the key exists, the callback is never called. If it does not, the callback runs, the result is stored, and the value is returned.

<a name="caching-query-results"></a>
## Caching Query Results

The most practical use of `remember` is inside a Query, keeping the caching logic co-located with the data access:

```typescript
// src/modules/Billing/logic/queries/get-invoices.query.ts
import { defineQuery } from '@lumiarq/framework'
import { cache } from '@bootstrap/providers'
import { InvoiceRepository } from '../../data/repositories/invoice.repository'

export const GetInvoicesQuery = defineQuery(async (userId: string) => {
  const cacheKey = `user:${userId}:invoices`

  return cache.remember(cacheKey, 120, async () => {
    return InvoiceRepository.allForUser(userId)
  })
})
```

Invalidate the cache when the data changes — typically in the action that mutates the data:

```typescript
// src/modules/Billing/logic/actions/create-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import { cache } from '@bootstrap/providers'
import { InvoiceRepository } from '../../data/repositories/invoice.repository'
import type { CreateInvoiceDto } from '../validators/create-invoice.validator'

export const CreateInvoiceAction = defineAction(async (dto: CreateInvoiceDto) => {
  const invoice = await InvoiceRepository.create(dto)

  // Bust the listing cache so the next request gets fresh data
  await cache.forget(`user:${dto.userId}:invoices`)

  return invoice
})
```

<a name="using-multiple-stores"></a>
## Using Multiple Stores

When you need to access a non-default store, resolve it by name:

```typescript
import { resolveCache } from '@lumiarq/framework'

const fileCache = resolveCache('file')
const shortLived = resolveCache('memory')

await shortLived.set('rate:127.0.0.1', 1, 60)
const count = await shortLived.get<number>('rate:127.0.0.1')
```

<a name="tagging-redis-only"></a>
## Tagging (Redis Only)

The Redis driver supports tag-based invalidation, which lets you clear groups of related keys in a single call:

```typescript
import { cache } from '@bootstrap/providers'

// Write with tags
await cache.tags(['invoices', 'user:42']).set('user:42:invoice:list', data)
await cache.tags(['invoices', 'user:42']).set('user:42:invoice:stats', stats)

// Invalidate all keys tagged with 'user:42'
await cache.tags(['user:42']).flush()
```

<a name="cache-keys"></a>
## Cache Keys

Use a consistent key naming convention across your application. A good pattern is:

```
{entity}:{id}:{sub-resource}
```

Examples:

```
user:42:profile
user:42:invoices
product:slug:pricing
settings:global
```

Prefix keys with the entity name to make cache-busting after mutations straightforward. Avoid using raw user input in cache keys without sanitising it.

<a name="remember-forever"></a>
## Remember Forever

Use `cache.rememberForever` for data that changes only through an explicit invalidation — not on a timer. Common examples include feature flags, global settings, and reference data that is updated through an admin action:

```typescript
// src/modules/Settings/logic/queries/get-global-settings.query.ts
import { defineQuery } from '@lumiarq/framework'
import { cache } from '@bootstrap/providers'
import { SettingsRepository } from '../../data/repositories/settings.repository'

export const GetGlobalSettingsQuery = defineQuery(async () => {
  // Stored indefinitely — no TTL expiry
  return cache.rememberForever('settings:global', async () => {
    return SettingsRepository.findAll()
  })
})
```

```typescript
// Invalidate when an admin updates settings
export const UpdateGlobalSettingsAction = defineAction(async (dto: UpdateSettingsDto) => {
  await SettingsRepository.update(dto)
  await cache.forget('settings:global')   // next read will re-populate
})
```

> **Warning:** Data stored with `rememberForever` does not expire automatically. Always pair it with an explicit `cache.forget()` call on the write path.

<a name="cache-warming"></a>
## Cache Warming

Cache warming pre-fills the cache during deployment so users never hit a cold cache on the first request after a release. Add a warm-up step to your deploy script or run it as a CLI command:

```typescript
// scripts/warm-cache.ts
import { bootProviders } from '@bootstrap/providers'
import { GetGlobalSettingsQuery } from '@modules/Settings/logic/queries/get-global-settings.query'
import { GetFeaturedProductsQuery } from '@modules/Products/logic/queries/get-featured-products.query'

async function main() {
  await bootProviders()

  console.log('Warming cache...')

  await Promise.all([
    GetGlobalSettingsQuery.run(),         // caches settings:global
    GetFeaturedProductsQuery.run(),       // caches products:featured
  ])

  console.log('Cache warm. Proceeding with deployment.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Cache warm failed:', err)
  process.exit(1)
})
```

```bash
# In your deploy script, run before traffic is switched
npx tsx scripts/warm-cache.ts
```

<a name="testing-with-a-fake-cache"></a>
## Testing with a Fake Cache

Lumiarq ships a `createFakeCache()` helper for tests. The fake cache is an in-memory store that resets between tests and exposes a `spy` for asserting that specific keys were read or written:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'
import { createFakeCache } from '@lumiarq/framework/testing'
import { GetInvoicesQuery } from '@modules/Billing/logic/queries/get-invoices.query'

// Swap out the real cache for the test context
vi.mock('@bootstrap/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@bootstrap/providers')>()
  return { ...original, cache: createFakeCache() }
})

describe('GetInvoicesQuery', () => {
  it('caches the result on the second call', () => withTestContext(async () => {
    const { cache } = await import('@bootstrap/providers')

    // Seed some invoices in the test DB
    // ... factory setup ...

    const first  = await GetInvoicesQuery.run('user_1')
    const second = await GetInvoicesQuery.run('user_1')

    // Both calls return the same data
    expect(first).toEqual(second)

    // The cache was written once and read once (hit on second call)
    expect(cache.spy.setCallCount('user:user_1:invoices')).toBe(1)
    expect(cache.spy.getCallCount('user:user_1:invoices')).toBe(2)
  }))

  it('returns fresh data after cache invalidation', () => withTestContext(async () => {
    const { cache } = await import('@bootstrap/providers')

    await GetInvoicesQuery.run('user_1')
    await cache.forget('user:user_1:invoices')

    // After invalidation, cache miss — DB is queried again
    await GetInvoicesQuery.run('user_1')

    expect(cache.spy.setCallCount('user:user_1:invoices')).toBe(2)
  }))
})
```

---

**Next:** Learn how to work with your database using [Drizzle ORM and BaseRepository](/docs/database).
