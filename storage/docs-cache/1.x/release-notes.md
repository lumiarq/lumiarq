---
title: Release Notes
description: What's new in each version of Lumiarq
section: Prologue
order: 2
draft: false
---

# Release Notes

- [Introduction](#introduction)
- [v0.1.0](#v010)

<a name="introduction"></a>

This page documents notable changes, new features, and improvements across Lumiarq releases. For a complete list of commits and low-level changes, see the [CHANGELOG](https://github.com/lumiarq/framework/blob/main/CHANGELOG.md) in the repository.

---

<a name="v010"></a>
## v0.1.0

**Release date:** 2025-01-15

This is the first public release of Lumiarq. It establishes the core architecture, CLI tooling, module system, and developer experience that the framework will build on going forward.

### Module system and Porto architecture

Lumiarq is organised around a Porto-inspired architecture where application logic lives in self-contained **modules**. Each module owns its handlers, actions, tasks, queries, and events. Nothing leaks across module boundaries unless it is explicitly exported.

Modules are defined with `defineModule` and registered automatically by the framework at boot time:

```typescript
// src/modules/Blog/module.ts
import { defineModule } from '@lumiarq/framework';

export default defineModule({
  name: 'Blog',
  prefix: '/blog',
});
```

The framework discovers all `module.ts` files under `src/modules/` and registers them in priority order, with no manual wiring required.

### Route DSL

Routes are declared in `*.api.ts` (JWT-authenticated, no CSRF) or `*.web.ts` (CSRF + session) files inside each module's `http/` directory. The `Route` builder provides a clean DSL:

```typescript
// src/modules/Blog/http/blog.web.ts
import { Route } from '@lumiarq/framework';
import { ListPostsHandler } from './handlers/ListPostsHandler';
import { ShowPostHandler } from './handlers/ShowPostHandler';

Route.get('/posts', ListPostsHandler);
Route.get('/posts/:slug', ShowPostHandler);
```

The framework enforces file-type constraints at startup: web routes must not use JWT-only patterns, and API routes must not include CSRF-dependent session behaviour. Violations surface as named errors (`MissingRenderStrategyError`, `InvalidApiRouteError`, `DuplicateRouteError`) with actionable messages.

### Handlers, actions, tasks, and queries

The framework ships four factory functions that define the building blocks of application logic:

- **`defineHandler`** — the HTTP entry point. Receives a typed `HandlerContext` and returns a response. Handlers call actions or queries; they do not contain business logic themselves.
- **`defineAction`** — a unit of write-side business logic. Actions emit events and may call tasks. Accepts optional metadata for idempotency hints.
- **`defineTask`** — a focused, reusable piece of infrastructure work (e.g. sending mail, hashing a password). Tasks are called by actions, never by handlers directly.
- **`defineQuery`** — a read-only domain operation. Queries are called by handlers or content loaders. They never write data or dispatch events.

```typescript
// src/modules/Blog/logic/actions/PublishPostAction.ts
import { defineAction } from '@lumiarq/framework';
import { PublishPostDto } from './PublishPostDto';

export const PublishPostAction = defineAction(async (dto: PublishPostDto) => {
  // validate, persist, emit events
});
```

```typescript
// src/modules/Blog/logic/queries/GetPostQuery.ts
import { defineQuery } from '@lumiarq/framework';

export const GetPostQuery = defineQuery(async (slug: string) => {
  // read-only data retrieval
  return post;
});
```

### CLI scaffolding with `lumis`

The `lumis` CLI is the primary tool for generating code and managing the application lifecycle. All `make:*` commands generate the correct directory structure, import paths, and boilerplate so developers can focus on business logic immediately.

Key `make:*` commands in this release:

| Command | What it generates |
|---|---|
| `lumis make:module <Name>` | Full module scaffold with all directories |
| `lumis make:action <Module> <Name>` | Action + DTO + failing test |
| `lumis make:task <Module> <Name>` | Task + test |
| `lumis make:query <Module> <Name>` | Query + DTO + failing test |
| `lumis make:binding <Module> <Entity>` | Route model binding |
| `lumis make:event <Module> <Name>` | Event schema |

Running `pnpm lumis make:module Blog --full-stack` produces the full directory tree for a Blog module, including route stubs, handler stubs, repository, and all `logic/` subdirectories.

### Content loader

Lumiarq includes a first-class content pipeline for Markdown-driven pages. `defineContentLoader` wires a directory of `.md` files to a Zod schema and makes the parsed, type-safe collection available to handlers and queries:

```typescript
import { defineContentLoader } from '@lumiarq/framework';
import { z } from 'zod';

export const blogLoader = defineContentLoader({
  directory: 'content/blog',
  schema: z.object({
    title: z.string(),
    publishedAt: z.string(),
    draft: z.boolean().default(false),
  }),
});
```

Reading speed, minimum reading time, and supported file extensions are all controlled by `CONTENT_DEFAULTS` from `@lumiarq/core`, so there are no magic numbers scattered across user code.

### Multi-target builds

`lumis build` supports three deployment targets:

```bash
pnpm lumis build --target node        # Node.js server
pnpm lumis build --target cloudflare  # Cloudflare Workers
pnpm lumis build --target static      # Static site export
```

Build output lands in the `.arc/` directory. The `lumis preview` command mirrors this with corresponding `--target` flags so you can verify a production build locally before deploying.

### Auth starter

Running `lumis auth:install` scaffolds a complete Auth module with:

- Registration, login, logout, and email verification handlers
- Password reset flow (request + confirm)
- RS256 JWT authentication for API routes
- Session-based authentication for web routes
- Drizzle-backed repositories for identities, sessions, and users

Running `lumis auth:install --iam` additionally generates a self-contained IAM bounded context that owns roles, permissions, and policy enforcement without coupling to the Auth or User modules.

Key management is handled by:

```bash
pnpm lumis key:generate
```

This generates a 4096-bit RS256 key pair and a 32-byte `SESSION_SECRET`, and writes them to `.env` with `0600` permissions. Run `lumis key:rotate` to cycle all secrets while preserving other `.env` values.

### Configuration system

Application configuration uses TypeScript's `satisfies` operator for full type safety without sacrificing plain object ergonomics:

```typescript
// config/app.ts
import type { AppConfig } from '@lumiarq/framework';

export default {
  name: 'My App',
  url: process.env.APP_URL ?? 'http://localhost:3001',
  env: process.env.APP_ENV ?? 'local',
  debug: process.env.APP_DEBUG === 'true',
  locale: 'en',
} satisfies AppConfig;
```

Ten config files ship by default: `app`, `auth`, `database`, `mail`, `queue`, `storage`, `cache`, `session`, `security`, and `logging`. Environment variables are validated at startup through `bootstrap/env.ts` using Zod, so misconfigured deployments fail fast with a clear error rather than at runtime.

### Event system

Events are defined with Zod schemas and emitted through `EventBus`. Idempotency keys are derived automatically from a SHA-256 hash of the event name and stable-stringified payload — the same payload always produces the same key, making retries safe without any application-level bookkeeping:

```typescript
import { EventBus } from '@lumiarq/framework';
import { PostPublishedEvent } from '@modules/Blog/events/PostPublishedEvent';

await EventBus.dispatch(PostPublishedEvent, { postId: 42, slug: 'hello-world' });
```

### Developer experience

- `pnpm lumis serve` starts the dev server at `http://localhost:3001` with hot reload
- `pnpm lumis route:list` prints a table of all registered routes with method, path, handler, middleware, render strategy, and module
- `pnpm lumis route:check` validates route files for constraint violations before you deploy
- `pnpm lumis info` prints runtime, framework version, and environment details
- `pnpm lumis tinker` drops into a Node.js REPL with the full application context loaded
- `pnpm lumis config:show <name>` prints a config file's resolved values, redacting sensitive keys
