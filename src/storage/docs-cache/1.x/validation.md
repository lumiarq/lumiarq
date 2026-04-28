---
title: Validation
description: Validating input data with Zod schemas
section: The Basics
order: 11
draft: false
---

# Validation

- [Introduction](#introduction)
- [Defining a DTO Schema](#defining-a-dto-schema)
- [Parsing in a Handler](#parsing-in-a-handler)
- [Common Validation Patterns](#common-validation-patterns)
- [Custom Refinements](#custom-refinements)
- [BaseResetPasswordValidator](#baseresetpasswordvalidator)
- [Scaffolding a Validator](#scaffolding-a-validator)
- [Reusing Schemas Across Layers](#reusing-schemas-across-layers)
- [Validating Query Parameters](#validating-query-parameters)
- [Conditional Validation](#conditional-validation)
- [Displaying Errors in Web Forms](#displaying-errors-in-web-forms)
- [Testing Validation](#testing-validation)

<a name="introduction"></a>
## Introduction

Lumiarq uses [Zod](https://zod.dev/) for all input validation. Zod schemas are plain TypeScript values — they are composable, reusable across layers, and produce typed output that TypeScript understands without any extra casting.

<a name="defining-a-dto-schema"></a>
## Defining a DTO Schema

A DTO (Data Transfer Object) schema lives in a module's `contracts/dto/` directory and describes the shape of incoming data:

```typescript
// src/modules/Billing/contracts/dto/create-invoice.dto.ts
import { z } from 'zod'

const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required').max(255),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive('Unit price must be greater than zero'),
})

export const createInvoiceSchema = z.object({
  customerId: z.string().uuid('Customer ID must be a valid UUID'),
  currency: z.enum(['USD', 'EUR', 'GBP']).default('USD'),
  dueDate: z.string().datetime({ message: 'Due date must be an ISO 8601 datetime' }),
  notes: z.string().max(1000).optional(),
  lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),
})

// Infer the TypeScript type from the schema
export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>
```

<a name="parsing-in-a-handler"></a>
## Parsing in a Handler

Call `schema.parse(data)` in a handler to validate incoming request data. `parse` throws a `ZodError` when validation fails:

```typescript
// src/modules/Billing/http/handlers/create-invoice.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { ZodError } from 'zod'
import { createInvoiceSchema } from '@modules/Billing/contracts/dto/create-invoice.dto'
import { CreateInvoiceAction } from '@modules/Billing/logic/actions/create-invoice.action'

export const CreateInvoiceHandler = defineHandler(async (ctx) => {
  let dto

  try {
    dto = createInvoiceSchema.parse(await ctx.req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return ctx.json(
        {
          message: 'Validation failed',
          errors: error.flatten().fieldErrors,
        },
        422
      )
    }
    throw error
  }

  const invoice = await CreateInvoiceAction(dto)

  return ctx.json({ data: invoice }, 201)
})
```

`error.flatten().fieldErrors` produces an object keyed by field name where each value is an array of error messages — the format most frontend validation libraries expect:

```json
{
  "message": "Validation failed",
  "errors": {
    "customerId": ["Customer ID must be a valid UUID"],
    "lineItems": ["At least one line item is required"]
  }
}
```

### Using safeParse for Conditional Flows

When you want to branch on validation result without a try/catch, use `safeParse`:

```typescript
const result = createInvoiceSchema.safeParse(await ctx.req.json())

if (!result.success) {
  return ctx.json({ errors: result.error.flatten().fieldErrors }, 422)
}

const invoice = await CreateInvoiceAction(result.data)
```

<a name="common-validation-patterns"></a>
## Common Validation Patterns

```typescript
import { z } from 'zod'

const exampleSchema = z.object({
  // Basic types
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
  active: z.boolean(),

  // Optional fields (can be undefined)
  bio: z.string().max(500).optional(),

  // Nullable fields (can be null)
  avatarUrl: z.string().url().nullable(),

  // Field with a default value
  role: z.enum(['user', 'admin', 'moderator']).default('user'),

  // UUID
  referrerId: z.string().uuid().optional(),

  // Coerce string → number (useful for query params)
  page: z.coerce.number().int().positive().default(1),

  // Array with constraints
  tags: z.array(z.string().max(50)).max(10).default([]),

  // Nested object
  address: z.object({
    street: z.string(),
    city: z.string(),
    postcode: z.string().regex(/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i, 'Invalid UK postcode'),
  }).optional(),
})
```

<a name="custom-refinements"></a>
## Custom Refinements

Use `.refine()` to add cross-field validation logic:

```typescript
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12, 'Password must be at least 12 characters'),
    confirmPassword: z.string(),
  })
  .refine(
    (data) => data.newPassword === data.confirmPassword,
    {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }
  )
  .refine(
    (data) => data.currentPassword !== data.newPassword,
    {
      message: 'New password must differ from current password',
      path: ['newPassword'],
    }
  )
```

<a name="baseresetpasswordvalidator"></a>
## BaseResetPasswordValidator

For authentication-related forms, the `BaseResetPasswordValidator` from `@lumiarq/framework/auth` provides a ready-made reset-password schema that you can extend:

```typescript
import { BaseResetPasswordValidator } from '@lumiarq/framework/auth'
import { z } from 'zod'

// BaseResetPasswordValidator already validates:
//   token:                 z.string().min(1)
//   email:                 z.string().email()
//   password:              z.string().min(12)
//   password_confirmation: z.string()
//   + .refine() check that password === password_confirmation

// Extend it with application-specific requirements
export const resetPasswordSchema = BaseResetPasswordValidator.extend({
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>
```

<a name="scaffolding-a-validator"></a>
## Scaffolding a Validator

The CLI generates a validator file with a sensible stub:

```bash
lumis make:validator Billing CreateInvoice
```

This creates `src/modules/Billing/logic/validators/create-invoice.validator.ts`:

```typescript
import { z } from 'zod'

export const createInvoiceSchema = z.object({
  // TODO: define fields
})

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>
```

<a name="reusing-schemas-across-layers"></a>
## Reusing Schemas Across Layers

Define schemas once in the DTO directory and import them in both the handler (for request parsing) and the action/task (for internal validation of programmatically constructed objects):

```typescript
// In the handler — validate untrusted HTTP input
dto = createInvoiceSchema.parse(await ctx.req.json())

// In a test — construct a valid DTO programmatically
const dto = createInvoiceSchema.parse({
  customerId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 5000 }],
  dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
})
```

<a name="validating-query-parameters"></a>
## Validating Query Parameters

Query parameters arrive as strings. Use `z.coerce` to convert them automatically:

```typescript
const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'paid', 'overdue']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

// In a handler
const params = listInvoicesQuerySchema.parse(
  Object.fromEntries(new URL(ctx.req.url).searchParams)
)
```

<a name="conditional-validation"></a>
## Conditional Validation

Use `z.discriminatedUnion` when the schema shape depends on a known discriminant field. This is more efficient and produces better error messages than `.union()`:

```typescript
// Payment method determines which fields are required
const paymentMethodSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('card'),
    cardNumber:  z.string().regex(/^\d{16}$/, 'Card number must be 16 digits'),
    expiryMonth: z.number().int().min(1).max(12),
    expiryYear:  z.number().int().min(new Date().getFullYear()),
    cvc:         z.string().regex(/^\d{3,4}$/, 'CVC must be 3 or 4 digits'),
  }),
  z.object({
    type:      z.literal('bank_transfer'),
    sortCode:  z.string().regex(/^\d{2}-\d{2}-\d{2}$/, 'Invalid sort code'),
    accountNo: z.string().regex(/^\d{8}$/, 'Account number must be 8 digits'),
  }),
  z.object({
    type:      z.literal('paypal'),
    paypalEmail: z.string().email('Must be a valid PayPal email address'),
  }),
])
```

For rules that span multiple fields, `.superRefine()` gives you full control and allows attaching errors to any path:

```typescript
const bookingSchema = z
  .object({
    checkIn:  z.string().datetime(),
    checkOut: z.string().datetime(),
    adults:   z.number().int().min(1),
    children: z.number().int().min(0),
    roomType: z.enum(['single', 'double', 'suite']),
  })
  .superRefine((data, ctx) => {
    const checkIn  = new Date(data.checkIn)
    const checkOut = new Date(data.checkOut)

    if (checkOut <= checkIn) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        message: 'Check-out must be after check-in',
        path:    ['checkOut'],
      })
    }

    const guests = data.adults + data.children
    if (data.roomType === 'single' && guests > 2) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        message: 'Single rooms accommodate a maximum of 2 guests',
        path:    ['roomType'],
      })
    }
  })
```

<a name="displaying-errors-in-web-forms"></a>
## Displaying Errors in Web Forms

For server-rendered forms, validate with `safeParse`, then pass the flattened errors back to your template on failure. This lets the form re-render with field-level error messages without a client-side validation library.

**Handler — capture and redisplay errors:**

```typescript
// src/modules/Billing/http/handlers/create-invoice.handler.ts
import { defineHandler } from '@lumiarq/framework'
import { createInvoiceSchema }  from '@modules/Billing/contracts/dto/create-invoice.dto'
import { renderCreateInvoicePage } from '@modules/Billing/ui/web/pages/create-invoice.page'

export const createInvoiceHandler = defineHandler(async (ctx) => {
  const formData = await ctx.req.parseBody()         // parse multipart/form-data or URLencoded
  const result   = createInvoiceSchema.safeParse(formData)

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors // { fieldName: string[] }
    const html   = renderCreateInvoicePage({ errors, formData })
    return ctx.html(html, 422)
  }

  await createInvoice(result.data)
  return ctx.redirect('/billing/invoices', 303)
})
```

**Template — display per-field errors (Veil example):**

```html
@vars({ errors: Record<string, string[]>, formData: Record<string, string> })

<form method="POST" action="/billing/invoices">
  <div class="field">
    <label for="customerId">Customer</label>
    <input
      id="customerId"
      name="customerId"
      value="{{ formData.customerId ?? '' }}"
      class="{{ errors.customerId ? 'input-error' : '' }}"
    />
    @if(errors.customerId)
      <p class="error-message">{{ errors.customerId[0] }}</p>
    @endif
  </div>

  <div class="field">
    <label for="dueDate">Due Date</label>
    <input
      type="datetime-local"
      id="dueDate"
      name="dueDate"
      value="{{ formData.dueDate ?? '' }}"
    />
    @if(errors.dueDate)
      <p class="error-message">{{ errors.dueDate[0] }}</p>
    @endif
  </div>

  <button type="submit">Create Invoice</button>
</form>
```

<a name="testing-validation"></a>
## Testing Validation

Test DTO schemas in isolation — you don't need a full HTTP request to verify that your schema rejects bad data or accepts good data:

```typescript
import { describe, it, expect } from 'vitest'
import { createInvoiceSchema } from '@modules/Billing/contracts/dto/create-invoice.dto'

describe('createInvoiceSchema', () => {
  const validDto = {
    customerId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    lineItems:  [{ description: 'Consulting', quantity: 1, unitPrice: 5000 }],
    dueDate:    new Date(Date.now() + 86_400_000).toISOString(),
  }

  it('accepts a valid payload', () => {
    const result = createInvoiceSchema.safeParse(validDto)
    expect(result.success).toBe(true)
  })

  it('rejects an invalid customerId', () => {
    const result = createInvoiceSchema.safeParse({ ...validDto, customerId: 'not-a-uuid' })
    expect(result.success).toBe(false)
    const errors = result.error!.flatten().fieldErrors
    expect(errors.customerId).toContain('Customer ID must be a valid UUID')
  })

  it('rejects an empty lineItems array', () => {
    const result = createInvoiceSchema.safeParse({ ...validDto, lineItems: [] })
    expect(result.success).toBe(false)
    const errors = result.error!.flatten().fieldErrors
    expect(errors.lineItems).toBeDefined()
  })

  it('applies the USD currency default', () => {
    const result = createInvoiceSchema.safeParse(validDto)
    expect(result.success && result.data.currency).toBe('USD')
  })
})
```

---

**Next:** Learn about client-side interactivity with [UI](/docs/ui).
