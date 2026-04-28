---
title: Asset Bundling
description: Bundling frontend assets in Lumiarq applications
section: The Basics
order: 8
draft: false
---

# UI

- [Introduction](#introduction)
- [Installation](#installation)
- [React](#react)
- [Vue](#vue)
- [Svelte](#svelte)
- [Solid](#solid)
- [Configuring the Base URL](#configuring-the-base-url)
- [Handling Authentication](#handling-authentication)
- [Relationship to Server Rendering](#relationship-to-server-rendering)

<a name="introduction"></a>

Lumiarq handles server-side rendering. The `@lumiarq/query` package is a lightweight companion for client-side interactivity on top of that server-rendered HTML — it provides thin data-fetching adapters for React, Vue, Svelte, and Solid so you can consume Lumiarq API routes without pulling in a full data-fetching framework.

Each adapter ships under a sub-path export so you only import the code for the framework you are using. There are no shared peer dependencies between the adapters.

<a name="installation"></a>
## Installation

```bash
pnpm add @lumiarq/query
```

<a name="react"></a>
## React

Import from `@lumiarq/query/react`. The adapter exposes `useQuery` for fetching data and `useMutation` for writing:

```typescript
// src/modules/Billing/ui/web/components/InvoiceList.tsx
import { useQuery } from '@lumiarq/query/react'

interface Invoice {
  id: string
  total: number
  status: 'pending' | 'paid' | 'overdue'
  dueDate: string
}

export function InvoiceList({ userId }: { userId: string }) {
  const { data, loading, error, refetch } = useQuery<Invoice[]>({
    url: `/api/invoices?userId=${userId}`,
    // refetchInterval: 30_000, // optional polling in ms
  })

  if (loading) return <p>Loading invoices...</p>
  if (error) return <p>Failed to load invoices: {error.message}</p>

  return (
    <ul>
      {data?.map((invoice) => (
        <li key={invoice.id}>
          #{invoice.id} — {invoice.status} — ${invoice.total / 100}
        </li>
      ))}
    </ul>
  )
}
```

### useMutation (React)

```typescript
import { useMutation } from '@lumiarq/query/react'

export function CreateInvoiceButton() {
  const { mutate, loading, error } = useMutation({
    url: '/api/invoices',
    method: 'POST',
    onSuccess(data) {
      console.log('Invoice created:', data)
    },
  })

  return (
    <button
      disabled={loading}
      onClick={() =>
        mutate({
          customerId: 'cust-123',
          lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 5000 }],
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
      }
    >
      {loading ? 'Creating...' : 'Create Invoice'}
    </button>
  )
}
```

<a name="vue"></a>
## Vue

Import from `@lumiarq/query/vue`. The adapter exports composables that follow Vue's conventions:

```typescript
// src/modules/Billing/ui/web/components/InvoiceList.vue
<script setup lang="ts">
import { useQuery } from '@lumiarq/query/vue'

const props = defineProps<{ userId: string }>()

const { data, loading, error, refetch } = useQuery<Invoice[]>({
  url: () => `/api/invoices?userId=${props.userId}`,
  // url is reactive — updates when props.userId changes
})
</script>

<template>
  <div v-if="loading">Loading invoices...</div>
  <div v-else-if="error">{{ error.message }}</div>
  <ul v-else>
    <li v-for="invoice in data" :key="invoice.id">
      #{{ invoice.id }} — {{ invoice.status }}
    </li>
  </ul>
</template>
```

The `url` option accepts a plain string or a reactive getter function. When a getter is provided, the query re-fetches automatically whenever the getter's reactive dependencies change — no manual `watch` required.

### useMutation (Vue)

```typescript
<script setup lang="ts">
import { useMutation } from '@lumiarq/query/vue'

const { mutate, loading, error } = useMutation({
  url: '/api/invoices',
  method: 'POST',
  onSuccess(data) {
    console.log('Created:', data)
  },
})
</script>

<template>
  <button :disabled="loading" @click="mutate(payload)">
    {{ loading ? 'Creating...' : 'Create Invoice' }}
  </button>
</template>
```

<a name="svelte"></a>
## Svelte

Import from `@lumiarq/query/svelte`. The adapter wraps results in Svelte's `readable` store so you can use the `$` prefix in templates without any extra setup. The adapter has no hard Svelte peer dependency — it constructs the store interface inline so it is compatible with both Svelte 4 and Svelte 5.

```svelte
<!-- src/modules/Billing/ui/web/components/InvoiceList.svelte -->
<script lang="ts">
  import { queryStore } from '@lumiarq/query/svelte'

  export let userId: string

  // queryStore returns a Svelte readable store
  const invoices = queryStore<Invoice[]>({ url: `/api/invoices?userId=${userId}` })
</script>

{#if $invoices.loading}
  <p>Loading...</p>
{:else if $invoices.error}
  <p>{$invoices.error.message}</p>
{:else}
  <ul>
    {#each $invoices.data ?? [] as invoice (invoice.id)}
      <li>#{invoice.id} — {invoice.status}</li>
    {/each}
  </ul>
{/if}
```

### mutationStore (Svelte)

```svelte
<script lang="ts">
  import { mutationStore } from '@lumiarq/query/svelte'

  const create = mutationStore({
    url: '/api/invoices',
    method: 'POST',
  })
</script>

<button disabled={$create.loading} on:click={() => $create.mutate(payload)}>
  {$create.loading ? 'Creating...' : 'Create Invoice'}
</button>
```

<a name="solid"></a>
## Solid

Import from `@lumiarq/query/solid`. The adapter uses Solid's fine-grained reactivity primitives — `createSignal` and `createResource` — under the hood:

```typescript
// src/modules/Billing/ui/web/components/InvoiceList.tsx (Solid)
import { createQuery } from '@lumiarq/query/solid'

export function InvoiceList(props: { userId: string }) {
  // Reactive URL — re-fetches when props.userId changes
  const { data, loading, error } = createQuery<Invoice[]>(() => ({
    url: `/api/invoices?userId=${props.userId}`,
  }))

  return (
    <div>
      <Show when={loading()}>Loading...</Show>
      <Show when={error()}>{(err) => <p>{err().message}</p>}</Show>
      <For each={data()}>
        {(invoice) => <li>{invoice.id} — {invoice.status}</li>}
      </For>
    </div>
  )
}
```

### createMutation (Solid)

```typescript
import { createMutation } from '@lumiarq/query/solid'

export function CreateButton() {
  const { mutate, loading } = createMutation({
    url: '/api/invoices',
    method: 'POST',
    onSuccess(data) {
      console.log('Created', data)
    },
  })

  return (
    <button disabled={loading()} onClick={() => mutate(payload)}>
      {loading() ? 'Creating...' : 'Create Invoice'}
    </button>
  )
}
```

<a name="configuring-the-base-url"></a>
## Configuring the Base URL

All adapters respect a global base URL so you do not have to prefix every `url` option with your API origin. Set it once at app entry:

```typescript
import { setBaseUrl } from '@lumiarq/query'

setBaseUrl(import.meta.env.PUBLIC_APP_URL ?? '')
```

After this call, `url: '/api/invoices'` will resolve to `https://your-app.com/api/invoices` in production.

<a name="handling-authentication"></a>
## Handling Authentication

The adapters accept a `headers` option (or a `headers` getter for reactive values) where you can attach a JWT or cookie-based auth header:

```typescript
// React example with Authorization header
const { data } = useQuery<Invoice[]>({
  url: '/api/invoices',
  headers: {
    Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
  },
})
```

For apps that use Lumiarq's session cookies, no extra headers are needed — the browser sends the session cookie automatically on same-origin requests.

<a name="relationship-to-server-rendering"></a>
## Relationship to Server Rendering

`@lumiarq/query` does not replace or bypass Lumiarq's server rendering. The typical pattern is:

1. The server renders the initial HTML with data already embedded (via a route handler calling a query).
2. The client hydrates and uses `@lumiarq/query` to refresh data on user interaction or on a polling interval.

This keeps pages fast on first load while still supporting dynamic client behaviour without a full SPA architecture.

---

**Next:** Review the [CLI reference](/docs/cli/overview) for all available commands.
