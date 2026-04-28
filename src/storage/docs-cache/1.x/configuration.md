---
title: Configuration
description: Configure your Lumiarq application using typed config files
section: Getting Started
order: 2
draft: false
---

# Configuration

- [Introduction](#introduction)
- [The `satisfies` pattern](#the-satisfies-pattern)
- [Accessing config values](#accessing-config-values)
- [The ten config files](#the-ten-config-files)
- [Publishing Config Files](#publishing-config-files)
- [Environment variables](#environment-variables)
- [Inspecting resolved configuration](#inspecting-resolved-configuration)

<a name="introduction"></a>

Lumiarq stores all application configuration in the `config/` directory at the root of your project. Each file corresponds to one area of the system and exports a plain TypeScript object validated against a named config type from `@lumiarq/framework`.

---

<a name="the-satisfies-pattern"></a>
## The `satisfies` pattern

Configuration files use TypeScript's `satisfies` operator instead of a helper function. This gives you full type checking and IDE auto-complete while keeping the value as a plain, inspectable object:

```typescript
import type { AppConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  name: 'My App',
  url: env.APP_URL,
  env: env.APP_ENV,
  debug: env.APP_DEBUG === 'true',
  locale: 'en',
} satisfies AppConfig;
```

`satisfies` ensures that every field matches the expected type while preserving the literal types of the values you provide — so TypeScript knows `locale` is `'en'`, not just `string`. If you omit a required field or provide a value of the wrong type, the error appears at the config file itself, not somewhere deep in framework boot code.

The `defineConfig()` function you may have seen in other frameworks is internal to Lumiarq's bootstrap process and is not part of the public API. Always use `satisfies` in your own config files.

---

<a name="accessing-config-values"></a>
## Accessing config values

Import a config file with a default import anywhere in your application. There is no helper function or IoC container involved:

```typescript
import appConfig from '@/config/app';

console.log(appConfig.name);  // 'My App'
console.log(appConfig.locale); // 'en'
```

The `@/` alias maps to the project root. All ten config files follow the same import pattern:

```typescript
import authConfig from '@/config/auth';
import dbConfig from '@/config/database';
import mailConfig from '@/config/mail';
```

---

<a name="the-ten-config-files"></a>
## The ten config files

A generated project includes ten config files. Here is what each one controls and a representative example.

### `config/app.ts`

General application settings: name, URL, environment, debug flag, and locale.

```typescript
import type { AppConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  name: env.APP_NAME ?? 'Lumiarq App',
  url: env.APP_URL,
  env: env.APP_ENV,
  key: env.APP_KEY ?? '',
  debug: env.APP_DEBUG === 'true',
  locale: 'en',
  fallbackLocale: 'en',
  timezone: 'UTC',
} satisfies AppConfig;
```

### `config/auth.ts`

Authentication settings: JWT algorithm and expiry, session lifetime, bcrypt rounds, and token byte length.

```typescript
import type { AuthConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  driver: 'jwt',
  jwt: {
    algorithm: 'RS256',
    privateKey: env.JWT_PRIVATE_KEY ?? '',
    publicKey: env.JWT_PUBLIC_KEY ?? '',
    expiresIn: '15m',
  },
  session: {
    expiresIn: '7d',
  },
  bcryptRounds: 12,
  tokenBytes: 32,
} satisfies AuthConfig;
```

The JWT private and public keys are written to `.env` by `lumis key:generate` as PEM strings with literal `\n` escaping. The framework parses them back at boot time.

### `config/database.ts`

Database connection settings. Lumiarq supports multiple named connections; the `default` connection is the one used by repositories unless overridden.

```typescript
import type { DatabaseConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      url: env.DATABASE_URL ?? 'file:./database/app.db',
    },
  },
} satisfies DatabaseConfig;
```

To configure a second connection (for example, a read replica or a separate analytics database):

```typescript
connections: {
  sqlite: {
    driver: 'sqlite',
    url: env.DATABASE_URL ?? 'file:./database/app.db',
  },
  analytics: {
    driver: 'sqlite',
    url: env.ANALYTICS_DATABASE_URL ?? 'file:./database/analytics.db',
  },
},
```

Repositories that need the non-default connection declare it with `protected readonly connection = 'analytics'`.

### `config/mail.ts`

Outgoing mail settings.

```typescript
import type { MailConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  default: 'smtp',
  mailers: {
    smtp: {
      driver: 'smtp',
      host: env.MAIL_HOST ?? 'localhost',
      port: Number(env.MAIL_PORT ?? 1025),
      username: env.MAIL_USERNAME,
      password: env.MAIL_PASSWORD,
      encryption: undefined,
    },
  },
  from: {
    address: env.MAIL_FROM_ADDRESS ?? 'hello@example.com',
    name: env.MAIL_FROM_NAME ?? 'My App',
  },
} satisfies MailConfig;
```

### `config/queue.ts`

Background job queue settings.

```typescript
import type { QueueConfig } from '@lumiarq/framework';

export default {
  default: 'database',
  connections: {
    database: {
      driver: 'database',
      table: 'jobs',
      retryAfter: 90,
    },
  },
} satisfies QueueConfig;
```

### `config/storage.ts`

File storage settings.

```typescript
import type { StorageConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  default: 'local',
  disks: {
    local: {
      driver: 'local',
      root: './storage/app',
    },
    public: {
      driver: 'local',
      root: './storage/app/public',
      url: env.APP_URL + '/storage',
    },
  },
} satisfies StorageConfig;
```

### `config/cache.ts`

Cache driver settings.

```typescript
import type { CacheConfig } from '@lumiarq/framework';

export default {
  default: 'memory',
  stores: {
    memory: {
      driver: 'memory',
    },
  },
  ttl: 3600,
} satisfies CacheConfig;
```

### `config/session.ts`

Session storage and cookie settings.

```typescript
import type { SessionConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  driver: 'database',
  lifetime: 120,
  expireOnClose: false,
  cookie: {
    name: 'session',
    path: '/',
    sameSite: 'lax',
    secure: env.APP_ENV === 'production',
    httpOnly: true,
  },
  secret: env.SESSION_SECRET ?? '',
} satisfies SessionConfig;
```

### `config/security.ts`

CORS, rate limiting, and trusted proxy settings.

```typescript
import type { SecurityConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  cors: {
    origin: env.APP_URL,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  },
  rateLimit: {
    windowMs: 60_000,
    max: 100,
  },
  trustedProxies: [],
} satisfies SecurityConfig;
```

### `config/logging.ts`

Runtime logger channel and level settings.

```typescript
import type { LoggingConfig } from '@lumiarq/framework';
import { env } from '@/bootstrap/env';

export default {
  level: env.LOG_LEVEL,
  default: 'console',
  prettify: env.NODE_ENV !== 'production',
  channels: {
    console: {
      driver: 'console',
    },
    file: {
      driver: 'file',
      path: 'storage/logs/lumiarq.log',
    },
  },
} satisfies LoggingConfig;
```

The runtime reads this file from `config/logging.ts` (or `.mjs`, `.js`, `.cjs`, `.json`) during boot. If no file is present, it falls back to a safe default console logger.

---

<a name="publishing-config-files"></a>
## Publishing Config Files

Instead of writing config files from scratch, you can scaffold them from the framework's built-in typed stubs using the `lumis publish config` command:

```bash
pnpm lumis publish config mail
pnpm lumis publish config cache --force
pnpm lumis publish config all
pnpm lumis publish config list
```

`publish config <name>` copies a freshly generated template to `config/<name>.ts`. All eight config files are available:

| Name | Purpose |
|---|---|
| `auth` | JWT algorithm and keys, session lifetime, bcrypt rounds |
| `cache` | Cache driver (`memory` or `redis`), TTL, Redis connection |
| `logging` | Log channel, level, prettify toggle |
| `mail` | Mail driver (`stub`, `smtp`, `resend`), SMTP/Resend credentials, from address |
| `queue` | Queue driver (`sync` or `bullmq`), Redis connection, queue names |
| `security` | CORS origins, rate limiting, trusted proxies |
| `session` | Session driver, lifetime, cookie settings |
| `storage` | Storage disks (`local`, `s3`) and their paths/buckets |

`publish config all` scaffolds all eight files at once — a good first step when starting a new project. `publish config list` shows which files are available and which are already present in your `config/` directory.

The `--force` flag overwrites an existing file. Without it, `publish config` skips files that already exist and prints a notice so you never accidentally clobber custom configuration.

### Published stub convention

Every published stub follows a consistent convention:

- Imports `env` from `bootstrap/env.ts` (using a relative path so it works without alias resolution)
- Declares a `const` object named after the config area
- Uses `as const` for full literal-type inference

```typescript
// config/cache.ts  (generated by lumis publish config cache)
import { env } from '../bootstrap/env.js';

const cache = {
  driver: env.CACHE_DRIVER ?? 'memory',
  ttl: Number(env.CACHE_TTL ?? 3600),
  redis: {
    host: env.REDIS_HOST ?? '127.0.0.1',
    port: Number(env.REDIS_PORT ?? 6379),
    password: env.REDIS_PASSWORD,
    db: Number(env.REDIS_DB ?? 0),
    keyPrefix: env.CACHE_PREFIX ?? 'cache:',
  },
} as const;

export default cache;
```

The `as const` assertion (rather than `satisfies SomeType`) preserves all literal types while keeping the stub self-contained — no framework type import is required until you need to constrain the shape.

---

<a name="environment-variables"></a>
## Environment variables

Rather than reading `process.env` directly throughout your application, Lumiarq validates all environment variables at startup in `bootstrap/env.ts` using Zod. The parsed, typed result is what your config files consume.

```typescript
// bootstrap/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  APP_ENV: z.string().default('local'),
  APP_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  APP_NAME: z.string().optional(),
  APP_DEBUG: z.string().optional(),
  DATABASE_URL: z.string(),
  JWT_PRIVATE_KEY: z.string(),
  JWT_PUBLIC_KEY: z.string(),
  SESSION_SECRET: z.string().min(32),
  // ... additional optional fields
});

export const env = envSchema.parse(process.env);
```

If any required variable is absent or fails its Zod constraint, the application exits immediately with a structured error listing every failing field. This makes deployment failures from misconfigured environments easy to diagnose.

Use the typed `env` export in config files and application code instead of reading `process.env` directly. This keeps environment access validated, centralized, and type-safe.

---

<a name="inspecting-resolved-configuration"></a>
## Inspecting resolved configuration

To see the fully resolved values of any config file (with sensitive fields like keys and secrets redacted), use the `config:show` command:

```bash
pnpm lumis config:show app
pnpm lumis config:show database
pnpm lumis config:show auth
```

This is particularly useful when debugging environment-specific configuration on a staging or production server, where you want to confirm that the right values are being picked up without exposing secrets in logs.
