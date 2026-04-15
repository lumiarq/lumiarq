---
title: Changelog
description: Full changelog of Lumiarq framework releases
section: Changelog
order: 1
draft: false
---

# Changelog

- [v4.2.1](#v421)
- [v4.0.0](#v400)
- [v3.4.0](#v340)
- [v3.2.0](#v320)

<a name="v421"></a>
## v4.2.1

- `contextId` renamed from `requestId` in `ExecutionContext`
- `setApplicationContext(ctx)` added to `@lumiarq/runtime`
- `withTestContext(overrides, fn)` returns zero-arg async fn for Vitest `it()`
- `BaseRepository.connection` now defaults to `'default'`
- `defineModule()` now accepts object API: `{ name, alias?, priority?, prefix?, middleware? }`
- New CLI flags: `make:module --full-stack / --api-only / --domain-only`
- `make:action --with-task` generates 4 files (action + task + DTO + test)

<a name="v400"></a>
## v4.0.0

- `EventBus.dispatch()` replaces `emitAsync` (fire-and-forget void)
- Named routes: `route(name, params?, query?)` with `RouteNotFoundError` on miss
- Route model binding: `defineBinding<T>(resolve)` + `ctx.bound<T>(name)`
- `lumis route:cache` and `lumis route:clear` commands
- `lumis tinker` REPL command
- `@lumiarq/database` promoted to Level 1 (depends on `@lumiarq/core`)

<a name="v340"></a>
## v3.4.0

- `defineRoute()` removed from app-facing API; use `Route.get/post/...()` DSL
- File convention: `*.api.ts` for API routes, `*.web.ts` for web routes
- `@lumiarq/contracts` added: `MailerContract`, `QueueContract`, `StorageContract`, `CacheContract`, `EventBusContract`, `LoggerContract`
- `defineQuery(fn)` added to `@lumiarq/core`
- `lumis make:query <Module> <Name>` command

<a name="v320"></a>
## v3.2.0

- Auth starter: 34 auth + 25 user + 11 email verification stubs
- IAM bounded context (`lumis auth:install --iam`)
- `key:generate` generates RS256 4096-bit key pair
- 21 `make:*` scaffold commands
- `@lumiarq/query` framework-agnostic data fetching: `/react`, `/vue`, `/solid`, `/svelte`
