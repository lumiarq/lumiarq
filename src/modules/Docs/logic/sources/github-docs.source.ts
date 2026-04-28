/**
 * GitHubDocsSource — Fetches versioned documentation markdown files from a
 * GitHub repository and caches them to the local filesystem so that
 * `defineContentLoader` (the framework's built-in markdown engine) can
 * parse, highlight, and TOC-extract them without any extra dependencies.
 *
 * Fetch flow per request:
 *   1. Check if a local cached copy exists (storage/docs-cache/{version}/{slug}.md).
 *   2. Hit GitHub raw content API if the file is missing or stale (> TTL).
 *   3. Write the downloaded bytes to the cache dir.
 *
 * `defineContentLoader` is then pointed at the cache dir; it handles
 *   gray-matter frontmatter parsing, marked rendering, highlight.js
 *   syntax colouring, TOC extraction, and reading-time estimation — all
 *   built into @lumiarq/framework out of the box.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { defineContentLoader } from "@lumiarq/framework"
import { z } from "zod"
import { env } from "@/bootstrap/env"
import type { DocFrontmatter } from "@/modules/Docs/contracts/types/docs.types"

// ── Config ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1_000 // 5 minutes — refetch from GitHub after this
const CACHE_ROOT = resolve(process.cwd(), "src/storage/docs-cache")
const RAW_BASE = "https://raw.githubusercontent.com"

// The docs manifest lives at the root of the docs repo as `docs.json`.
// It lists every published page with title, section, order, description, and draft.
// Shape: Array<{ slug, title, description?, section?, order, draft }>
const MANIFEST_FILENAME = "docs.json"

// ── GitHub fetch helpers ───────────────────────────────────────────────────────

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.raw+json" }
  if (env.DOCS_GITHUB_TOKEN) headers["Authorization"] = `Bearer ${env.DOCS_GITHUB_TOKEN}`
  return headers
}

function rawUrl(version: string, path: string): string {
  return `${RAW_BASE}/${env.DOCS_GITHUB_OWNER}/${env.DOCS_GITHUB_REPO}/${version}/${path}`
}

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function cacheDir(version: string): string {
  const dir = join(CACHE_ROOT, version)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function cacheFile(version: string, filename: string): string {
  return join(cacheDir(version), filename)
}

function isFresh(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  return Date.now() - statSync(filePath).mtimeMs < CACHE_TTL_MS
}

async function ensureCached(version: string, filename: string): Promise<boolean> {
  const dest = cacheFile(version, filename)
  if (isFresh(dest)) return true

  const content = await fetchRaw(rawUrl(version, filename))
  if (!content) return existsSync(dest) // serve stale if GitHub is unreachable

  writeFileSync(dest, content, "utf8")
  return true
}

// ── Per-version Manifest (docs.json) ─────────────────────────────────────────

export interface DocsManifestEntry {
  slug: string
  title: string
  description?: string
  section?: string
  order: number
  draft: boolean
}

const manifestCache = new Map<string, { entries: DocsManifestEntry[]; ts: number }>()

export async function getManifest(version: string): Promise<DocsManifestEntry[]> {
  const hit = manifestCache.get(version)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.entries

  await ensureCached(version, MANIFEST_FILENAME)

  const filePath = cacheFile(version, MANIFEST_FILENAME)
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, "utf8")
    const entries = JSON.parse(raw) as DocsManifestEntry[]
    manifestCache.set(version, { entries, ts: Date.now() })
    return entries
  } catch {
    return []
  }
}

// ── Frontmatter schema (mirrors DocFrontmatter from docs.types.ts) ────────────

const DocsFrontmatterSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  section: z.string().optional(),
  order: z.number().default(0),
  draft: z.boolean().default(false),
})

// ── Per-version ContentLoader (uses framework's markdown engine) ──────────────

const loaderCache = new Map<string, ReturnType<typeof defineContentLoader<typeof DocsFrontmatterSchema>>>()

export function getDocsLoader(version: string) {
  if (loaderCache.has(version)) return loaderCache.get(version)!

  const loader = defineContentLoader({
    directory: join("src/storage/docs-cache", version),
    schema: DocsFrontmatterSchema,
    highlight: true,
  })
  loaderCache.set(version, loader)
  return loader
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensures the requested slug is cached locally, then returns the parsed page.
 * Returns null if the page cannot be found on GitHub or in the local cache.
 */
export async function getDocPage(version: string, slug: string) {
  const filename = slug === "index" ? "index.md" : `${slug}.md`
  const ok = await ensureCached(version, filename)
  if (!ok) return null

  const loader = getDocsLoader(version)
  const page = await loader.get(slug)
  if (!page || page.frontmatter.draft) return null
  return page
}

/**
 * Returns all non-draft pages for the given version.
 * Warms the cache for every slug in the manifest.
 */
export async function getAllDocPages(version: string) {
  const entries = await getManifest(version)

  // Warm the cache concurrently (don't fail if some are missing)
  await Promise.allSettled(
    entries.filter((e) => !e.draft).map((e) => ensureCached(version, e.slug === "index" ? "index.md" : `${e.slug}.md`)),
  )

  const loader = getDocsLoader(version)
  const pages = await loader.all()
  return pages.filter((p) => !p.frontmatter.draft)
}

// ── Version helpers ───────────────────────────────────────────────────────────

/** All published version strings in order (first = default). */
export function getVersions(): string[] {
  return env.DOCS_VERSIONS.split(",")
    .map((v) => v.trim())
    .filter(Boolean)
}

/** The default (latest) version. */
export function getDefaultVersion(): string {
  return getVersions()[0] ?? "1.x"
}
