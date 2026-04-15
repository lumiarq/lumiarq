---
title: Error Handling
description: Handling exceptions and failures in Lumiarq
section: The Basics
order: 12
draft: false
---

# Errors & Logging

- [Introduction](#introduction)
- [Typed Errors](#typed-errors)
- [Error Handling in Handlers](#error-handling-in-handlers)
- [Logging Configuration](#logging-configuration)
- [Structured Logging](#structured-logging)
- [Maintenance Mode](#maintenance-mode)

<a name="introduction"></a>

Lumiarq treats errors and logging as first-class concerns. Typed errors give handlers structured information to act on, and the logging configuration determines how that information surfaces in development, staging, and production.

<a name="typed-errors"></a>
## Typed Errors

The framework ships a set of typed errors in `@lumiarq/core`. Throwing these in your logic layer allows handlers and middleware to respond consistently without string-matching error messages.

| Error | HTTP Status | Description |
|-------|-------------|-------------|
| `ConfigurationError` | 500 | Missing or invalid application configuration |
| `AuthenticationError` | 401 | User is not authenticated |
| `AuthorizationError` | 403 | User lacks permission for the resource |
| `ValidationError` | 422 | Input data failed validation |
| `NotFoundError` | 404 | The requested resource does not exist |
| `ConflictError` | 409 | The operation conflicts with the current state |
| `RateLimitError` | 429 | Request rate limit exceeded |

Import them from `@lumiarq/framework`:

```typescript
import {
  ConfigurationError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
} from '@lumiarq/framework'
```

### ConfigurationError

`ConfigurationError` is thrown at boot time when required environment variables or configuration values are missing. You will most often encounter it in `bootstrap/env.ts`:

```typescript
// bootstrap/env.ts
import { ConfigurationError } from '@lumiarq/framework'
import { z } from 'zod'

const result = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_PRIVATE_KEY: z.string().min(1),
  SESSION_SECRET: z.string().length(64),
}).safeParse(process.env)

if (!result.success) {
  throw new ConfigurationError(
    'Required environment variables are missing or invalid',
    { cause: result.error },
  )
}

export const env = result.data
```

The application will not start if a `ConfigurationError` is thrown during bootstrap, which is exactly the intended behaviour — a misconfigured deployment should fail fast rather than run silently broken.

<a name="error-handling-in-handlers"></a>
## Error Handling in Handlers

Catch errors from your logic layer and return the appropriate HTTP response. The framework error types expose a `statusCode` property:

```typescript
// src/modules/Billing/http/handlers/get-invoice.handler.ts
import { defineHandler, NotFoundError, AuthorizationError } from '@lumiarq/framework'
import { GetInvoiceQuery } from '../../logic/queries/get-invoice.query'
import { InvoicePolicy } from '../../logic/policies/invoice.policy'

export const GetInvoiceHandler = defineHandler(async (ctx) => {
  const user = ctx.get('user')
  const invoiceId = ctx.req.param('id')

  try {
    const invoice = await GetInvoiceQuery(invoiceId)

    if (!invoice) {
      throw new NotFoundError('Invoice not found')
    }

    const allowed = await InvoicePolicy.view(user, invoice)
    if (!allowed) {
      throw new AuthorizationError()
    }

    return ctx.json(invoice)
  } catch (error) {
    if (error instanceof NotFoundError) {
      return ctx.json({ error: error.message }, 404)
    }
    if (error instanceof AuthorizationError) {
      return ctx.json({ error: 'Forbidden' }, 403)
    }
    throw error  // Re-throw unexpected errors for global handling
  }
})
```

For a cleaner handler, push error-to-response translation into a global error handler registered in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { app } from '@lumiarq/framework'
import {
  NotFoundError,
  AuthorizationError,
  AuthenticationError,
  ValidationError,
} from '@lumiarq/framework'

app.onError((error, ctx) => {
  if (error instanceof ValidationError) {
    return ctx.json({ error: error.message, fields: error.fields }, 422)
  }
  if (error instanceof AuthenticationError) {
    return ctx.json({ error: 'Unauthenticated' }, 401)
  }
  if (error instanceof AuthorizationError) {
    return ctx.json({ error: 'Forbidden' }, 403)
  }
  if (error instanceof NotFoundError) {
    return ctx.json({ error: error.message }, 404)
  }

  // Unknown error — log and return 500
  console.error('[unhandled]', error)
  return ctx.json({ error: 'Internal server error' }, 500)
})
```

With a global handler in place, your route handlers can throw typed errors and stay focused on the happy path.

<a name="logging-configuration"></a>
## Logging Configuration

Logging is configured in `config/logging.ts`:

```typescript
import type { LoggingConfig } from '@lumiarq/framework'

export default {
  default: 'console',

  channels: {
    console: {
      driver: 'console',
      level: process.env.LOG_LEVEL ?? 'info',
      format: process.env.APP_ENV === 'production' ? 'json' : 'pretty',
    },

    file: {
      driver: 'file',
      path: 'logs/app.log',
      level: 'warning',
      format: 'json',
    },

    stack: {
      driver: 'stack',
      channels: ['console', 'file'],
    },
  },
} satisfies LoggingConfig
```

### Log Levels

Levels follow the standard syslog severity scale, from most to least verbose:

| Level | When to Use |
|-------|-------------|
| `debug` | Detailed diagnostic information for development |
| `info` | Normal operational messages (requests, events) |
| `notice` | Notable events that are not errors |
| `warning` | Unexpected situations that do not stop the request |
| `error` | Errors that cause a request to fail |
| `critical` | System-level failures (database unreachable, disk full) |

Set `LOG_LEVEL=debug` in development and `LOG_LEVEL=warning` or `LOG_LEVEL=error` in production.

### Log Formats

- `pretty` — Coloured, human-readable output for local development
- `json` — Structured JSON output for log aggregators (Datadog, CloudWatch, Loki)

Always use `json` format in production so log lines are parseable by your observability platform.

<a name="structured-logging"></a>
## Structured Logging

Use the `logger` resolved from your providers rather than `console.log` in production code. Structured logs attach context as fields rather than interpolating into the message string:

```typescript
// bootstrap/providers.ts
import { createLogger } from '@lumiarq/framework'
import loggingConfig from '@config/logging'

export const logger = createLogger(loggingConfig)
```

```typescript
// In a handler or action
import { logger } from '@bootstrap/providers'

export const CreateInvoiceAction = defineAction(async (dto: CreateInvoiceDto) => {
  logger.info('Creating invoice', {
    userId: dto.userId,
    amount: dto.amount,
    currency: dto.currency,
  })

  try {
    const invoice = await InvoiceRepository.create(dto)

    logger.info('Invoice created', { invoiceId: invoice.id })
    return invoice
  } catch (error) {
    logger.error('Failed to create invoice', {
      userId: dto.userId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
})
```

In `json` format, the above produces:

```json
{"level":"info","message":"Creating invoice","userId":"usr_42","amount":499,"currency":"GBP","timestamp":"2025-03-17T10:42:00.000Z"}
{"level":"info","message":"Invoice created","invoiceId":"inv_001","timestamp":"2025-03-17T10:42:00.012Z"}
```

Log message strings should be static so that aggregators can group them reliably. Variable data belongs in the fields object, not interpolated into the message.

<a name="maintenance-mode"></a>
## Maintenance Mode

During deployments or emergency incidents, put your application into maintenance mode so visitors receive a clear message rather than errors:

```bash
pnpm lumis down
```

By default this returns a `503 Service Unavailable` response. Customise the message and a retry hint:

```bash
pnpm lumis down --message "Scheduled maintenance until 14:00 UTC" --retry 900
```

Bring the application back online:

```bash
pnpm lumis up
```

Maintenance mode is implemented via `maintenanceMiddleware`. It checks for the presence of a maintenance sentinel file. The `lumis down` command writes the file; `lumis up` removes it. No application restart is needed.

### Bypassing Maintenance Mode

You can allow specific IPs to bypass maintenance mode — useful for internal teams who need to verify the deployment:

```bash
pnpm lumis down --allow 203.0.113.10 --allow 203.0.113.11
```

The allowed IPs are stored in the maintenance sentinel file and read by the middleware on each request.

---

**Next:** Learn about broadcasting domain events with the [Events](/docs/events) system.
