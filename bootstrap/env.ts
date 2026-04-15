/**
 * Environment validation. Zod schema, validates + exports env + publicEnv objects.
 * Access process.env only in this file. All other files should import from here.
 * Exits the process with a clear error if any required variable is missing.
 */

import { z } from "zod"

const schema = z.object({
  /* ─── Toolchain ────────────────────────────────────────────────────────────
   * Read by Vite/bundlers/Jest only. Never read in application code.
   */
  NODE_ENV: z.enum(["development", "test", "production", "local", "staging"]).default("development"),

  /* ─── Application identity ─────────────────────────────────────────────────
   * Read only via app() helper or publicEnv. Never via process.env in app code.
   */
  APP_ENV: z.enum(["local", "testing", "staging", "production"]).default("local"),
  APP_NAME: z.string().min(1).default("LumiARQ App"),
  APP_URL: z.string().url(),

  /* ─── Database ─────────────────────────────────────────────────────────────
   * Database configuration.
   */
  DB_CONNECTION: z.enum(["sqlite", "postgres"]).default("sqlite"),
  DATABASE_URL: z.string().min(1),

  // Optional — only required when DB_CONNECTION = 'postgres'
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().optional(),
  DB_DATABASE: z.string().optional(),
  DB_USERNAME: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_READ_HOST: z.string().optional(),

  /* ─── Auth / JWT ───────────────────────────────────────────────────────────
   * Authentication and JWT configuration.
   */
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(64),

  /* ─── Mail ─────────────────────────────────────────────────────────────────
   * Mail configuration.
   */
  MAIL_DRIVER: z.string().default("stub"),
  MAIL_FROM_ADDRESS: z.string().email().optional(),
  MAIL_FROM_NAME: z.string().optional(),

  /* ─── Queue ────────────────────────────────────────────────────────────────
   * Queue configuration.
   */
  QUEUE_DRIVER: z.string().default("stub"),

  /* ─── Storage ──────────────────────────────────────────────────────────────
   * Storage configuration.
   */
  STORAGE_DRIVER: z.string().default("local"),

  /* ─── Session ──────────────────────────────────────────────────────────────
   * Session configuration.
   */
  SESSION_DRIVER: z.enum(["database", "memory"]).default("database"),

  /* ─── Cache ────────────────────────────────────────────────────────────────
   * Cache configuration.
   */
  CACHE_DRIVER: z.string().default("memory"),

  /* ─── External services ────────────────────────────────────────────────────
   * GitHub repository that hosts the versioned documentation markdown files.
   * Docs are fetched from: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{slug}.md
   */
  DOCS_GITHUB_OWNER: z.string().default("lumiarq"),
  DOCS_GITHUB_REPO: z.string().default("docs"),
  /* Comma-separated list of published versions, first = default.  e.g. "1.x,master" */
  DOCS_VERSIONS: z.string().default("1.x"),
  /* Optional GitHub token for higher API rate limits (unauthenticated = 60 req/hr) */
  DOCS_GITHUB_TOKEN: z.string().optional(),

  /* ─── Port ─────────────────────────────────────────────────────────────────
   * Application port.
   */
  PORT: z.coerce.number().default(3000),
})

/* Validate — exit immediately on failure before any application code runs */
const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
  console.error(`\nEnvironment validation failed:\n${issues}\n`)
  process.exit(1)
}

/* Typed environment — import this everywhere instead of process.env */
export const env = parsed.data

/* Public environment — safe to serialise into the client bundle
 * Contains no secrets. APP_ENV tells the UI which environment it is in. */
export const publicEnv = {
  APP_NAME: env.APP_NAME,
  APP_URL: env.APP_URL,
  APP_ENV: env.APP_ENV,
} as const

export type PublicEnv = typeof publicEnv
