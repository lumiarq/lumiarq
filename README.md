# LumiARQ App

The developer-facing reference application for LumiARQ.

This repo plays the same role as `laravel/laravel` in the Laravel ecosystem:

- a runnable application shell
- a reference for project structure and module layout
- a safe place to validate framework DX before changes reach real products

## Quick Start

```sh
pnpm install
cp .env.example .env
pnpm lumis key:generate
pnpm dev
```

Common commands:

```sh
pnpm dev
pnpm test
pnpm lint
pnpm tc
pnpm build
pnpm build:node
pnpm build:cloudflare
pnpm build:static
```

## What This App Contains

- `bootstrap/` — application entry, env validation, provider wiring, cache bootstrap
- `config/` — typed app configuration
- `src/modules/` — business modules; this is the main feature surface
- `src/shared/` — shared app code that should not belong to one module
- `tests/` — app-level tests and integration coverage
- `.arc/` — generated runtime/build artifacts written by Lumis and build commands

Current modules:

- `Welcome` — starter application surface
- `Docs` — integration point for framework docs content

## Provider Model

`bootstrap/providers.ts` intentionally starts with local, safe defaults:

- mailer uses a stub implementation
- queue runs in-process
- storage writes to local disk
- cache uses in-memory storage
- audit writes locally in development

These defaults are intentional for day-one DX. Replace them gradually as deployment needs become real.

## Environment Setup

Start from `.env.example`.

Important notes:

- `pnpm lumis key:generate` fills `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, and `SESSION_SECRET`
- SQLite is the default database for local development
- `PORT` should match the port inside `APP_URL`
- `DOCS_API_URL` should point at the running `lumiarq-docs` app when docs integration is enabled

## Build Targets

- `build:node` — standard Node.js deployment
- `build:cloudflare` — Cloudflare Worker bundle
- `build:static` — static-oriented output plus preview wrapper

Use `pnpm build` when the default Node target is what you want. Use the explicit build commands when testing a deployment target directly.

## TypeScript Aliases

- `@/*` → `src/*`
- `@/modules/*` → `src/modules/*`
- `@/shared/*` → `src/shared/*`
- `@/bootstrap/*` → `bootstrap/*`
- `@/config/*` → `config/*`
- `@/tests/*` → `tests/*`
- `@/lang/*` → `lang/*`

Use these aliases instead of long relative imports.

## Recommended Workflow

```sh
pnpm dev
pnpm test
pnpm lint
pnpm tc
```

Use Lumis commands for app-level tasks such as route caching, health checks, config inspection, and key generation.
