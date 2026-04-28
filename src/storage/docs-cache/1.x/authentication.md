---
title: Authentication
description: Adding authentication to your Lumiarq application
section: Security
order: 1
draft: false
---

# Authentication

- [Introduction](#introduction)
- [Scaffolding Authentication](#scaffolding-authentication)
- [Key Generation](#key-generation)
- [Authentication Configuration](#authentication-configuration)
- [Session-Based Web Authentication](#session-based-web-authentication)
- [JWT-Based API Authentication](#jwt-based-api-authentication)
- [Email Verification](#email-verification)
- [Password Reset](#password-reset)
- [IAM Bounded Context](#iam-bounded-context)
- [Localisation](#localisation)

<a name="introduction"></a>

Lumiarq ships with a complete, production-ready authentication system. Rather than writing auth from scratch, you scaffold it once and own the generated code in your application.

<a name="scaffolding-authentication"></a>
## Scaffolding Authentication

Run the install command to generate the full authentication layer:

```bash
pnpm lumis auth:install
```

This generates three things:

1. `src/modules/Auth/` — login, register, logout, password reset, email verification
2. `src/modules/User/` — profile reading and management
3. `lang/en.json` — localised auth error and validation messages

The generated modules are plain source files in your project. You can read them, modify them, and extend them freely.

### What Gets Generated

```
src/modules/Auth/
├── http/
│   ├── routes/
│   │   ├── auth.web.ts          # Session-based web routes
│   │   └── auth.api.ts          # JWT API routes
│   └── handlers/
│       ├── login.handler.ts
│       ├── register.handler.ts
│       ├── logout.handler.ts
│       ├── verify-email.handler.ts
│       └── reset-password.handler.ts
├── logic/
│   ├── actions/
│   │   ├── login.action.ts
│   │   ├── register.action.ts
│   │   ├── logout.action.ts
│   │   ├── verify-email.action.ts
│   │   └── reset-password.action.ts
│   ├── tasks/
│   │   ├── send-verification-email.task.ts
│   │   └── send-password-reset.task.ts
│   └── validators/
│       ├── login.validator.ts
│       └── register.validator.ts
├── module.ts
└── index.ts

src/modules/User/
├── http/
│   ├── routes/
│   │   ├── user.web.ts
│   │   └── user.api.ts
│   └── handlers/
│       └── get-profile.handler.ts
├── logic/
│   └── queries/
│       └── get-profile.query.ts
├── module.ts
└── index.ts

lang/
└── en.json
```

<a name="key-generation"></a>
## Key Generation

Before running the application, generate your cryptographic keys:

```bash
pnpm lumis key:generate
```

This creates and writes to your `.env` file:

```
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...
SESSION_SECRET=a3f9c2e1b7d8...
```

The private/public keypair uses RS256 with a 4096-bit modulus. The session secret is a 32-byte random hex string. See the [Encryption](/docs/encryption) page for rotation and `.env` hygiene.

<a name="authentication-configuration"></a>
## Authentication Configuration

Authentication is configured in `config/auth.ts`:

```typescript
import type { AuthConfig } from '@lumiarq/framework'

export default {
  guard: 'session',           // Default guard: 'session' | 'jwt'
  passwordHashRounds: 12,     // bcrypt cost factor
  jwt: {
    algorithm: 'RS256',
    expiresIn: '15m',         // Access token TTL
    refreshExpiresIn: '7d',   // Refresh token TTL
  },
  session: {
    name: 'sid',
    expiresIn: '7d',
  },
  verification: {
    required: true,           // Require email verification before login
    tokenTtl: '24h',
  },
  passwordReset: {
    tokenTtl: '1h',
  },
} satisfies AuthConfig
```

<a name="session-based-web-authentication"></a>
## Session-Based Web Authentication

Web routes use session cookies and CSRF protection. The generated `auth.web.ts` registers routes under the standard web middleware stack:

```typescript
// src/modules/Auth/http/routes/auth.web.ts
import { Route } from '@lumiarq/framework'
import { LoginHandler } from '../handlers/login.handler'
import { RegisterHandler } from '../handlers/register.handler'
import { LogoutHandler } from '../handlers/logout.handler'

Route.get('/login', LoginPageHandler, {
  name: 'auth.login',
  render: 'traditional',
})

Route.post('/login', LoginHandler, {
  name: 'auth.login.submit',
  render: 'redirect',
})

Route.post('/register', RegisterHandler, {
  name: 'auth.register',
  render: 'redirect',
})

Route.post('/logout', LogoutHandler, {
  name: 'auth.logout',
  render: 'redirect',
})
```

The login action validates credentials, creates a session, and writes the session ID into a signed cookie:

```typescript
// src/modules/Auth/logic/actions/login.action.ts
import { defineAction } from '@lumiarq/framework'
import { LoginDto } from '../validators/login.validator'

export const LoginAction = defineAction(async (dto: LoginDto, ctx) => {
  const identity = await IdentityRepository.findByEmail(dto.email)

  if (!identity || !(await identity.checkPassword(dto.password))) {
    throw new AuthenticationError('These credentials do not match our records.')
  }

  await ctx.session.regenerate()
  ctx.session.set('user_id', identity.userId)

  return identity
})
```

<a name="jwt-based-api-authentication"></a>
## JWT-Based API Authentication

API routes use stateless JWT authentication. Clients send a Bearer token in the `Authorization` header.

```typescript
// src/modules/Auth/http/routes/auth.api.ts
import { Route } from '@lumiarq/framework'
import { LoginApiHandler } from '../handlers/login-api.handler'
import { RefreshHandler } from '../handlers/refresh.handler'

Route.post('/api/auth/login', LoginApiHandler, {
  name: 'api.auth.login',
  render: 'json',
})

Route.post('/api/auth/refresh', RefreshHandler, {
  name: 'api.auth.refresh',
  render: 'json',
})
```

The login handler returns signed access and refresh tokens:

```typescript
// src/modules/Auth/http/handlers/login-api.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { LoginAction } from '../../logic/actions/login.action'
import { SignJwtTask, SignRefreshTokenTask } from '@lumiarq/framework/auth'

export const LoginApiHandler = defineHandler(async (ctx) => {
  const dto = await ctx.req.json()
  const identity = await LoginAction(dto, ctx)

  const accessToken = await SignJwtTask({ sub: identity.userId })
  const refreshToken = await SignRefreshTokenTask({ sub: identity.userId })

  return ctx.json({ access_token: accessToken, refresh_token: refreshToken })
})
```

### Protecting API Routes with JWT

Use the JWT middleware to guard API endpoints:

```typescript
// src/modules/User/http/routes/user.api.ts
import { Route } from '@lumiarq/framework'
import { GetProfileHandler } from '../handlers/get-profile.handler'

Route.get('/api/me', GetProfileHandler, {
  name: 'api.user.profile',
  render: 'json',
  middleware: ['auth:jwt'],
})
```

Inside the handler, the verified token payload is available via `ctx.get('jwtPayload')`:

```typescript
// src/modules/User/http/handlers/get-profile.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { GetProfileQuery } from '../../logic/queries/get-profile.query'

export const GetProfileHandler = defineHandler(async (ctx) => {
  const { sub: userId } = ctx.get('jwtPayload')
  const profile = await GetProfileQuery(userId)
  return ctx.json(profile)
})
```

<a name="email-verification"></a>
## Email Verification

When `verification.required` is set to `true` in your auth config, users must verify their email before they can access protected areas. The verification flow is generated automatically.

The verify-email handler processes the signed token from the verification link:

```typescript
// src/modules/Auth/http/handlers/verify-email.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { VerifyEmailAction } from '../../logic/actions/verify-email.action'

export const VerifyEmailHandler = defineHandler(async (ctx) => {
  const token = ctx.req.param('token')
  await VerifyEmailAction({ token })
  return ctx.redirect('/dashboard')
})
```

<a name="password-reset"></a>
## Password Reset

The password reset flow sends a signed time-limited token via email:

```typescript
// src/modules/Auth/logic/actions/reset-password.action.ts
import { defineAction } from '@lumiarq/framework'
import type { ResetPasswordDto } from '../validators/reset-password.validator'

export const ResetPasswordAction = defineAction(async (dto: ResetPasswordDto) => {
  const record = await PasswordResetRepository.findValid(dto.token, dto.email)

  if (!record) {
    throw new ValidationError('This password reset link is invalid or has expired.')
  }

  await IdentityRepository.updatePassword(record.userId, dto.password)
  await PasswordResetRepository.consume(record.id)
})
```

<a name="iam-bounded-context"></a>
## IAM Bounded Context

For applications that separate identity management from your core business domain, install the IAM module instead:

```bash
pnpm lumis auth:install --iam
```

This generates `src/modules/IAM/` as a self-contained bounded context with its own users, roles, permissions, and audit trail. The IAM module never imports from `Auth/` or `User/` — it stands alone.

```
src/modules/IAM/
├── http/
│   ├── routes/
│   │   ├── iam.api.ts
│   │   └── iam.web.ts
│   └── handlers/
├── logic/
│   ├── actions/
│   ├── queries/
│   └── validators/
├── module.ts
└── index.ts
```

Use `--iam` when building multi-tenant SaaS platforms, internal admin tools, or any system where identity is a first-class domain of its own rather than a support concern.

<a name="localisation"></a>
## Localisation

The `lang/en.json` file generated by `auth:install` contains 24 keys covering authentication errors and validation messages:

```json
{
  "auth.failed": "These credentials do not match our records.",
  "auth.throttle": "Too many login attempts. Please try again in :seconds seconds.",
  "auth.email_unverified": "Please verify your email address before continuing.",
  "auth.password_mismatch": "The provided password does not match your current password.",
  "validation.required": "The :field field is required.",
  "validation.email": "The :field must be a valid email address.",
  "validation.min": "The :field must be at least :min characters.",
  "validation.confirmed": "The :field confirmation does not match."
}
```

Add translations for additional locales in `lang/{locale}.json` and configure the locale middleware in `bootstrap/providers.ts`.

---

**Next:** Learn how to control access to resources with [Authorization](/docs/authorization).
