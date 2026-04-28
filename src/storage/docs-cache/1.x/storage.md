---
title: File Storage
description: Managing file uploads and downloads with the Storage contract
section: Digging Deeper
order: 11
draft: false
---

# File Storage

## Table of Contents

- [Introduction](#introduction)
- [Configuration](#configuration)
- [Publishing the Config](#publishing-config)
- [StorageContract Interface](#storage-contract)
- [LocalStorage Driver](#local-storage)
- [S3Storage Driver](#s3-storage)
- [Registering Storage](#registering-storage)
- [Handling File Uploads](#file-uploads)
- [Using Storage in Actions](#storage-in-actions)
- [Multiple Disks](#multiple-disks)
- [Generating Public URLs](#generating-public-urls)
- [Security Considerations](#security)
- [Environment Variables Reference](#env-vars)
- [Testing Storage](#testing-storage)

---

<a name="introduction"></a>
## Introduction

Almost every web application needs to store files: user avatars, document uploads, generated reports, media attachments. LumiARQ provides a **unified storage API** that works identically whether you are storing files on the local filesystem during development or in Amazon S3 (or any S3-compatible service) in production.

You write code against the `StorageContract` interface. Swapping from local disk to S3 is a matter of changing configuration, not rewriting application code.

```
Handler → StorageContract → LocalStorage | S3Storage → Disk | S3
```

---

<a name="configuration"></a>
## Configuration

Storage is configured in `config/storage.ts`. This file defines one or more **disks** — named storage backends with their own drivers and settings.

```typescript
// config/storage.ts
import type { StorageConfig } from '@lumiarq/framework'
import { env } from '@lumiarq/framework'

export default {
  // The default disk used when no disk name is specified
  default: env('STORAGE_DISK', 'local'),

  disks: {
    local: {
      driver: 'local',
      // Relative to the project root
      root: 'storage/app',
      // URL prefix for public files (served via your HTTP server)
      publicUrl: env('APP_URL', 'http://localhost:3000') + '/storage',
    },

    s3: {
      driver:   's3',
      bucket:   env('AWS_BUCKET'),
      region:   env('AWS_REGION', 'us-east-1'),
      endpoint: env('AWS_ENDPOINT'),            // For S3-compatible services (MinIO, R2, etc.)
      accessKeyId:     env('AWS_ACCESS_KEY_ID'),
      secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
      // Optional: force path-style URLs (required for MinIO)
      forcePathStyle: env('AWS_FORCE_PATH_STYLE', 'false') === 'true',
      // ACL for uploaded objects (set 'public-read' if you serve files publicly)
      acl: env('AWS_ACL', 'private'),
    },
  },
} satisfies StorageConfig
```

---

<a name="publishing-config"></a>
## Publishing the Config

Generate the storage config stub with:

```bash
lumis publish config storage
```

This creates `config/storage.ts` with sensible defaults pre-filled. You can also publish all config files at once:

```bash
lumis publish config all
```

---

<a name="storage-contract"></a>
## StorageContract Interface

All storage drivers implement `StorageContract`. Import it from `@lumiarq/framework` for type annotations:

```typescript
import type { StorageContract } from '@lumiarq/framework'
```

### Method Reference

```typescript
interface StorageContract {
  /**
   * Write content to a path.
   * @param path    Storage path, e.g. "avatars/user-123.jpg"
   * @param content File content as Buffer, string, or ReadableStream
   * @param options Optional metadata (mimeType, visibility)
   */
  put(path: string, content: Buffer | string | ReadableStream, options?: PutOptions): Promise<void>

  /**
   * Read a file. Returns null if the file does not exist.
   */
  get(path: string): Promise<Buffer | null>

  /**
   * Delete a file. Does not throw if the file does not exist.
   */
  delete(path: string): Promise<void>

  /**
   * Check whether a file exists at the given path.
   */
  exists(path: string): Promise<boolean>

  /**
   * Get the permanent public URL for a file.
   * Only meaningful for publicly accessible files.
   */
  url(path: string): string

  /**
   * Generate a time-limited presigned URL.
   * @param path      Storage path
   * @param expiresIn Expiry duration in seconds (default: 3600)
   */
  temporaryUrl(path: string, expiresIn?: number): Promise<string>
}
```

```typescript
interface PutOptions {
  /** MIME type, e.g. 'image/jpeg' (auto-detected if omitted) */
  mimeType?: string

  /** Access visibility — 'public' or 'private' (default: 'private') */
  visibility?: 'public' | 'private'

  /** Additional metadata key/value pairs stored alongside the object */
  metadata?: Record<string, string>
}
```

---

<a name="local-storage"></a>
## LocalStorage Driver

`LocalStorage` stores files in a directory on the local filesystem. It is the default driver for development.

### Storage Location

Files are stored relative to the project root at the path specified by `root` in your disk config (default: `storage/app`). The directory is created automatically if it does not exist.

```
project-root/
  storage/
    app/
      avatars/
        user-abc.jpg
      documents/
        invoice-001.pdf
```

### `url()` for Local Files

`url(path)` returns a URL by concatenating `publicUrl` with the path:

```typescript
storage.url('avatars/user-abc.jpg')
// → "http://localhost:3000/storage/avatars/user-abc.jpg"
```

For this URL to work, you must serve the `storage/app` directory as a static route. In your router:

```typescript
// bootstrap/router.ts
import { serveStatic } from '@lumiarq/framework/core'

Route.static('/storage', 'storage/app')
```

### `temporaryUrl()` for Local Files

`LocalStorage` generates a signed URL containing an HMAC-based expiry token:

```typescript
const url = await storage.temporaryUrl('documents/invoice-001.pdf', 3600)
// → "http://localhost:3000/storage/documents/invoice-001.pdf?token=...&expires=..."
```

Your HTTP server validates the token before serving the file.

---

<a name="s3-storage"></a>
## S3Storage Driver

`S3Storage` wraps `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. It works with:

- **Amazon S3**
- **Cloudflare R2** (set `endpoint` to your R2 endpoint)
- **MinIO** (set `endpoint` and `forcePathStyle: true`)
- **DigitalOcean Spaces**
- Any S3-compatible service

### `put()`

Uploads a file to the configured bucket:

```typescript
await storage.put('avatars/user-abc.jpg', imageBuffer, {
  mimeType:   'image/jpeg',
  visibility: 'public',
})
```

### `url()`

Returns a permanent CDN or public URL for publicly accessible objects:

```typescript
storage.url('avatars/user-abc.jpg')
// → "https://my-bucket.s3.us-east-1.amazonaws.com/avatars/user-abc.jpg"
```

If you have a custom CDN domain, set it in config:

```typescript
// config/storage.ts
s3: {
  driver: 's3',
  // ...
  cdnUrl: env('CDN_URL'), // e.g. "https://cdn.example.com"
}
```

### `temporaryUrl()`

Generates an AWS presigned URL valid for the specified number of seconds:

```typescript
const url = await storage.temporaryUrl('documents/invoice-001.pdf', 900)
// → "https://my-bucket.s3.us-east-1.amazonaws.com/documents/invoice-001.pdf?X-Amz-Expires=900&..."
```

Use presigned URLs for private files that should be temporarily accessible to specific users.

---

<a name="registering-storage"></a>
## Registering Storage

Instantiate and export a storage instance from `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { LocalStorage, S3Storage } from '@lumiarq/framework/runtime'
import storageConfig               from '#config/storage.js'
import { env }                     from '@lumiarq/framework'

function createStorage(diskName?: string) {
  const name   = diskName ?? storageConfig.default
  const config = storageConfig.disks[name]

  if (!config) throw new Error(`Unknown storage disk: "${name}"`)

  switch (config.driver) {
    case 'local':
      return new LocalStorage({
        root:      config.root,
        publicUrl: config.publicUrl,
      })
    case 's3':
      return new S3Storage({
        bucket:          config.bucket,
        region:          config.region,
        endpoint:        config.endpoint,
        accessKeyId:     config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        forcePathStyle:  config.forcePathStyle,
        acl:             config.acl,
        cdnUrl:          config.cdnUrl,
      })
    default:
      throw new Error(`Unknown storage driver: "${(config as any).driver}"`)
  }
}

export const storage = createStorage()
```

---

<a name="file-uploads"></a>
## Handling File Uploads

Parse multipart form data from the request using the Web API `formData()` method, then pass the file content to `storage.put()`:

```typescript
// src/modules/Users/handlers/uploadAvatar.ts
import { defineHandler }    from '@lumiarq/framework/core'
import { BadRequestError }  from '@lumiarq/framework/runtime'
import { storage }          from '#bootstrap/providers.js'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

export const uploadAvatar = defineHandler(async (ctx) => {
  const userId  = ctx.state.userId as string
  const data    = await ctx.request.formData()
  const file    = data.get('avatar') as File | null

  if (!file) {
    throw new BadRequestError('No file provided')
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new BadRequestError(
      `Invalid file type "${file.type}". Allowed: ${ALLOWED_TYPES.join(', ')}`
    )
  }

  if (file.size > MAX_SIZE_BYTES) {
    throw new BadRequestError('File must be under 5 MB')
  }

  const ext      = file.type.split('/')[1]
  const path     = `avatars/${userId}.${ext}`
  const buffer   = Buffer.from(await file.arrayBuffer())

  await storage.put(path, buffer, {
    mimeType:   file.type,
    visibility: 'public',
  })

  const url = storage.url(path)

  // Save the URL to the user's record
  await db.update(users)
    .set({ avatarUrl: url })
    .where(eq(users.id, userId))

  return ctx.json({ avatarUrl: url })
})
```

---

<a name="storage-in-actions"></a>
## Using Storage in Actions

Inject the storage instance into action functions as a dependency so they remain testable:

```typescript
// src/modules/Reports/actions/storeReport.ts
import type { StorageContract } from '@lumiarq/framework'

interface StoreReportDeps {
  storage: StorageContract
}

export async function storeReport(
  reportId: string,
  content:  Buffer,
  deps:     StoreReportDeps
): Promise<string> {
  const path = `reports/${reportId}.pdf`

  await deps.storage.put(path, content, {
    mimeType:   'application/pdf',
    visibility: 'private',
  })

  return path
}
```

```typescript
// src/modules/Reports/handlers/generateReport.ts
import { storage } from '#bootstrap/providers.js'
import { storeReport } from '../actions/storeReport.js'

export const generateReport = defineHandler(async (ctx) => {
  const { reportId } = ctx.params
  const pdf = await buildPdf(reportId)

  const path = await storeReport(reportId, pdf, { storage })
  const url  = await storage.temporaryUrl(path, 3600)

  return ctx.json({ downloadUrl: url })
})
```

---

<a name="multiple-disks"></a>
## Multiple Disks

Access a non-default disk by calling `createStorage(diskName)`:

```typescript
// bootstrap/providers.ts
export const storage      = createStorage()          // default disk
export const publicDisk   = createStorage('local')   // always local
export const archiveDisk  = createStorage('s3')      // always S3
```

Or resolve disks dynamically:

```typescript
import { createStorage } from '#bootstrap/providers.js'

const disk = createStorage(env('ATTACHMENT_DISK', 'local'))
await disk.put('attachments/file.pdf', buffer)
```

---

<a name="generating-public-urls"></a>
## Generating Public URLs

For **publicly accessible** files (uploaded with `visibility: 'public'`), use `storage.url()` to get a permanent URL you can store in the database and embed directly in API responses:

```typescript
// After upload
const path = `avatars/${userId}.jpg`
await storage.put(path, buffer, { visibility: 'public' })
const url  = storage.url(path)  // permanent, embeddable

await db.update(users).set({ avatarUrl: url }).where(eq(users.id, userId))
```

For **private** files (the default), generate a temporary URL on demand:

```typescript
export const getInvoice = defineHandler(async (ctx) => {
  const invoice = await findInvoiceById(ctx.params.id)
  if (!invoice) throw new NotFoundError('Invoice not found')

  // Generate a URL valid for 15 minutes
  const url = await storage.temporaryUrl(invoice.storagePath, 900)

  return ctx.json({ downloadUrl: url, expiresIn: 900 })
})
```

---

<a name="security"></a>
## Security Considerations

### Never Expose Raw S3 Credentials

Your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` must never appear in:

- API responses
- Client-side code
- Version control (commit them to `.env`, not `config/storage.ts`)

### Use Presigned URLs for Private Files

Private files should only be accessible via presigned URLs with the shortest practical TTL:

```typescript
// Good: 15-minute window for a download link
const url = await storage.temporaryUrl(path, 900)

// Avoid: long-lived URLs are indistinguishable from permanent public URLs
const url = await storage.temporaryUrl(path, 86_400 * 30) // 30 days — too long
```

### Validate File Types on Upload

Never trust the `Content-Type` header alone — validate using the file's magic bytes when security is important:

```typescript
import { fileTypeFromBuffer } from 'file-type'

const detected = await fileTypeFromBuffer(buffer)
if (!detected || !ALLOWED_TYPES.includes(detected.mime)) {
  throw new BadRequestError('Invalid file type')
}
```

### Limit Upload Size

Enforce file size limits both in your handler and at the infrastructure layer (nginx `client_max_body_size`, load balancer limits).

---

<a name="env-vars"></a>
## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `STORAGE_DISK` | No | Default disk name (default: `local`) |
| `APP_URL` | For local | Used to construct `publicUrl` for local disk |
| `AWS_BUCKET` | For S3 | S3 bucket name |
| `AWS_REGION` | For S3 | AWS region (default: `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | For S3 | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | For S3 | IAM secret key |
| `AWS_ENDPOINT` | For S3-compat | Custom endpoint (MinIO, R2, Spaces) |
| `AWS_FORCE_PATH_STYLE` | For MinIO | Set `true` for MinIO deployments |
| `AWS_ACL` | No | S3 object ACL (default: `private`) |
| `CDN_URL` | No | CDN base URL — used by `storage.url()` on S3 disk |

---

<a name="testing-storage"></a>
## Testing Storage

In tests, use `LocalStorage` pointed at a temporary directory inside the project so tests do not hit S3 and do not interfere with your development `storage/app` folder.

```typescript
// tests/helpers/testStorage.ts
import { LocalStorage } from '@lumiarq/framework/runtime'
import path             from 'node:path'
import fs               from 'node:fs/promises'

const TEST_STORAGE_ROOT = path.resolve('storage/test')

export function createTestStorage(): LocalStorage {
  return new LocalStorage({
    root:      TEST_STORAGE_ROOT,
    publicUrl: 'http://localhost/storage/test',
  })
}

export async function cleanTestStorage(): Promise<void> {
  await fs.rm(TEST_STORAGE_ROOT, { recursive: true, force: true })
}
```

```typescript
// tests/modules/Reports/storeReport.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { storeReport }       from '#modules/Reports/actions/storeReport'
import { createTestStorage, cleanTestStorage } from '#tests/helpers/testStorage'

afterEach(cleanTestStorage)

describe('storeReport', () => {
  it('stores a PDF and returns the storage path', async () => {
    const storage = createTestStorage()
    const content = Buffer.from('%PDF-1.4 test content')

    const path = await storeReport('report-xyz', content, { storage })

    expect(path).toBe('reports/report-xyz.pdf')
    expect(await storage.exists(path)).toBe(true)

    const stored = await storage.get(path)
    expect(stored?.toString()).toContain('%PDF')
  })
})
```

### Asserting Uploads with a Fake Disk

For faster tests that don't touch the filesystem at all:

```typescript
import { FakeStorage } from '@lumiarq/framework/testing'

it('uploads an avatar and saves the URL', async () => {
  const storage = new FakeStorage()

  await withTestContext({ method: 'POST', state: { storage } }, (ctx) =>
    uploadAvatar(ctx)
  )

  storage.assertPut('avatars/user-123.jpg')
  storage.assertVisibility('avatars/user-123.jpg', 'public')
})
```

`FakeStorage` implements `StorageContract` entirely in memory and exposes:

| Method | Description |
|--------|-------------|
| `assertPut(path)` | Assert a file was written at path |
| `assertDeleted(path)` | Assert a file was deleted |
| `assertNotPut(path)` | Assert no file was written at path |
| `assertVisibility(path, v)` | Assert a file was stored with given visibility |
| `storedFiles()` | Returns a map of all stored paths → content |
