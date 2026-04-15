---
title: Upgrade Guide
description: How to upgrade between Lumiarq versions
section: Prologue
order: 3
draft: false
---

# Upgrade Guide

This guide documents how to move between Lumiarq versions. Because Lumiarq is pre-1.0, the API surface is still stabilising. Breaking changes will be called out explicitly here before they land, but you should treat any minor version bump as potentially introducing them until the framework reaches 1.0.

---

## Pre-1.0 stability expectations

Before the 1.0 release, the following rules apply:

- **Patch releases** (`0.x.y`) are safe to apply. They contain bug fixes and backwards-compatible improvements only.
- **Minor releases** (`0.x.0`) may include breaking changes. Always read this guide and the [CHANGELOG](https://github.com/lumiarq/framework/blob/main/CHANGELOG.md) before upgrading.
- **No deprecation windows are guaranteed** before 1.0. A factory function or config shape that exists today may be renamed or removed in the next minor version.

Once the framework reaches 1.0, standard semantic versioning applies and breaking changes will be confined to major releases with deprecation notices in the preceding minor.

---

## Pinning versions

Rather than using a range specifier like `^0.1.0`, consider pinning to an exact version in your `package.json` while the framework is pre-1.0:

```json
{
  "dependencies": {
    "@lumiarq/framework": "0.1.0"
  }
}
```

When you are ready to upgrade, update the version number explicitly, read the section for that version in this guide, and apply any required changes before running your tests.

If you prefer a range, `~0.1.0` is a safer choice than `^0.1.0` — it allows patch updates only, not minor bumps.

---

## Checking your current version

Run the following command from your project root to see the installed framework version alongside Node.js, the runtime adapter, and the current environment:

```bash
pnpm lumis info
```

Example output:

```
Lumiarq v0.1.0
Node.js v22.4.0 (darwin)
Adapter: node
Environment: local
```

You can also read the version programmatically from `node_modules/@lumiarq/framework/package.json`, or check `pnpm list @lumiarq/framework` for what is actually installed.

---

## Upgrading to v0.1.x

This is the initial public release, so there is no prior version to upgrade from. If you are setting up a new Lumiarq project for the first time, follow the [Installation guide](/docs/installation) instead.

If you were using a pre-release or private build of the framework, the following changes were introduced as the codebase was finalised for v0.1.0.

### Module definition API

The object-based `defineModule` API replaced the old positional signature. If you have any module files using the positional form, update them:

```typescript
// Before (old positional API — no longer supported)
export default defineModule('Blog', { prefix: '/blog' });

// After (object API)
export default defineModule({
  name: 'Blog',
  prefix: '/blog',
});
```

The `alias` field is optional and derived automatically from the PascalCase module name if omitted.

### Route files

Route file naming changed from `api.route.ts` / `web.route.ts` to `{kebab}.api.ts` / `{kebab}.web.ts`. Rename your route files to match the new convention:

```
# Before
src/modules/Blog/http/api.route.ts
src/modules/Blog/http/web.route.ts

# After
src/modules/Blog/http/blog.api.ts
src/modules/Blog/http/blog.web.ts
```

The framework infers the route type (API or web) from the file suffix at load time, so the suffix is required and meaningful — not cosmetic.

### `defineRoute` removed from app-facing API

`defineRoute()` is no longer part of the public API. Use the `Route` DSL builder instead:

```typescript
// Before
import { defineRoute } from '@lumiarq/framework';

defineRoute('GET', '/posts', ListPostsHandler);

// After
import { Route } from '@lumiarq/framework';

Route.get('/posts', ListPostsHandler);
```

### Config pattern

The `defineConfig()` helper is internal to the framework and is not intended for application config files. Replace any usage with the `satisfies` pattern:

```typescript
// Before (incorrect for application config)
export default defineConfig<AppConfig>({ name: 'My App' });

// After
import type { AppConfig } from '@lumiarq/framework';

export default {
  name: 'My App',
} satisfies AppConfig;
```

### Import paths

All application-facing imports must come from `@lumiarq/framework` or its sub-paths (`@lumiarq/framework/auth`, `@lumiarq/framework/contracts`, etc.). Direct imports from sub-packages like `@lumiarq/core` or `@lumiarq/runtime` are not part of the public API and will be flagged by the `no-framework-subpackage-import` ESLint rule.

### `emitAsync` renamed to `dispatch`

`EventBus.emitAsync()` has been renamed to `EventBus.dispatch()`. Update all call sites:

```typescript
// Before
await EventBus.emitAsync(PostPublishedEvent, payload);

// After
await EventBus.dispatch(PostPublishedEvent, payload);
```

`dispatch` is fire-and-forget (void return). `emit` is the synchronous variant.

---

## General upgrade checklist

Use this checklist whenever you apply a Lumiarq version bump:

- [ ] Read the release notes and the relevant upgrade section in this file
- [ ] Update `@lumiarq/framework` in `package.json`
- [ ] Run `pnpm install` to resolve the new version
- [ ] Run `pnpm lumis info` to confirm the correct version is active
- [ ] Run `pnpm tsc --noEmit` to catch any type-level breaking changes
- [ ] Run your test suite: `pnpm test`
- [ ] Run `pnpm lumis route:check` to validate route files
- [ ] Review any ESLint warnings introduced by updated rules
- [ ] Deploy to a staging environment before rolling out to production
