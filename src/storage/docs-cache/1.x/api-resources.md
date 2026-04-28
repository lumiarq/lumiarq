---
title: API Resources
description: Transforming model data with defineResource
section: The Basics
order: 10
draft: false
---

# API Resources

## Table of Contents

- [Introduction](#introduction)
- [Defining a Resource](#defining-a-resource)
- [Single Item — `.make()`](#single-item)
- [Collections — `.collection()`](#collections)
- [Paginated Results — `.paginated()`](#paginated-results)
- [PaginatedResult Type](#paginated-result-type)
- [Composing Resources](#composing-resources)
- [Conditional Fields](#conditional-fields)
- [Using Resources in Handlers](#resources-in-handlers)
- [Using Resources in Queries](#resources-in-queries)
- [Generating Resource Files](#generating-resource-files)
- [Full Example](#full-example)

---

<a name="introduction"></a>
## Introduction

Your database models and your API responses rarely have the same shape. Models contain internal fields (`passwordHash`, `stripeCustomerId`, `deletedAt`), relationships that should be flattened or renamed, and timestamps that need to be formatted. Returning raw query results from your handlers conflates your storage layer with your public API contract.

**API Resources** solve this by providing a dedicated transformation layer. A resource is a typed transformer that converts one or many model objects into the exact shape you want to send to clients.

```
Database Model  →  Resource Transformer  →  JSON Response
```

Resources bring several benefits:

- **Security** — sensitive fields are explicitly excluded rather than accidentally included
- **Consistency** — every endpoint serving the same resource type produces the same shape
- **Flexibility** — the same model can be presented differently for different contexts (public API, admin API, embedded in another resource)
- **Testability** — transformations can be unit-tested independently of your HTTP layer

---

<a name="defining-a-resource"></a>
## Defining a Resource

Use `defineResource` from `@lumiarq/framework/core`:

```typescript
import { defineResource } from '@lumiarq/framework/core'
```

`defineResource` accepts a single generic transformer function and returns a resource object with `.make()`, `.collection()`, and `.paginated()` methods.

```typescript
defineResource<TInput, TOutput>(
  transformer: (item: TInput) => TOutput
): Resource<TInput, TOutput>
```

| Type Parameter | Description |
|---------------|-------------|
| `TInput` | The shape of the raw model coming in (e.g., from a database query) |
| `TOutput` | The shape of the transformed response object |

A minimal resource:

```typescript
// src/modules/Users/resources/UserResource.ts
import { defineResource } from '@lumiarq/framework/core'
import type { User }      from '#modules/Users/types.js'

export const UserResource = defineResource<User, {
  id:        string
  name:      string
  email:     string
  createdAt: string
}>((user) => ({
  id:        user.id,
  name:      user.name,
  email:     user.email,
  createdAt: user.createdAt.toISOString(),
  // passwordHash and other sensitive fields are intentionally omitted
}))
```

---

<a name="single-item"></a>
## Single Item — `.make()`

Transform a single model instance:

```typescript
const data = UserResource.make(user)
// { id: '...', name: '...', email: '...', createdAt: '...' }
```

Use it in a handler:

```typescript
export const getUser = defineHandler(async (ctx) => {
  const user = await findUserById(ctx.params.id)
  if (!user) throw new NotFoundError('User not found')

  return ctx.json(UserResource.make(user))
})
```

---

<a name="collections"></a>
## Collections — `.collection()`

Transform an array of models:

```typescript
const data = UserResource.collection(users)
// [{ id: '...', ... }, { id: '...', ... }]
```

The return type is `TOutput[]` — the transformer is applied to each element in order.

```typescript
export const listUsers = defineHandler(async (ctx) => {
  const users = await db.query.users.findMany()
  return ctx.json(UserResource.collection(users))
})
```

---

<a name="paginated-results"></a>
## Paginated Results — `.paginated()`

For paginated endpoints, `.paginated()` wraps the transformed items alongside pagination metadata:

```typescript
const result = await paginateUsers({ page: 1, perPage: 20 })
const data   = UserResource.paginated(result)
```

The output shape is always:

```typescript
{
  data: TOutput[]
  meta: {
    page:     number
    perPage:  number
    total:    number
    lastPage: number
  }
}
```

Example response:

```json
{
  "data": [
    { "id": "usr_01", "name": "Alice", "email": "alice@example.com", "createdAt": "2024-01-10T08:00:00.000Z" },
    { "id": "usr_02", "name": "Bob",   "email": "bob@example.com",   "createdAt": "2024-01-11T08:00:00.000Z" }
  ],
  "meta": {
    "page":     1,
    "perPage":  20,
    "total":    47,
    "lastPage": 3
  }
}
```

---

<a name="paginated-result-type"></a>
## PaginatedResult Type

The `.paginated()` method expects a `PaginatedResult<TInput>` object. Import the type from `@lumiarq/framework`:

```typescript
import type { PaginatedResult } from '@lumiarq/framework'

interface PaginatedResult<T> {
  items:    T[]
  page:     number
  perPage:  number
  total:    number
  lastPage: number
}
```

Your query/pagination helper should return this shape. A typical implementation:

```typescript
// src/modules/Users/queries/paginateUsers.ts
import type { PaginatedResult } from '@lumiarq/framework'
import type { User }            from '../types.js'

export async function paginateUsers(
  opts: { page: number; perPage: number; search?: string }
): Promise<PaginatedResult<User>> {
  const { page, perPage, search } = opts
  const offset = (page - 1) * perPage

  const [items, [{ count }]] = await Promise.all([
    db.query.users.findMany({
      where:  search ? ilike(users.name, `%${search}%`) : undefined,
      limit:  perPage,
      offset,
      orderBy: desc(users.createdAt),
    }),
    db.select({ count: count() }).from(users),
  ])

  const total    = Number(count)
  const lastPage = Math.ceil(total / perPage)

  return { items, page, perPage, total, lastPage }
}
```

---

<a name="composing-resources"></a>
## Composing Resources

Resources compose naturally. Call `.make()` inside a transformer to nest one resource inside another:

```typescript
// src/modules/Posts/resources/PostResource.ts
import { defineResource } from '@lumiarq/framework/core'
import { UserResource }   from '#modules/Users/resources/UserResource.js'
import type { PostWithAuthor } from '../types.js'

export const PostResource = defineResource<PostWithAuthor, {
  id:          string
  title:       string
  slug:        string
  excerpt:     string
  publishedAt: string | null
  author:      ReturnType<typeof UserResource.make>
}>((post) => ({
  id:          post.id,
  title:       post.title,
  slug:        post.slug,
  excerpt:     post.content.slice(0, 200),
  publishedAt: post.publishedAt?.toISOString() ?? null,
  author:      UserResource.make(post.author),
}))
```

Use `.collection()` for nested arrays:

```typescript
export const AuthorWithPostsResource = defineResource<UserWithPosts, {
  id:    string
  name:  string
  posts: ReturnType<typeof PostResource.make>[]
}>((author) => ({
  id:    author.id,
  name:  author.name,
  posts: PostResource.collection(author.posts),
}))
```

---

<a name="conditional-fields"></a>
## Conditional Fields

Include fields conditionally using the spread operator:

```typescript
export const UserResource = defineResource<
  User,
  { id: string; name: string; email: string; role?: string; apiKey?: string }
>((user, ctx) => ({
  id:    user.id,
  name:  user.name,
  email: user.email,

  // Only include 'role' for admin contexts
  ...(ctx?.isAdmin ? { role: user.role } : {}),

  // Only include 'apiKey' for the user's own profile view
  ...(ctx?.isSelf ? { apiKey: user.apiKey } : {}),
}))
```

Pass context as the second argument to `.make()` / `.collection()` / `.paginated()`:

```typescript
export const getUser = defineHandler(async (ctx) => {
  const user   = await findUserById(ctx.params.id)
  const isSelf = ctx.state.userId === user.id
  const isAdmin = ctx.state.role === 'admin'

  return ctx.json(UserResource.make(user, { isSelf, isAdmin }))
})
```

> **Note:** The `ctx` parameter in the transformer is whatever second argument you pass — it is not the HTTP `ExecutionContext`. Type it however is most useful for your resource.

---

<a name="resources-in-handlers"></a>
## Using Resources in Handlers

Resources slot cleanly into the handler → response flow:

```typescript
// src/modules/Posts/handlers/listPosts.ts
import { defineHandler } from '@lumiarq/framework/core'
import { parseQuery }    from '@lumiarq/framework/runtime'
import { PostResource }  from '../resources/PostResource.js'
import { paginatePosts } from '../queries/paginatePosts.js'
import { z }             from 'zod'

const querySchema = z.object({
  page:    z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(20),
  search:  z.string().optional(),
})

export const listPosts = defineHandler(async (ctx) => {
  const query  = parseQuery(ctx.request, querySchema)
  const result = await paginatePosts(query)
  return ctx.json(PostResource.paginated(result))
})
```

---

<a name="resources-in-queries"></a>
## Using Resources in Queries

Resources can also be applied at the query layer when you want the transformation to be part of the data-fetching contract:

```typescript
// src/modules/Users/queries/findUserResponse.ts
import { UserResource } from '../resources/UserResource.js'
import type { UserResponse } from '../types.js'

export async function findUserResponse(id: string): Promise<UserResponse | null> {
  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, id),
    with:  { profile: true },
  })

  if (!user) return null
  return UserResource.make(user)
}
```

This approach keeps handlers thin and makes the query callable from multiple places (another action, a scheduled job, a test) without repeating the transformation.

---

<a name="generating-resource-files"></a>
## Generating Resource Files

Scaffold a new resource with the Lumis CLI:

```bash
lumis make:resource <Module> <Name>
```

Example:

```bash
lumis make:resource Posts PostResource
```

Creates:

```
src/modules/Posts/resources/PostResource.ts
```

Generated stub:

```typescript
// src/modules/Posts/resources/PostResource.ts
import { defineResource } from '@lumiarq/framework/core'

// TODO: Replace with the actual input type from your query/model
type PostInput = Record<string, unknown>

// TODO: Define the exact output shape you want to send to clients
type PostOutput = Record<string, unknown>

export const PostResource = defineResource<PostInput, PostOutput>((item) => ({
  // Transform item fields here
  ...item,
}))
```

---

<a name="full-example"></a>
## Full Example

A complete, realistic set of resources for a blogging API.

### UserResource

```typescript
// src/modules/Users/resources/UserResource.ts
import { defineResource } from '@lumiarq/framework/core'

interface UserModel {
  id:           string
  name:         string
  email:        string
  role:         'user' | 'admin'
  passwordHash: string
  avatarUrl:    string | null
  bio:          string | null
  createdAt:    Date
}

interface AdminContext {
  isAdmin?: boolean
}

export const UserResource = defineResource<UserModel, {
  id:        string
  name:      string
  email:     string
  avatarUrl: string | null
  bio:       string | null
  joinedAt:  string
  role?:     string
}, AdminContext>((user, ctx) => ({
  id:        user.id,
  name:      user.name,
  email:     user.email,
  avatarUrl: user.avatarUrl,
  bio:       user.bio,
  joinedAt:  user.createdAt.toISOString(),
  // Only expose role to admin callers
  ...(ctx?.isAdmin ? { role: user.role } : {}),
}))
```

### PostResource (with nested AuthorResource)

```typescript
// src/modules/Posts/resources/PostResource.ts
import { defineResource } from '@lumiarq/framework/core'
import { UserResource }   from '#modules/Users/resources/UserResource.js'

interface PostModel {
  id:          string
  title:       string
  slug:        string
  content:     string
  coverUrl:    string | null
  publishedAt: Date | null
  createdAt:   Date
  author:      Parameters<typeof UserResource.make>[0]
  tags:        Array<{ id: string; name: string }>
}

export const PostResource = defineResource<PostModel, {
  id:          string
  title:       string
  slug:        string
  excerpt:     string
  coverUrl:    string | null
  publishedAt: string | null
  author:      ReturnType<typeof UserResource.make>
  tags:        Array<{ id: string; name: string }>
}>((post) => ({
  id:          post.id,
  title:       post.title,
  slug:        post.slug,
  excerpt:     post.content.replace(/<[^>]+>/g, '').slice(0, 200),
  coverUrl:    post.coverUrl,
  publishedAt: post.publishedAt?.toISOString() ?? null,
  author:      UserResource.make(post.author),
  tags:        post.tags.map(({ id, name }) => ({ id, name })),
}))
```

### Paginated List Handler

```typescript
// src/modules/Posts/handlers/listPosts.ts
import { defineHandler }  from '@lumiarq/framework/core'
import { parseQuery }     from '@lumiarq/framework/runtime'
import { PostResource }   from '../resources/PostResource.js'
import { paginatePosts }  from '../queries/paginatePosts.js'
import { z }              from 'zod'

const listSchema = z.object({
  page:    z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(50).default(15),
  tag:     z.string().optional(),
})

export const listPosts = defineHandler(async (ctx) => {
  const query  = parseQuery(ctx.request, listSchema)
  const result = await paginatePosts(query)
  return ctx.json(PostResource.paginated(result))
})
```

Example response for `GET /posts?page=1&perPage=2`:

```json
{
  "data": [
    {
      "id":          "post_abc123",
      "title":       "Getting Started with LumiARQ",
      "slug":        "getting-started-with-lumiarq",
      "excerpt":     "LumiARQ is a TypeScript-first web framework designed for clarity...",
      "coverUrl":    "https://cdn.example.com/covers/lumiarq.jpg",
      "publishedAt": "2025-01-10T08:00:00.000Z",
      "author": {
        "id":        "usr_alice",
        "name":      "Alice",
        "email":     "alice@example.com",
        "avatarUrl": null,
        "bio":       "Software engineer, writer.",
        "joinedAt":  "2024-06-01T00:00:00.000Z"
      },
      "tags": [
        { "id": "tag_1", "name": "TypeScript" },
        { "id": "tag_2", "name": "Framework" }
      ]
    }
  ],
  "meta": {
    "page":     1,
    "perPage":  2,
    "total":    24,
    "lastPage": 12
  }
}
```
