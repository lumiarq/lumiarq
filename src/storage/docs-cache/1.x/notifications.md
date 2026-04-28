---
title: Notifications
description: Sending multi-channel notifications with NotificationService
section: Digging Deeper
order: 15
draft: false
---

# Notifications

## Table of Contents

- [Introduction](#introduction)
- [NotificationService](#notification-service)
- [The Notification Protocol](#notification-protocol)
- [MailMessage Type](#mail-message-type)
- [Sending Immediately — `.send()`](#send)
- [Queued Sending — `.sendQueued()`](#send-queued)
- [Bulk Sending — `.sendBulk()`](#send-bulk)
- [Notification Class Conventions](#notification-conventions)
- [Scaffold Command](#scaffold-command)
- [Registering NotificationService](#registering-notification-service)
- [Full Example](#full-example)
- [Testing Notifications](#testing-notifications)

---

<a name="introduction"></a>
## Introduction

LumiARQ distinguishes between **mail** and **notifications**. Mail is the low-level transport — it sends an email directly via an SMTP server or an API like Resend. Notifications are higher-level, application-level events that happen to be delivered through one or more channels.

Today, `NotificationService` supports email as its channel. The design, however, is intentionally channel-agnostic: a notification describes *what* should be communicated and *to whom*, while the service decides *how* to deliver it. This makes it straightforward to add SMS, push, Slack, or webhook channels in the future without rewriting the code that sends notifications.

### Notifications vs Mail

| | Mail (`Mailer`) | Notifications (`NotificationService`) |
|---|---|---|
| **Level** | Transport | Application event |
| **Typical usage** | Transactional, raw | User-facing lifecycle events |
| **Channels** | Email only | Email (extensible) |
| **Queueing** | Manual | Built-in via `.sendQueued()` |
| **Bulk fan-out** | Manual | Built-in via `.sendBulk()` |

Use `NotificationService` when the concept being communicated is a meaningful event in your domain: a welcome email after signup, a password-reset link, an order confirmation, a billing failure alert.

---

<a name="notification-service"></a>
## NotificationService

`NotificationService` is exported from `@lumiarq/framework/runtime`:

```typescript
import { NotificationService } from '@lumiarq/framework/runtime'
```

### Constructor

```typescript
interface NotificationServiceOptions {
  /** A Mailer instance (SMTPMailer, ResendMailer, or any MailerContract) */
  mailer: MailerContract

  /** Optional queue — required for sendQueued() */
  queue?: QueueContract
}

const notificationService = new NotificationService({ mailer, queue })
```

---

<a name="notification-protocol"></a>
## The Notification Protocol

A notification is any object that implements the `Notification` protocol — specifically, any object with a `toMail(user: Notifiable)` method that returns a `MailMessage`.

```typescript
interface Notification {
  toMail(user: Notifiable): MailMessage
}
```

`Notifiable` is the user (or any entity) the notification is being sent to. At minimum it must carry an email address:

```typescript
interface Notifiable {
  email: string
  name?: string
  [key: string]: unknown
}
```

Your notification classes do not need to extend a base class or import any interfaces — structural typing means any object with a `toMail` method qualifies.

---

<a name="mail-message-type"></a>
## MailMessage Type

`MailMessage` is the shape returned by `toMail()`:

```typescript
import type { MailMessage } from '@lumiarq/framework/runtime'

interface MailMessage {
  /** Recipient address — overrides the user's email if provided */
  to?: string

  /** Required: email subject line */
  subject: string

  /** Required: HTML body */
  html: string

  /** Optional: plain-text fallback */
  text?: string

  /** Override the 'from' address for this notification only */
  from?: string

  /** Optional file attachments */
  attachments?: Array<{
    filename: string
    content:  Buffer | string
    mimeType?: string
  }>
}
```

If `to` is omitted, `NotificationService` uses `user.email` automatically.

---

<a name="send"></a>
## Sending Immediately — `.send()`

Send a notification synchronously (blocks until the mailer returns):

```typescript
await notificationService.send(notification, user)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `notification` | Any object with `toMail(user)` | The notification to send |
| `user` | `Notifiable` | The recipient |

```typescript
const user = await findUserById(userId)

await notificationService.send(
  new WelcomeNotification(),
  user
)
```

Use `.send()` when you need immediate delivery and are already running inside a queue worker or background job where blocking is acceptable.

---

<a name="send-queued"></a>
## Queued Sending — `.sendQueued()`

Dispatch the notification as a background job (`notification.send`) on the queue:

```typescript
await notificationService.sendQueued(notification, user)
```

This returns immediately after enqueuing. The worker process picks up the `notification.send` job and calls the mailer asynchronously.

```typescript
// In a handler — returns to the client before the email is sent
export const register = defineHandler(async (ctx) => {
  const body = await parseBody(ctx.request, registerSchema)
  const user = await createUser(body)

  await notificationService.sendQueued(
    new WelcomeNotification(),
    user
  )

  return ctx.json(UserResource.make(user), 201)
})
```

Under the hood, `sendQueued` serialises the notification by calling `notification.toMail(user)` and dispatches the resulting `MailMessage` as job data. The worker handler deserialises and calls the mailer.

> **Requirement:** `NotificationService` must be constructed with a `queue` option for `.sendQueued()` to work. An error is thrown at call time if no queue is registered.

---

<a name="send-bulk"></a>
## Bulk Sending — `.sendBulk()`

Fan out a single notification to multiple recipients:

```typescript
await notificationService.sendBulk(notification, users)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `notification` | `Notification` | The notification to send (same instance, called once per user) |
| `users` | `Notifiable[]` | Array of recipients |

`sendBulk` calls `notification.toMail(user)` once per user, so the message can be personalised per recipient:

```typescript
const activeUsers = await db.query.users.findMany({
  where: (u, { eq }) => eq(u.status, 'active'),
})

await notificationService.sendBulk(
  new MonthlyNewsletterNotification({ month: 'January' }),
  activeUsers
)
```

By default `sendBulk` dispatches each send as a separate queued job when a queue is configured, falling back to sequential synchronous sends when no queue is present.

---

<a name="notification-conventions"></a>
## Notification Class Conventions

Store notification classes under the module they belong to:

```
src/
  modules/
    Auth/
      notifications/
        WelcomeNotification.ts
        PasswordResetNotification.ts
    Orders/
      notifications/
        OrderConfirmedNotification.ts
        OrderShippedNotification.ts
```

A notification class is a plain TypeScript class with a `toMail` method. Inject any data needed to build the message via the constructor:

```typescript
// src/modules/Auth/notifications/PasswordResetNotification.ts
import type { MailMessage, Notifiable } from '@lumiarq/framework/runtime'

export class PasswordResetNotification {
  constructor(private readonly resetUrl: string) {}

  toMail(user: Notifiable): MailMessage {
    return {
      subject: 'Reset your password',
      html: `
        <p>Hi ${user.name ?? 'there'},</p>
        <p>Click the link below to reset your password. This link expires in 60 minutes.</p>
        <p><a href="${this.resetUrl}">Reset Password</a></p>
        <p>If you did not request a password reset, you can safely ignore this email.</p>
      `,
      text: `Reset your password: ${this.resetUrl}`,
    }
  }
}
```

---

<a name="scaffold-command"></a>
## Scaffold Command

Generate a notification class with the CLI:

```bash
lumis make:notification <Module> <Name>
```

Example:

```bash
lumis make:notification Auth WelcomeNotification
```

Creates:

```
src/modules/Auth/notifications/WelcomeNotification.ts
```

Generated stub:

```typescript
// src/modules/Auth/notifications/WelcomeNotification.ts
import type { MailMessage, Notifiable } from '@lumiarq/framework/runtime'

export class WelcomeNotification {
  toMail(user: Notifiable): MailMessage {
    return {
      subject: 'Welcome!',
      html:    `<p>Welcome, ${user.name ?? user.email}!</p>`,
    }
  }
}
```

---

<a name="registering-notification-service"></a>
## Registering NotificationService

Wire up `NotificationService` in `bootstrap/providers.ts`, combining your mailer and queue:

```typescript
// bootstrap/providers.ts
import { SMTPMailer, BullMQQueue, NotificationService } from '@lumiarq/framework/runtime'
import { env } from '@lumiarq/framework'

// ─── Mailer ──────────────────────────────────────────────────────────────────

export const mailer = new SMTPMailer({
  host:     env('MAIL_HOST'),
  port:     Number(env('MAIL_PORT', '587')),
  secure:   env('MAIL_SECURE', 'false') === 'true',
  auth:     {
    user: env('MAIL_USERNAME'),
    pass: env('MAIL_PASSWORD'),
  },
  defaults: {
    from: `${env('MAIL_FROM_NAME', 'MyApp')} <${env('MAIL_FROM_ADDRESS')}>`,
  },
})

// ─── Queue ───────────────────────────────────────────────────────────────────

export const queue = new BullMQQueue({
  connection: {
    host:     env('REDIS_HOST', '127.0.0.1'),
    port:     Number(env('REDIS_PORT', '6379')),
    password: env('REDIS_PASSWORD'),
  },
  defaultQueue: 'default',
})

// ─── Notifications ───────────────────────────────────────────────────────────

export const notifications = new NotificationService({ mailer, queue })
```

Then inject `notifications` into your handlers via the container or direct import:

```typescript
// src/modules/Auth/handlers/register.ts
import { notifications } from '#bootstrap/providers.js'
```

---

<a name="full-example"></a>
## Full Example

### WelcomeNotification

```typescript
// src/modules/Auth/notifications/WelcomeNotification.ts
import type { MailMessage, Notifiable } from '@lumiarq/framework/runtime'

export class WelcomeNotification {
  constructor(private readonly appName: string = 'MyApp') {}

  toMail(user: Notifiable): MailMessage {
    return {
      subject: `Welcome to ${this.appName}!`,
      html: `
        <!DOCTYPE html>
        <html>
          <body style="font-family: sans-serif; color: #333;">
            <h1>Welcome aboard, ${user.name ?? user.email}!</h1>
            <p>
              Thanks for signing up for ${this.appName}. Your account is ready.
            </p>
            <p>
              <a href="https://app.example.com/dashboard"
                 style="background:#4F46E5;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">
                Get Started
              </a>
            </p>
            <p style="color:#888;font-size:12px;">
              You're receiving this because you signed up at ${this.appName}.
            </p>
          </body>
        </html>
      `,
      text: `Welcome to ${this.appName}! Visit https://app.example.com/dashboard to get started.`,
    }
  }
}
```

### OrderConfirmedNotification

```typescript
// src/modules/Orders/notifications/OrderConfirmedNotification.ts
import type { MailMessage, Notifiable } from '@lumiarq/framework/runtime'

interface OrderSummary {
  id:         string
  totalCents: number
  currency:   string
  items:      Array<{ name: string; qty: number; priceCents: number }>
}

export class OrderConfirmedNotification {
  constructor(private readonly order: OrderSummary) {}

  toMail(user: Notifiable): MailMessage {
    const total = (this.order.totalCents / 100).toFixed(2)
    const itemRows = this.order.items.map((item) => `
      <tr>
        <td>${item.name}</td>
        <td style="text-align:center">${item.qty}</td>
        <td style="text-align:right">$${(item.priceCents / 100).toFixed(2)}</td>
      </tr>
    `).join('')

    return {
      subject: `Order Confirmed — #${this.order.id}`,
      html: `
        <h2>Your order is confirmed!</h2>
        <p>Hi ${user.name ?? user.email},</p>
        <p>We've received your order and are processing it now.</p>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="text-align:left;padding:8px">Item</th>
              <th style="text-align:center;padding:8px">Qty</th>
              <th style="text-align:right;padding:8px">Price</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="2"><strong>Total</strong></td>
              <td style="text-align:right"><strong>$${total}</strong></td>
            </tr>
          </tfoot>
        </table>
        <p>Order ID: <code>${this.order.id}</code></p>
      `,
      text: `Order confirmed. Total: $${total}. Order ID: ${this.order.id}`,
    }
  }
}
```

### PasswordResetNotification

```typescript
// src/modules/Auth/notifications/PasswordResetNotification.ts
import type { MailMessage, Notifiable } from '@lumiarq/framework/runtime'

export class PasswordResetNotification {
  constructor(
    private readonly resetUrl: string,
    private readonly expiresInMinutes: number = 60
  ) {}

  toMail(user: Notifiable): MailMessage {
    return {
      subject: 'Reset your password',
      html: `
        <p>Hi ${user.name ?? 'there'},</p>
        <p>
          We received a request to reset the password for your account.
          Click the button below to choose a new password.
          This link expires in ${this.expiresInMinutes} minutes.
        </p>
        <p>
          <a href="${this.resetUrl}"
             style="background:#DC2626;color:white;padding:12px 24px;
                    border-radius:6px;text-decoration:none;">
            Reset Password
          </a>
        </p>
        <p>Or copy and paste this URL into your browser:</p>
        <p style="color:#888;font-size:12px;">${this.resetUrl}</p>
        <p>
          If you didn't request a password reset, please ignore this email.
          Your password will remain unchanged.
        </p>
      `,
      text: `Reset your password (expires in ${this.expiresInMinutes} min): ${this.resetUrl}`,
    }
  }
}
```

### Using in a Handler

```typescript
// src/modules/Auth/handlers/register.ts
import { defineHandler }         from '@lumiarq/framework/core'
import { parseBody }             from '@lumiarq/framework/runtime'
import { notifications }         from '#bootstrap/providers.js'
import { WelcomeNotification }   from '../notifications/WelcomeNotification.js'
import { createUser }            from '../actions/createUser.js'
import { UserResource }          from '../resources/UserResource.js'
import { z }                     from 'zod'

const schema = z.object({
  name:     z.string().min(2),
  email:    z.string().email(),
  password: z.string().min(8),
})

export const register = defineHandler(async (ctx) => {
  const body = await parseBody(ctx.request, schema)
  const user = await createUser(body)

  // Queue the welcome email — don't block the response
  await notifications.sendQueued(new WelcomeNotification(), user)

  return ctx.json(UserResource.make(user), 201)
})
```

---

<a name="testing-notifications"></a>
## Testing Notifications

### Testing the Message Content

Since notification classes are plain TypeScript, you can unit-test them without touching the mailer at all:

```typescript
// tests/notifications/WelcomeNotification.test.ts
import { describe, it, expect } from 'vitest'
import { WelcomeNotification }  from '#modules/Auth/notifications/WelcomeNotification'

describe('WelcomeNotification', () => {
  const user = { email: 'alice@example.com', name: 'Alice' }

  it('builds a subject line with the app name', () => {
    const notification = new WelcomeNotification('Acme')
    const message = notification.toMail(user)
    expect(message.subject).toBe('Welcome to Acme!')
  })

  it('includes the user name in the HTML body', () => {
    const message = new WelcomeNotification().toMail(user)
    expect(message.html).toContain('Alice')
  })

  it('falls back to email when name is absent', () => {
    const message = new WelcomeNotification().toMail({ email: 'bob@example.com' })
    expect(message.html).toContain('bob@example.com')
  })
})
```

### Testing with a Fake Mailer

Use `FakeMailer` from the testing package to assert that notifications were sent:

```typescript
// tests/modules/Auth/register.test.ts
import { describe, it, expect }    from 'vitest'
import { FakeMailer }              from '@lumiarq/framework/testing'
import { NotificationService }     from '@lumiarq/framework/runtime'
import { withTestContext }         from '@lumiarq/framework/testing'
import { register }                from '#modules/Auth/handlers/register'

describe('register handler', () => {
  it('sends a welcome notification after signup', async () => {
    const fakeMailer = new FakeMailer()
    const notifs     = new NotificationService({ mailer: fakeMailer })

    await withTestContext(
      {
        method: 'POST',
        body:   { name: 'Alice', email: 'alice@example.com', password: 'password123' },
        state:  { notifications: notifs },
      },
      (ctx) => register(ctx)
    )

    fakeMailer.assertSent((message) => {
      return (
        message.to      === 'alice@example.com' &&
        message.subject === 'Welcome to MyApp!'
      )
    })
  })

  it('does not send a notification if registration fails', async () => {
    const fakeMailer = new FakeMailer()
    // ... simulate failure
    fakeMailer.assertNothingSent()
  })
})
```

`FakeMailer` exposes:

| Method | Description |
|--------|-------------|
| `assertSent(predicate)` | Assert at least one email matching the predicate was sent |
| `assertNotSent(predicate)` | Assert no email matching the predicate was sent |
| `assertNothingSent()` | Assert no emails were sent at all |
| `sentMessages()` | Returns all captured `MailMessage` objects |
