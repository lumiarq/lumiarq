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

export default {
  name: 'My App',
  url: process.env.APP_URL ?? 'http://localhost:4000',
  env: process.env.APP_ENV ?? 'local',
  debug: process.env.APP_DEBUG === 'true',
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

export default {
  name: process.env.APP_NAME ?? 'Lumiarq App',
  url: process.env.APP_URL ?? 'http://localhost:4000',
  env: process.env.APP_ENV ?? 'local',
  key: process.env.APP_KEY ?? '',
  debug: process.env.APP_DEBUG === 'true',
  locale: 'en',
  fallbackLocale: 'en',
  timezone: 'UTC',
} satisfies AppConfig;
```

### `config/auth.ts`

Authentication settings: JWT algorithm and expiry, session lifetime, bcrypt rounds, and token byte length.

```typescript
import type { AuthConfig } from '@lumiarq/framework';

export default {
  driver: 'jwt',
  jwt: {
    algorithm: 'RS256',
    privateKey: process.env.JWT_PRIVATE_KEY ?? '',
    publicKey: process.env.JWT_PUBLIC_KEY ?? '',
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

export default {
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      url: process.env.DATABASE_URL ?? 'file:./database/app.db',
    },
  },
} satisfies DatabaseConfig;
```

To configure a second connection (for example, a read replica or a separate analytics database):

```typescript
connections: {
  sqlite: {
    driver: 'sqlite',
    url: process.env.DATABASE_URL ?? 'file:./database/app.db',
  },
  analytics: {
    driver: 'sqlite',
    url: process.env.ANALYTICS_DATABASE_URL ?? 'file:./database/analytics.db',
  },
},
```

Repositories that need the non-default connection declare it with `protected readonly connection = 'analytics'`.

### `config/mail.ts`

Outgoing mail settings.

```typescript
import type { MailConfig } from '@lumiarq/framework';

export default {
  default: 'smtp',
  mailers: {
    smtp: {
      driver: 'smtp',
      host: process.env.MAIL_HOST ?? 'localhost',
      port: Number(process.env.MAIL_PORT ?? 1025),
      username: process.env.MAIL_USERNAME,
      password: process.env.MAIL_PASSWORD,
      encryption: undefined,
    },
  },
  from: {
    address: process.env.MAIL_FROM_ADDRESS ?? 'hello@example.com',
    name: process.env.MAIL_FROM_NAME ?? 'My App',
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
      url: process.env.APP_URL + '/storage',
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

export default {
  driver: 'database',
  lifetime: 120,
  expireOnClose: false,
  cookie: {
    name: 'session',
    path: '/',
    sameSite: 'lax',
    secure: process.env.APP_ENV === 'production',
    httpOnly: true,
  },
  secret: process.env.SESSION_SECRET ?? '',
} satisfies SessionConfig;
```

### `config/security.ts`

CORS, rate limiting, and trusted proxy settings.

```typescript
import type { SecurityConfig } from '@lumiarq/framework';

export default {
  cors: {
    origin: process.env.APP_URL ?? 'http://localhost:4000',
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

Log channel and level settings.

```typescript
import type { LoggingConfig } from '@lumiarq/framework';

export default {
  default: 'console',
  channels: {
    console: {
      driver: 'console',
      level: process.env.LOG_LEVEL ?? 'info',
    },
  },
} satisfies LoggingConfig;
```

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

The `env` export is available to config files, but since config files themselves are just TypeScript modules, you can also read `process.env` directly when the value is not covered by the schema. The convention in the generated project is to use `process.env.X ?? 'fallback'` directly in config files, which keeps the config file self-contained and readable.

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
