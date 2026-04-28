---
title: Localization
description: Multi-language support and translation management in Lumiarq
section: Digging Deeper
order: 9
draft: false
---

# Localization

- [Introduction](#introduction)
- [Translation Files](#translation-files)
- [Loading Translations](#loading-translations)
- [The `t()` Helper](#the-t-helper)
- [Locale Middleware](#locale-middleware)
- [Dynamic Locale in Templates](#dynamic-locale-in-templates)
- [Locale in Execution Context](#locale-in-execution-context)

<a name="introduction"></a>
## Introduction

LumiARQ ships a lightweight i18n system that integrates with the `ExecutionContext`. Every request carries a resolved `locale` string (BCP 47 tag), and the `t()` helper looks up translations from an in-memory catalog built from JSON files in `lang/`.

The system has three layers:

- **`lang/*.json`** — flat JSON files containing key→value translation strings
- **`@lumiarq/framework/core`** — runtime catalog (`loadTranslations`, `t`, `getActiveLocale`, `setLocaleConfig`)
- **`localeMiddleware`** — detects the best locale per-request from `Accept-Language` or the authenticated user's preference

<a name="translation-files"></a>
## Translation Files

Create one JSON file per locale in the `lang/` directory at your project root:

```
lang/
  en.json
  fr.json
  es.json
```

Each file is a flat key→value map:

```json
// lang/en.json
{
  "welcome": "Welcome",
  "greeting": "Hello, :name!",
  "nav.docs": "Documentation",
  "error.not_found": "Page not found"
}
```

```json
// lang/fr.json
{
  "welcome": "Bienvenue",
  "greeting": "Bonjour, :name !",
  "nav.docs": "Documentation",
  "error.not_found": "Page introuvable"
}
```

Use `:param` tokens for interpolation (see [`t()`](#the-t-helper) below).

<a name="loading-translations"></a>
## Loading Translations

Register translations at application boot time using `loadTranslations()`. Call it once per locale in your bootstrap provider:

```ts
// src/bootstrap/providers.ts
import { loadTranslations, setLocaleConfig } from '@lumiarq/framework/core'
import en from '../../lang/en.json' assert { type: 'json' }
import fr from '../../lang/fr.json' assert { type: 'json' }

setLocaleConfig('en', 'en') // setLocaleConfig(defaultLocale, fallbackLocale)

loadTranslations('en', en)
loadTranslations('fr', fr)
```

`loadTranslations` merges new keys into the existing catalog — calling it multiple times for the same locale accumulates keys rather than replacing them. This lets you split large catalogs across modules.

<a name="the-t-helper"></a>
## The `t()` Helper

Use `t(key, params?)` anywhere in handlers, templates, or services:

```ts
import { t } from '@lumiarq/framework/core'

// Basic lookup
t('welcome')        // => 'Welcome'

// Named interpolation with :param tokens
t('greeting', { name: 'Alice' })   // => 'Hello, Alice!'

// Nested dot-notation key
t('nav.docs')       // => 'Documentation'

// Missing key returns the key itself — never throws
t('unknown.key')    // => 'unknown.key'
```

Resolution order:
1. Active locale (set per-request by `localeMiddleware`)
2. Fallback locale (configured with `setLocaleConfig`)
3. Raw key string (safety net — no exception thrown)

<a name="locale-middleware"></a>
## Locale Middleware

Add `localeMiddleware` to your application middleware stack to automatically detect and resolve the best locale for each request:

```ts
// src/bootstrap/providers.ts
import { localeMiddleware } from '@lumiarq/framework/runtime'

app.use(localeMiddleware({
  supported: ['en', 'fr', 'es'],
  default: 'en',
}))
```

Detection priority:
1. Authenticated user's `locale` field (from `ctx.auth.getUser()`)
2. `Accept-Language` request header (quality-weighted, with primary subtag fallback)
3. `default` option

The resolved locale is stored on the `ExecutionContext` as `ctx.locale` and is available throughout the entire request lifecycle — handlers, services, queries, and templates all read the same value.

<a name="dynamic-locale-in-templates"></a>
## Dynamic Locale in Templates

Veil templates receive a locale map at render time. Use `loadLocale(locale)` inside your template function — reading `getContext().locale` — so each request renders in the correct language:

```ts
// src/modules/Home/ui/web/pages/home.page.ts
import { loadLocale } from '@lumiarq/framework/veil'
import { getContext } from '@lumiarq/framework/context'
import { render } from '@/storage/framework/cache/views/home-page.veil'

export function HomePageTemplate(props: HomePageTemplateProps): string {
  const locale = loadLocale(getContext().locale)
  return render(props, locale)
}
```

`loadLocale(locale)` reads `lang/<locale>.json` from disk and returns the flat key→value map. The compiled render function passes this map to the `__t(key, locale)` calls generated from `{{ t('key') }}` expressions in the `.veil.html` template.

> **Do not call `loadLocale()` at module scope.** Module-level calls run once at startup and are always `'en'` regardless of the request. Call it inside the template function to get the per-request locale from the execution context.

<a name="locale-in-execution-context"></a>
## Locale in Execution Context

The `ExecutionContext.locale` field (BCP 47 string, defaults to `'en'`) is the single source of truth for the active locale within a request:

```ts
import { getContext } from '@lumiarq/framework/context'

const ctx = getContext()
console.log(ctx.locale) // e.g. 'fr'
```

You can read `ctx.locale` directly in handlers, services, or queries without importing the i18n module. This is especially useful when passing locale to external services or building locale-aware cache keys:

```ts
export async function getDocPageQuery(slug: string) {
  const { locale } = getContext()
  const cacheKey = `docs:${locale}:${slug}`
  // ...
}
```

To override the locale for a specific scope (e.g. sending a transactional email in the user's language), wrap the operation in a new context:

```ts
import { runWithContext, createRequestContext } from '@lumiarq/framework/context'

await runWithContext(
  createRequestContext({ locale: user.preferredLocale }),
  () => sendWelcomeEmail(user)
)
```
