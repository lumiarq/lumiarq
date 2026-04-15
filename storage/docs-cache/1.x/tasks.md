---
title: Tasks
description: Running background work with tasks
section: Architecture Concepts
order: 9
draft: false
---

# Tasks

- [Introduction](#introduction)
- [Defining a Task](#defining-a-task)
- [A Complete Task](#a-complete-task)
- [Generating a Task](#generating-a-task)
- [Calling a Task from an Action](#calling-a-task-from-an-action)
- [Enqueuing a Task for Async Execution](#enqueuing-a-task-for-async-execution)
- [Tasks and the Storage Contract](#tasks-and-the-storage-contract)
- [Multiple Tasks from One Action](#multiple-tasks-from-one-action)
- [Testing a Task](#testing-a-task)

<a name="introduction"></a>
## Introduction

A **task** is an async function dedicated to a single side effect: sending an email, uploading a file, calling a third-party API, writing an audit log entry. Tasks live in `logic/tasks/` inside a module and are created with `defineTask`.

The distinction between actions and tasks is deliberate:

- **Actions** encapsulate business decisions and state changes. They are the source of truth for _what happened_.
- **Tasks** carry out the consequences — the work that _results_ from what happened. Tasks do not contain business rules.

This separation keeps business logic pure and side effects isolated, which makes both easier to test.

<a name="defining-a-task"></a>
## Defining a Task

```ts
import { defineTask } from '@lumiarq/framework'

export const sendInvoiceEmail = defineTask(async (payload: SendInvoiceEmailPayload) => {
  // send the email
})
```

`defineTask` wraps your function. The result is a callable that accepts the payload type directly.

<a name="a-complete-task"></a>
## A Complete Task

```ts
// src/modules/Billing/logic/tasks/send-invoice-email.task.ts
import { defineTask } from '@lumiarq/framework'
import type { MailerContract } from '@lumiarq/framework/contracts'

export interface SendInvoiceEmailPayload {
  invoiceId: string
  recipientEmail: string
  recipientName: string
  totalFormatted: string
  dueDateFormatted: string
}

export const sendInvoiceEmail = defineTask(async (payload: SendInvoiceEmailPayload) => {
  const mailer = app().make<MailerContract>('mailer')

  await mailer.send({
    to: { email: payload.recipientEmail, name: payload.recipientName },
    subject: `Your invoice is ready`,
    html: renderInvoiceEmail({
      total: payload.totalFormatted,
      dueDate: payload.dueDateFormatted,
    }),
  })
})
```

<a name="generating-a-task"></a>
## Generating a Task

```bash
pnpm lumis make:task Billing SendInvoiceEmail
```

This creates:

```
src/modules/Billing/logic/tasks/send-invoice-email.task.ts
```

With a stub ready to implement:

```ts
import { defineTask } from '@lumiarq/framework'

export interface SendInvoiceEmailPayload {
  // TODO: define payload fields
}

export const sendInvoiceEmail = defineTask(async (payload: SendInvoiceEmailPayload) => {
  // TODO: implement task
})
```

<a name="calling-a-task-from-an-action"></a>
## Calling a Task from an Action

The most common pattern is an action calling a task after completing its core business logic:

```ts
// src/modules/Billing/logic/actions/create-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import { InvoiceRepository } from '@modules/Billing/logic/repositories/invoice.repository'
import { sendInvoiceEmail } from '@modules/Billing/logic/tasks/send-invoice-email.task'
import type { CreateInvoiceDto } from '@modules/Billing/contracts'

const repo = new InvoiceRepository()

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  const invoice = await repo.create(dto)

  // Delegate the side effect to a task
  await sendInvoiceEmail({
    invoiceId: invoice.id,
    recipientEmail: dto.customerEmail,
    recipientName: dto.customerName,
    totalFormatted: formatCurrency(invoice.totalCents),
    dueDateFormatted: formatDate(invoice.dueDateIso),
  })

  return invoice
})
```

Calling the task directly (with `await`) is appropriate when you want the response to wait for the task to complete. If the task can run asynchronously, enqueue it instead.

<a name="enqueuing-a-task-for-async-execution"></a>
## Enqueuing a Task for Async Execution

For work that should not block the HTTP response — sending emails, generating reports, calling slow APIs — enqueue the task using `QueueContract`. The task runs in a background worker process after the response has been sent.

```ts
// src/modules/Billing/logic/actions/create-invoice.action.ts
import { defineAction } from '@lumiarq/framework'
import type { QueueContract } from '@lumiarq/framework/contracts'
import { sendInvoiceEmail } from '@modules/Billing/logic/tasks/send-invoice-email.task'

export const createInvoice = defineAction(async (dto: CreateInvoiceDto) => {
  const invoice = await repo.create(dto)

  const queue = app().make<QueueContract>('queue')

  // Enqueue the task — it runs in a background worker
  await queue.dispatch(sendInvoiceEmail, {
    invoiceId: invoice.id,
    recipientEmail: dto.customerEmail,
    recipientName: dto.customerName,
    totalFormatted: formatCurrency(invoice.totalCents),
    dueDateFormatted: formatDate(invoice.dueDateIso),
  })

  // Return the invoice immediately without waiting for the email
  return invoice
})
```

The `queue.later` method allows deferring a task by a number of seconds:

```ts
// Send a reminder email 3 days before the due date
await queue.later(sendInvoiceEmail, payload, 60 * 60 * 24 * 3)
```

<a name="tasks-and-the-storage-contract"></a>
## Tasks and the Storage Contract

Tasks are one of the few places where writing to external storage services is allowed. The ESLint rule `no-storage-outside-logic` enforces that `storage.put`, `storage.get`, `storage.delete`, and related methods can only be called from files inside `logic/actions/` or `logic/tasks/`.

```ts
// src/modules/Documents/logic/tasks/upload-invoice-pdf.task.ts
import { defineTask } from '@lumiarq/framework'
import type { StorageContract } from '@lumiarq/framework/contracts'

export const uploadInvoicePdf = defineTask(async (payload: { invoiceId: string; pdfBuffer: Buffer }) => {
  const storage = app().make<StorageContract>('storage')

  const path = `invoices/${payload.invoiceId}.pdf`
  await storage.put(path, payload.pdfBuffer, { contentType: 'application/pdf' })

  return { path, url: await storage.url(path) }
})
```

<a name="multiple-tasks-from-one-action"></a>
## Multiple Tasks from One Action

Actions can call multiple tasks. Each task handles one concern:

```ts
export const publishInvoice = defineAction(async (dto: PublishInvoiceDto) => {
  const invoice = await repo.markPublished({ id: dto.invoiceId })

  // Fire each side effect as its own task
  await sendInvoiceEmail({ invoiceId: invoice.id, ... })
  await uploadInvoicePdf({ invoiceId: invoice.id, pdfBuffer: dto.pdfBuffer })
  await logAuditEvent({ entity: 'invoice', entityId: invoice.id, event: 'published' })

  return invoice
})
```

Or, if order does not matter, run them concurrently:

```ts
import { concurrently } from '@lumiarq/framework'

await concurrently(
  sendInvoiceEmail({ invoiceId: invoice.id, ... }),
  uploadInvoicePdf({ invoiceId: invoice.id, pdfBuffer: dto.pdfBuffer }),
  logAuditEvent({ entity: 'invoice', entityId: invoice.id, event: 'published' }),
)
```

<a name="testing-a-task"></a>
## Testing a Task

Because tasks interact with external services (email, storage, queues), unit tests typically stub the external call and assert that the correct arguments were passed.

```ts
// src/modules/Billing/tests/send-invoice-email.test.ts
import { describe, it, expect, vi } from 'vitest'
import { withTestContext } from '@lumiarq/framework'
import { sendInvoiceEmail } from '@modules/Billing/logic/tasks/send-invoice-email.task'

describe('sendInvoiceEmail', () => {
  it(
    'calls mailer with the correct recipient and subject',
    withTestContext({}, async () => {
      const mailerSend = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('mailer', { send: mailerSend })

      await sendInvoiceEmail({
        invoiceId: 'inv_abc',
        recipientEmail: 'customer@example.com',
        recipientName: 'Alice',
        totalFormatted: '$100.00',
        dueDateFormatted: 'April 1, 2026',
      })

      expect(mailerSend).toHaveBeenCalledOnce()
      expect(mailerSend.mock.calls[0][0].to.email).toBe('customer@example.com')
      expect(mailerSend.mock.calls[0][0].subject).toContain('invoice')
    }),
  )
})
```
