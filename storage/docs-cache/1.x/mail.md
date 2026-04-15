---
title: Mail
description: Sending emails with the Mailer contract
section: Digging Deeper
order: 10
draft: false
---

# Mail

- [Introduction](#introduction)
- [Mail Configuration](#mail-configuration)
- [Registering the Mailer in Providers](#registering-the-mailer-in-providers)
- [Sending Email Inside an Action or Task](#sending-email-inside-an-action-or-task)
- [The MailerContract Interface](#the-mailercontract-interface)
- [HTML and Plain-text Templates](#html-and-plain-text-templates)
- [Attachments](#attachments)
- [Queuing Email Delivery](#queuing-email-delivery)
- [Multiple Mailers](#multiple-mailers)
- [Using the Log Driver in Development](#using-the-log-driver-in-development)
- [Testing Email Dispatch](#testing-email-dispatch)

<a name="introduction"></a>
## Introduction

Lumiarq provides a first-class mailer abstraction through the `MailerContract` from `@lumiarq/contracts`. The contract decouples your application logic from any specific mail driver, making it straightforward to swap SMTP for a transactional email service without touching your business logic.

<a name="mail-configuration"></a>
## Mail Configuration

Mail settings live in `config/mail.ts`. Create or update this file to match your environment:

```typescript
// config/mail.ts
import type { MailConfig } from '@lumiarq/framework'

export default {
  driver: 'smtp',
  host: process.env.MAIL_HOST ?? 'smtp.mailtrap.io',
  port: Number(process.env.MAIL_PORT ?? 587),
  secure: process.env.MAIL_SECURE === 'true',
  auth: {
    user: process.env.MAIL_USER ?? '',
    pass: process.env.MAIL_PASS ?? '',
  },
  from: {
    address: process.env.MAIL_FROM_ADDRESS ?? 'no-reply@example.com',
    name: process.env.MAIL_FROM_NAME ?? 'My App',
  },
} satisfies MailConfig
```

The `driver` field supports any driver your mailer implementation understands. Common values are `'smtp'`, `'ses'`, `'sendgrid'`, and `'log'` (for local development — writes to stdout instead of sending).

<a name="registering-the-mailer-in-providers"></a>
## Registering the Mailer in Providers

The mailer is initialised once at boot time and exported from `bootstrap/providers.ts`. Your actions and tasks import it from there:

```typescript
// bootstrap/providers.ts
import { createMailer } from '@lumiarq/framework'
import mailConfig from '@config/mail'
import { createDb } from '@lumiarq/database'
import databaseConfig from '@config/database'

export const db = createDb(databaseConfig)
export const mailer = createMailer(mailConfig)
```

<a name="sending-email-inside-an-action-or-task"></a>
## Sending Email Inside an Action or Task

The ESLint rule `no-mailer-outside-logic` enforces that `mailer.send()` and `mailer.queue()` are only called from files inside `logic/actions/` or `logic/tasks/`. Calling the mailer from a handler, query, or route file will produce a lint error.

### Example: SendWelcomeEmail Task

A task is the right home for an email send because it represents a discrete, potentially retriable unit of work.

```typescript
// src/modules/Auth/logic/tasks/send-welcome-email.task.ts
import { defineTask } from '@lumiarq/framework'
import { mailer } from '@bootstrap/providers'

interface SendWelcomeEmailPayload {
  to: string
  name: string
}

export const SendWelcomeEmailTask = defineTask(
  async ({ to, name }: SendWelcomeEmailPayload) => {
    await mailer.send({
      to,
      from: { address: 'welcome@example.com', name: 'The Team' },
      subject: `Welcome to the platform, ${name}!`,
      html: `
        <h1>Hi ${name},</h1>
        <p>Thanks for signing up. Your account is ready.</p>
        <p><a href="https://example.com/dashboard">Go to your dashboard</a></p>
      `,
      text: `Hi ${name}, thanks for signing up. Visit https://example.com/dashboard`,
    })
  }
)
```

### Triggering the Task from an Action

```typescript
// src/modules/Auth/logic/actions/register-user.action.ts
import { defineAction } from '@lumiarq/framework'
import { db } from '@bootstrap/providers'
import { SendWelcomeEmailTask } from '@modules/Auth/logic/tasks/send-welcome-email.task'
import { users } from '@modules/Auth/infrastructure/schema'

interface RegisterUserPayload {
  email: string
  name: string
  passwordHash: string
}

export const RegisterUserAction = defineAction(async (payload: RegisterUserPayload) => {
  const [user] = await db
    .insert(users)
    .values(payload)
    .returning()

  // Dispatch email — runs in the same process (or hand off to queue — see Queues docs)
  await SendWelcomeEmailTask({ to: user.email, name: user.name })

  return user
})
```

<a name="the-mailercontract-interface"></a>
## The MailerContract Interface

The full shape of `MailerContract` from `@lumiarq/contracts`:

```typescript
import type { MailerContract } from '@lumiarq/contracts'

// mailer.send() accepts:
interface MailMessage {
  to: string | { address: string; name?: string }
  from?: string | { address: string; name?: string }
  subject: string
  html?: string
  text?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
}
```

The `from` field defaults to the `from` value in your `config/mail.ts` when omitted.

<a name="using-the-log-driver-in-development"></a>
## Using the Log Driver in Development

Set `driver: 'log'` (or read it from an environment variable) during local development to prevent accidental email delivery:

```typescript
// config/mail.ts
export default {
  driver: process.env.MAIL_DRIVER ?? 'log',
  // ...rest of config
} satisfies MailConfig
```

With the `'log'` driver the mailer writes the full rendered email to the console instead of sending it, making it easy to inspect the output without an SMTP server.

<a name="testing-email-dispatch"></a>
## Testing Email Dispatch

Because `SendWelcomeEmailTask` is a plain async function, you can test it in isolation by replacing the mailer with an in-memory spy:

```typescript
// src/modules/Auth/tests/send-welcome-email.test.ts
import { describe, it, expect, vi } from 'vitest'
import { withTestContext } from '@lumiarq/runtime'

describe('SendWelcomeEmailTask', () => {
  it(
    'sends a welcome email to the registered address',
    withTestContext({}, async () => {
      // Arrange: spy on the mailer before importing the task
      const sendSpy = vi.fn().mockResolvedValue(undefined)
      vi.doMock('@bootstrap/providers', () => ({ mailer: { send: sendSpy } }))

      const { SendWelcomeEmailTask } = await import(
        '@modules/Auth/logic/tasks/send-welcome-email.task'
      )

      // Act
      await SendWelcomeEmailTask({ to: 'alice@example.com', name: 'Alice' })

      // Assert
      expect(sendSpy).toHaveBeenCalledOnce()
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@example.com', subject: expect.stringContaining('Alice') })
      )
    })
  )
})
```

<a name="html-and-plain-text-templates"></a>
## HTML and Plain-text Templates

The `MailerContract.send()` method accepts both `html` and `text` fields. Pass a Veil-rendered HTML string for rich emails
and a plain-text fallback for clients that don't render HTML:

```ts
// src/modules/Auth/logic/tasks/send-welcome-email.task.ts
import { defineTask } from '@lumiarq/framework'
import { mailer } from '@bootstrap/providers'
import { render as renderHtml } from '@storage/framework/cache/views/welcome-email.veil'
import { loadLocale } from '@lumiarq/framework/veil'

const locale = loadLocale()

export interface SendWelcomeEmailPayload {
  to:   string
  name: string
}

export const sendWelcomeEmail = defineTask(async (payload: SendWelcomeEmailPayload) => {
  const html = renderHtml({ name: payload.name }, locale)

  await mailer.send({
    to:      payload.to,
    subject: `Welcome to ${process.env.APP_NAME}, ${payload.name}!`,
    html,
    text:    `Hi ${payload.name},\n\nWelcome to ${process.env.APP_NAME}!\n\nGet started: ${process.env.APP_URL}/getting-started`,
  })
})
```

The Veil template `src/modules/Auth/ui/email/templates/welcome-email.veil.html` is compiled like any other view, meaning it
has full access to `@t()` translations and template inheritance.

<a name="attachments"></a>
## Attachments

Pass a `attachments` array to attach files. Each attachment accepts a `filename`, `content` (Buffer or string), and
`contentType`:

```ts
// src/modules/Billing/logic/tasks/send-invoice-pdf.task.ts
import { defineTask } from '@lumiarq/framework'
import { mailer } from '@bootstrap/providers'
import { generateInvoicePdf } from '@modules/Billing/logic/services/pdf-generator'

export interface SendInvoicePdfPayload {
  to:            string
  customerName:  string
  invoiceId:     string
  totalFormatted: string
}

export const sendInvoicePdf = defineTask(async (payload: SendInvoicePdfPayload) => {
  const pdfBuffer = await generateInvoicePdf(payload.invoiceId)

  await mailer.send({
    to:      payload.to,
    subject: `Your invoice — ${payload.totalFormatted}`,
    html:    `<p>Hi ${payload.customerName},</p><p>Please find your invoice attached.</p>`,
    text:    `Hi ${payload.customerName},\n\nPlease find your invoice attached.`,
    attachments: [
      {
        filename:    `invoice-${payload.invoiceId}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })
})
```

<a name="queuing-email-delivery"></a>
## Queuing Email Delivery

For non-blocking email delivery, enqueue the task instead of awaiting it inside an action. The email is sent in a background
worker after the HTTP response has been returned to the user:

```ts
// src/modules/Auth/logic/actions/register-user.action.ts
import { defineAction } from '@lumiarq/framework'
import type { QueueContract } from '@lumiarq/framework/contracts'
import { sendWelcomeEmail } from '@modules/Auth/logic/tasks/send-welcome-email.task'

export const registerUser = defineAction(async (dto: RegisterUserDto) => {
  const user = await userRepo.create(dto)

  // Fire and forget — the response is sent before the email is dispatched
  const queue = app().make<QueueContract>('queue')
  await queue.dispatch(sendWelcomeEmail, {
    to:   user.email,
    name: user.name,
  })

  return user
})
```

Delay an email by a number of seconds using `queue.later`:

```ts
// Send a 7-day trial expiry reminder 6 days from now
await queue.later(sendTrialExpiryReminder, { userId: user.id }, 60 * 60 * 24 * 6)
```

<a name="multiple-mailers"></a>
## Multiple Mailers

When your application needs separate mailers (e.g. transactional emails via SMTP and marketing emails via Mailchimp), register
them under named keys in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
export const mailer = createMailer(mailConfig)
export const marketingMailer = createMailer(marketingMailConfig)
```

Import the correct mailer in each task:

```ts
import { mailer }          from '@bootstrap/providers'   // SMTP transactional
import { marketingMailer } from '@bootstrap/providers'   // Marketing / newsletter
```

---

**Next:** Learn about deferring work with [Queues](/docs/queues).
