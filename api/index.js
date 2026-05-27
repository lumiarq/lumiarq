// bootstrap/entry.ts
import { boot } from "@lumiarq/framework";
import { handleIgnitionError } from "@trazze/ignite";

// bootstrap/env.ts
import { z } from "zod";
var schema = z.object({
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
  PORT: z.coerce.number().default(3e3)
});
var parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`
Environment validation failed:
${issues}
`);
  process.exit(1);
}
var env = parsed.data;
var publicEnv = {
  APP_NAME: env.APP_NAME,
  APP_URL: env.APP_URL,
  APP_ENV: env.APP_ENV
};

// bootstrap/providers.ts
import { app } from "@lumiarq/framework";
import { StubMailer, StubQueue, StubStorage, StubCache, StubAudit, RequestLogger } from "@lumiarq/framework/runtime";

// src/config/logging.ts
var logging_default = {
  level: env.APP_ENV === "production" ? "error" : "debug",
  prettify: env.APP_ENV === "local",
  channels: {
    console: { driver: "console" },
    file: { driver: "file", path: "src/storage/logs/lumiarq.log" }
  },
  default: env.APP_ENV === "production" ? "file" : "console"
};

// src/config/storage.ts
import { join } from "path";
var storage_default = {
  driver: env.STORAGE_DRIVER ?? "local",
  default: "local",
  disks: {
    local: {
      driver: "local",
      root: join(process.cwd(), "storage/app")
    },
    public: {
      driver: "local",
      root: join(process.cwd(), "public/storage"),
      visibility: "public"
    }
  }
};

// bootstrap/providers.ts
var logger = new RequestLogger({
  level: logging_default.level,
  prettify: logging_default.prettify
});
var mailer = new StubMailer({ logger });
var queue = new StubQueue({ logger });
var storage = new StubStorage({
  root: storage_default.disks.local.root,
  logger
});
var cache = new StubCache();
var audit = new StubAudit({
  verbose: app().isLocal()
});

// src/modules/Docs/http/routes/docs.api.ts
import { Route } from "@lumiarq/framework";

// src/modules/Docs/http/handlers/docs-api.handler.ts
import { defineHandler } from "@lumiarq/framework";

// src/modules/Docs/logic/sources/github-docs.source.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join as join2, resolve } from "node:path";
import { defineContentLoader } from "@lumiarq/framework";
import { z as z2 } from "zod";
var CACHE_TTL_MS = 5 * 60 * 1e3;
var CACHE_ROOT = resolve(process.cwd(), "src/storage/docs-cache");
var RAW_BASE = "https://raw.githubusercontent.com";
var MANIFEST_FILENAME = "docs.json";
function githubHeaders() {
  const headers = { Accept: "application/vnd.github.raw+json" };
  if (env.DOCS_GITHUB_TOKEN) headers["Authorization"] = `Bearer ${env.DOCS_GITHUB_TOKEN}`;
  return headers;
}
function rawUrl(version, path) {
  return `${RAW_BASE}/${env.DOCS_GITHUB_OWNER}/${env.DOCS_GITHUB_REPO}/${version}/${path}`;
}
async function fetchRaw(url3) {
  try {
    const res = await fetch(url3, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
function cacheDir(version) {
  const dir = join2(CACHE_ROOT, version);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function cacheFile(version, filename) {
  return join2(cacheDir(version), filename);
}
function isFresh(filePath) {
  if (!existsSync(filePath)) return false;
  return Date.now() - statSync(filePath).mtimeMs < CACHE_TTL_MS;
}
async function ensureCached(version, filename) {
  const dest = cacheFile(version, filename);
  if (isFresh(dest)) return true;
  const content = await fetchRaw(rawUrl(version, filename));
  if (!content) return existsSync(dest);
  writeFileSync(dest, content, "utf8");
  return true;
}
var manifestCache = /* @__PURE__ */ new Map();
async function getManifest(version) {
  const hit = manifestCache.get(version);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.entries;
  await ensureCached(version, MANIFEST_FILENAME);
  const filePath = cacheFile(version, MANIFEST_FILENAME);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf8");
    const entries = JSON.parse(raw);
    manifestCache.set(version, { entries, ts: Date.now() });
    return entries;
  } catch {
    return [];
  }
}
var DocsFrontmatterSchema = z2.object({
  title: z2.string(),
  description: z2.string().optional(),
  section: z2.string().optional(),
  order: z2.number().default(0),
  draft: z2.boolean().default(false)
});
var loaderCache = /* @__PURE__ */ new Map();
function getDocsLoader(version) {
  if (loaderCache.has(version)) return loaderCache.get(version);
  const loader = defineContentLoader({
    directory: join2("src/storage/docs-cache", version),
    schema: DocsFrontmatterSchema,
    highlight: true
  });
  loaderCache.set(version, loader);
  return loader;
}
async function getDocPage(version, slug) {
  const filename = slug === "index" ? "index.md" : `${slug}.md`;
  const ok = await ensureCached(version, filename);
  if (!ok) return null;
  const loader = getDocsLoader(version);
  const page = await loader.get(slug);
  if (!page || page.frontmatter.draft) return null;
  return page;
}
async function getAllDocPages(version) {
  const entries = await getManifest(version);
  await Promise.allSettled(
    entries.filter((e) => !e.draft).map((e) => ensureCached(version, e.slug === "index" ? "index.md" : `${e.slug}.md`))
  );
  const loader = getDocsLoader(version);
  const pages = await loader.all();
  return pages.filter((p) => !p.frontmatter.draft);
}
function getVersions() {
  return env.DOCS_VERSIONS.split(",").map((v) => v.trim()).filter(Boolean);
}
function getDefaultVersion() {
  return getVersions()[0] ?? "1.x";
}

// src/modules/Docs/http/handlers/docs-api.handler.ts
var DocsListApiHandler = defineHandler(async (ctx) => {
  const version = getDefaultVersion();
  const pages = await getAllDocPages(version);
  return ctx.json({
    pages: pages.map((p) => ({
      slug: p.slug,
      title: p.frontmatter.title,
      description: p.frontmatter.description,
      section: p.frontmatter.section,
      order: p.frontmatter.order,
      excerpt: p.excerpt,
      readingTime: p.readingTime
    }))
  });
});
var SearchIndexApiHandler = defineHandler(async (ctx) => {
  const version = getDefaultVersion();
  const pages = await getAllDocPages(version);
  const index = pages.map((p) => ({
    slug: p.slug,
    version,
    title: p.frontmatter.title,
    section: p.frontmatter.section ?? "",
    description: p.frontmatter.description ?? "",
    excerpt: p.excerpt ?? "",
    body: (p.html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3e3)
  }));
  return ctx.json({ pages: index, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
});

// src/modules/Docs/http/routes/docs.api.ts
Route.get("/api/docs", DocsListApiHandler, {
  name: "docs.api.list",
  render: "static"
});
Route.get("/api/search-index", SearchIndexApiHandler, {
  name: "docs.api.search-index",
  render: "static"
});

// src/modules/Docs/http/routes/docs.web.ts
import { Route as Route2, url } from "@lumiarq/framework";

// src/modules/Docs/http/handlers/docs-page.handler.ts
import { defineHandler as defineHandler2 } from "@lumiarq/framework";

// src/modules/Docs/ui/web/pages/docs.page.ts
import { loadLocale } from "@lumiarq/framework/veil";
import { getContext } from "@lumiarq/framework/context";

// src/config/site.ts
var site = {
  /** Brand */
  name: env.APP_NAME,
  titleSuffix: `\u2014 ${env.APP_NAME}`,
  logoHtml: `Lumi<span>ARQ</span>`,
  /** Theme */
  themeStorageKey: "lumiarq-theme",
  /** URLs */
  github: "https://github.com/lumiarq/lumiarq",
  twitter: "https://twitter.com/lumiarq",
  discord: "https://discord.gg/lumiarq",
  discussions: "https://github.com/lumiarq/lumiarq/discussions",
  changelog: "https://github.com/lumiarq/lumiarq/releases",
  issues: "https://github.com/lumiarq/lumiarq/issues",
  /** CDN assets */
  cdn: {
    alpine: "https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js",
    hljsDark: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css",
    hljsLight: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css",
    fonts: "https://fonts.bunny.net/css?family=inter:400,500,600,700,800&display=swap"
  },
  /** Internal navigation paths */
  nav: {
    docs: "/docs",
    installation: "/docs/1.x/installation",
    home: "/"
  }
};

// src/modules/Docs/ui/web/pages/includes/sidebar.ts
var SECTION_ICONS = {
  Prologue: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  "Getting Started": `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  "Architecture Concepts": `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  "The Basics": `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  "The Logic Layer": `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
  "Digging Deeper": `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  Security: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  Database: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  Testing: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  Packages: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  "Agentic Development": `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>`,
  Changelog: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  Roadmap: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`
};
var DEFAULT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

// src/storage/framework/cache/views/docs-page.veil.ts
function render(vars, locale2 = {}) {
  const __e = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const __t = (key) => locale2[key] ?? key;
  const { page, nav, activeVersion, versions, editOnGithub } = vars;
  let __o = "";
  __o += `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>
`;
  __o += __e(page.frontmatter.title);
  __o += ` \u2014 LumiARQ
</title>
  <meta name="description" content="
`;
  __o += __e(page.frontmatter.description ?? "");
  __o += `
">
  <link rel="preconnect" href="https://fonts.bunny.net">
  <link href="`;
  __o += __e(site.cdn.fonts);
  __o += `" rel="stylesheet">
  <!-- highlight.js: dark theme default, github light for light-mode -->
  <link id="hljs-dark" rel="stylesheet" href="`;
  __o += __e(site.cdn.hljsDark);
  __o += `">
  <link id="hljs-light" rel="stylesheet" href="`;
  __o += __e(site.cdn.hljsLight);
  __o += `" disabled>
<style>
/*! tailwindcss v4.2.2 | MIT License | https://tailwindcss.com */
@layer properties{@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b)))){*,:before,:after,::backdrop{--tw-rotate-x:initial;--tw-rotate-y:initial;--tw-rotate-z:initial;--tw-skew-x:initial;--tw-skew-y:initial;--tw-border-style:solid;--tw-ordinal:initial;--tw-slashed-zero:initial;--tw-numeric-figure:initial;--tw-numeric-spacing:initial;--tw-numeric-fraction:initial;--tw-shadow:0 0 #0000;--tw-shadow-color:initial;--tw-shadow-alpha:100%;--tw-inset-shadow:0 0 #0000;--tw-inset-shadow-color:initial;--tw-inset-shadow-alpha:100%;--tw-ring-color:initial;--tw-ring-shadow:0 0 #0000;--tw-inset-ring-color:initial;--tw-inset-ring-shadow:0 0 #0000;--tw-ring-inset:initial;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-offset-shadow:0 0 #0000;--tw-outline-style:solid;--tw-blur:initial;--tw-brightness:initial;--tw-contrast:initial;--tw-grayscale:initial;--tw-hue-rotate:initial;--tw-invert:initial;--tw-opacity:initial;--tw-saturate:initial;--tw-sepia:initial;--tw-drop-shadow:initial;--tw-drop-shadow-color:initial;--tw-drop-shadow-alpha:100%;--tw-drop-shadow-size:initial;--tw-backdrop-blur:initial;--tw-backdrop-brightness:initial;--tw-backdrop-contrast:initial;--tw-backdrop-grayscale:initial;--tw-backdrop-hue-rotate:initial;--tw-backdrop-invert:initial;--tw-backdrop-opacity:initial;--tw-backdrop-saturate:initial;--tw-backdrop-sepia:initial;--tw-font-weight:initial;--tw-tracking:initial;--tw-duration:initial;--tw-ease:initial}}}@layer theme{:root,:host{--font-sans:ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";--font-mono:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;--color-white:#fff;--spacing:.25rem;--container-2xl:42rem;--container-3xl:48rem;--container-7xl:80rem;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height:calc(1.5 / 1);--text-lg:1.125rem;--text-lg--line-height:calc(1.75 / 1.125);--text-xl:1.25rem;--text-xl--line-height:calc(1.75 / 1.25);--text-7xl:4.5rem;--text-7xl--line-height:1;--font-weight-medium:500;--tracking-tight:-.025em;--radius-sm:.25rem;--radius-md:.375rem;--radius-lg:.5rem;--radius-xl:.75rem;--ease-out:cubic-bezier(0, 0, .2, 1);--default-transition-duration:.15s;--default-transition-timing-function:cubic-bezier(.4, 0, .2, 1);--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono)}}@layer base{*,:after,:before,::backdrop{box-sizing:border-box;border:0 solid;margin:0;padding:0}::file-selector-button{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5;font-family:var(--default-font-family,ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-webkit-tap-highlight-color:transparent}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;-webkit-text-decoration:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-variation-settings:var(--default-mono-font-variation-settings,normal);font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}:-moz-focusring{outline:auto}progress{vertical-align:baseline}summary{display:list-item}ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}button,input,select,optgroup,textarea{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}::file-selector-button{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::placeholder{opacity:1}@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px){::placeholder{color:currentColor}@supports (color:color-mix(in lab, red, red)){::placeholder{color:color-mix(in oklab, currentcolor 50%, transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit{padding-block:0}::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-datetime-edit-month-field{padding-block:0}::-webkit-datetime-edit-day-field{padding-block:0}::-webkit-datetime-edit-hour-field{padding-block:0}::-webkit-datetime-edit-minute-field{padding-block:0}::-webkit-datetime-edit-second-field{padding-block:0}::-webkit-datetime-edit-millisecond-field{padding-block:0}::-webkit-datetime-edit-meridiem-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}button,input:where([type=button],[type=reset],[type=submit]){appearance:button}::file-selector-button{appearance:button}::-webkit-inner-spin-button{height:auto}::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}:root{--brand-red:#ff2d20;--brand-red-dim:#ff2d20e6;--brand-red-glow:#ff2d202e;--brand-red-border:#ff2d204d;--brand-red-subtle:#ff2d2014;--bg:#0a0a0f;--bg-raised:#12121a;--bg-card:#12121ab3;--bg-card-hover:#181822e6;--border:#ffffff12;--border-med:#ffffff1f;--text:#f1f1f5;--text-sub:#a1a1b5;--text-muted:#636380;--code-bg:#0d1117;--code-border:#ffffff1a;--code-text:#c9d1d9;--code-kw:#ff79c6;--code-fn:#50fa7b;--code-str:#f1fa8c;--code-cmt:#6272a4;--code-ty:#8be9fd;--code-num:#bd93f9;--code-punc:#f8f8f2;--radius-sm:8px;--radius-md:14px;--radius-lg:22px;--radius-xl:28px;--header-h:65px;--sidebar-w:260px;--spacing:.25rem;--spacing-sm:.5rem;--spacing-md:.75rem;--spacing-lg:1rem;--spacing-xl:2rem;--font-family:"Inter", -apple-system, BlinkMacSystemFont, sans-serif;--font-mono:"Fira Code", "Cascadia Code", "Consolas", monospace;--font-size:15px;--line-height:1.6;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height:1.5;--text-lg:1.125rem;--text-lg--line-height:calc(1.75 / 1.125);--text-xl:1.25rem;--text-xl--line-height:calc(1.75 / 1.25);--text-7xl:4.5rem;--text-7xl--line-height:1;--tracking-tight:-.025em}:root[data-theme=light]{--bg:#fff;--bg-raised:#f8f8fc;--bg-card:#f8f8fce6;--bg-card-hover:#f0f0f8;--border:#00000012;--border-med:#0000001f;--text:#0f0f14;--text-sub:#3d3d55;--text-muted:#7070a0;--code-bg:#f6f8fa;--code-border:#0000001f;--code-text:#24292f;--code-kw:#cf222e;--code-fn:#116329;--code-str:#0a3069;--code-cmt:#6e7781;--code-ty:#0550ae;--code-num:#6639ba;--code-punc:#24292f;--brand-red-glow:#ff2d201a;--brand-red-subtle:#ff2d200f}*,:before,:after{box-sizing:border-box;margin:0;padding:0}html,body{background:var(--bg);color:var(--text);transition:background-color .2s,color .2s}body{font-family:var(--font-family);font-size:var(--font-size);line-height:var(--line-height);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow-x:hidden}a{color:inherit;text-decoration:none}img,svg{vertical-align:middle;display:inline-block}code,pre{font-family:var(--font-mono)}}@layer components{.btn-primary{height:calc(var(--spacing) * 10);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);background-color:var(--brand-red);padding-inline:calc(var(--spacing) * 4);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--color-white);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);border-width:1px;border-color:#0000;display:inline-flex}@media (hover:hover){.btn-primary:hover{opacity:.9}}.btn-primary:focus{--tw-outline-style:none;outline-style:none}.btn-primary:focus-visible{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.btn-secondary{height:calc(var(--spacing) * 10);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);border-width:1px;border-color:var(--border);background-color:var(--bg-card);padding-inline:calc(var(--spacing) * 4);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--text);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);display:inline-flex}@media (hover:hover){.btn-secondary:hover{background-color:var(--bg-card-hover)}}.btn-secondary:focus{--tw-outline-style:none;outline-style:none}.btn-ghost{height:calc(var(--spacing) * 9);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);padding-inline:calc(var(--spacing) * 3);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--text-sub);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);border-width:1px;border-color:#0000;display:inline-flex}@media (hover:hover){.btn-ghost:hover{background-color:var(--brand-red-subtle);color:var(--text)}}.btn-ghost:focus{--tw-outline-style:none;outline-style:none}.corner-dot{background-color:var(--brand-red);width:7px;height:7px;position:absolute}.ambient-glow{z-index:-1;pointer-events:none;background:radial-gradient(at 50% 0,#ff2d2024 0%,#0000 65%);width:900px;height:700px;position:fixed;top:-200px;left:50%;transform:translate(-50%)}.wrapper{max-width:1280px;margin:0 auto}.wrapper-wide{max-width:1500px;margin:0 auto;padding:0 2rem}.flexy-wrapper{justify-content:space-between;align-items:center;width:100%;display:flex}.site-header,.site-nav{z-index:200;height:var(--header-h);border-bottom:1px solid var(--border);-webkit-backdrop-filter:blur(16px);background:#0a0a0fd1;justify-content:space-between;align-items:center;padding:0 1.75rem;transition:background-color .2s;display:flex;position:sticky;top:0}:root[data-theme=light] .site-header,:root[data-theme=light] .site-nav{background:#ffffffdb}.site-logo,.nav-logo{color:var(--text);flex-shrink:0;align-items:center;gap:10px;font-size:1.1rem;font-weight:700;display:flex}.site-logo span,.nav-logo span{color:var(--brand-red)}.nav-center,.header-nav{align-items:center;gap:1.5rem;display:flex}.nav-center{width:100%}.header-nav{flex-shrink:0;justify-content:flex-end;gap:1rem;margin-left:auto}.nav-center a,.header-nav a{color:var(--text-sub);font-size:.875rem;font-weight:500;transition:color .15s}.nav-center a:hover,.header-nav a:hover{color:var(--text)}.nav-actions{align-items:center;display:flex}.nav-left{gap:calc(var(--spacing) * 5)}.nav-right{gap:calc(var(--spacing) * 3)}.icon-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);background:0 0;flex-shrink:0;justify-content:center;align-items:center;width:34px;height:34px;transition:background .15s,color .15s,border-color .15s;display:flex}.icon-btn:hover{color:var(--text);border-color:var(--border-med);background:#ffffff0f}:root[data-theme=light] .icon-btn:hover{background:#0000000d}.github-badge{border:1px solid var(--border);color:var(--text-sub);border-radius:20px;align-items:center;gap:6px;padding:5px 11px;font-size:.78rem;font-weight:600;transition:border-color .15s,color .15s;display:flex}.github-badge:hover{border-color:var(--border-med);color:var(--text)}.github-badge svg{opacity:.7}.btn-primary,.cta-primary{background:var(--brand-red);border-radius:var(--radius-sm);white-space:nowrap;align-items:center;gap:7px;padding:7px 16px;font-size:.825rem;font-weight:600;transition:opacity .2s;display:inline-flex;color:#fff!important}.btn-primary:hover,.cta-primary:hover{opacity:.88}.cta-secondary{color:var(--text-sub);border-radius:var(--radius-md);border:1px solid var(--border-med);align-items:center;gap:7px;padding:12px 22px;font-size:.9rem;font-weight:600;transition:border-color .2s,color .2s,background .2s;display:inline-flex}.cta-secondary:hover{border-color:var(--border-med);color:var(--text);background:var(--bg-card)}.nav-divider{background:var(--border);width:1px;height:20px;margin:0 4px}.hamburger-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);background:0 0;flex-shrink:0;justify-content:center;align-items:center;width:36px;height:36px;transition:background .15s,color .15s;display:none}.hamburger-btn:hover{color:var(--text);background:#ffffff0f}.sidebar{top:var(--header-h);height:calc(100vh - var(--header-h));border-right:1px solid var(--border);scrollbar-width:thin;scrollbar-color:var(--border) transparent;width:var(--sidebar-w);padding:1.25rem .75rem;position:sticky;overflow-y:auto}.sidebar-section{margin-bottom:.125rem}.sidebar-summary{letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);-webkit-user-select:none;user-select:none;justify-content:space-between;align-items:center;padding:.35rem .5rem;font-size:.68rem;font-weight:700;list-style:none;transition:color .15s;display:flex}.sidebar-summary-content{align-items:center;gap:.4rem;display:flex}.sidebar-section-icon{opacity:.5;flex-shrink:0;align-items:center;transition:opacity .15s;display:flex}.sidebar-summary::-webkit-details-marker{display:none}.sidebar-summary:hover{color:var(--text)}.sidebar-section[open] .chevron{transform:rotate(90deg)}.chevron{color:var(--text-muted);flex-shrink:0;transition:transform .2s}.sidebar-list{padding:.25rem 0 .5rem .5rem;list-style:none}.sidebar-link{border-radius:var(--radius-sm);color:var(--text-muted);border-left:2px solid #0000;padding:.35rem .75rem;font-size:.875rem;transition:background .15s,color .15s,border-color .15s;display:block}.sidebar-link:hover{background:var(--bg-card);color:var(--text);border-left-color:var(--border-med)}.sidebar-link.active{color:var(--brand-red);border-left-color:var(--brand-red);background:#ff2d201a;font-weight:500}.sidebar-overlay{z-index:200;-webkit-backdrop-filter:blur(2px);background:#0009;position:fixed;inset:0}.mobile-nav-overlay{z-index:220;-webkit-backdrop-filter:blur(2px);background:#0000008c;position:fixed;inset:0}.mobile-nav-drawer{top:var(--header-h);width:min(320px,92vw);max-height:calc(100vh - var(--header-h));background:var(--bg);border-left:1px solid var(--border);border-bottom:1px solid var(--border);z-index:230;flex-direction:column;gap:.5rem;padding:1rem;display:flex;position:fixed;right:0;overflow-y:auto}.mobile-nav-link{border-radius:var(--radius-sm);border:1px solid var(--border);color:var(--text-sub);padding:.7rem .9rem;font-size:.9rem;font-weight:500;transition:background .15s,color .15s,border-color .15s;display:block}.mobile-nav-link:hover{color:var(--text);background:var(--bg-card);border-color:var(--border-med)}.hero{text-align:center;position:relative}.hero-badge{border:1px solid var(--brand-red-border);background:var(--brand-red-subtle);color:var(--brand-red);letter-spacing:.04em;border-radius:20px;align-items:center;gap:7px;margin-bottom:2rem;padding:4px 14px;font-size:.78rem;font-weight:600;display:inline-flex}.hero-badge svg{opacity:.8}.hero-left{text-align:start;max-width:746px;padding-bottom:calc(var(--spacing) * 52);padding-top:calc(var(--spacing) * 40);flex-direction:column;display:flex}.hero-right{justify-content:flex-start;width:50%;display:flex}.hero h1{font-size:clamp(var(--text-xl), 6vw, var(--text-7xl));font-weight:inherit;letter-spacing:-.04em;line-height:var(--text-7xl--line-height);background:linear-gradient(175deg, var(--text) 40%, #a1a1b566);-webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;margin-bottom:1.5rem}:root[data-theme=light] .hero h1{-webkit-text-fill-color:transparent;background:linear-gradient(175deg,#0f0f14 50%,#32325080);-webkit-background-clip:text;background-clip:text}.hero-sub{max-width:560px;color:var(--text-sub);text-wrap:balance;font-size:1.15rem;line-height:var(--text-xl--line-height);letter-spacing:var(--tracking-tight);margin-top:calc(var(--spacing) * 4)}.hero-cta{gap:calc(var(--spacing) * 4);margin-top:calc(var(--spacing) * 10);flex-flow:wrap;justify-content:flex-start;display:flex}.hero-visual{width:100%;max-width:450px}.hero-visual .code-window{background:var(--code-bg)}.hero .cta-primary{border-radius:var(--radius-md);padding:12px 26px;font-size:.9rem;transition:transform .2s,box-shadow .2s,opacity .2s;box-shadow:0 10px 30px -6px #ff2d2073}.hero .cta-primary:hover{opacity:1;transform:translateY(-2px);box-shadow:0 16px 36px -6px #ff2d208c}.code-window{background:var(--code-bg);border:1px solid var(--code-border);border-radius:var(--radius-lg);text-align:left;overflow:hidden;box-shadow:0 30px 80px -20px #0009}.code-titlebar{border-bottom:1px solid var(--code-border);background:#ffffff06;align-items:center;gap:6px;padding:12px 16px;display:flex}.dot{border-radius:50%;flex-shrink:0;width:11px;height:11px}.dot-red{background:#ff5f57}.dot-amber{background:#febc2e}.dot-green{background:#28c840}.code-filename{color:var(--text-muted);font-size:.72rem;font-family:var(--font-mono);margin-left:6px}.code-body{padding:1.25rem 1.5rem;overflow-x:auto}.code-body .header{text-align:center;margin-bottom:var(--spacing-xl)}.code-body .logo-container{margin-bottom:var(--spacing-md);display:inline-block}.code-body .header h1{margin-bottom:5px;font-size:18px;font-weight:500}.code-body .header p{font-size:14px}.code-pre{font-family:var(--font-mono);color:var(--code-text);font-size:.82rem;line-height:1.65}.kw{color:var(--code-kw)}.fn{color:var(--code-fn)}.str{color:var(--code-str)}.cmt{color:var(--code-cmt);font-style:italic}.ty{color:var(--code-ty)}.num{color:var(--code-num)}.punc{color:var(--code-punc)}.code-tabs{border-bottom:1px solid var(--code-border);background:#ffffff05;gap:4px;padding:0 1rem;display:grid}.code-tab{font-size:.78rem;font-family:var(--font-mono);color:var(--text-muted);cursor:pointer;background:0 0;border:none;padding:9px 14px;transition:color .15s,border-color .15s}.code-tab.active{color:var(--text);border-bottom-color:var(--brand-red)}.code-tab:hover{color:var(--text-sub)}.grid{gap:var(--spacing-xl);grid-template-columns:repeat(2,1fr);display:grid}.card{background:var(--bg-card);border:1px solid var(--border);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);padding:var(--spacing-sm);color:inherit;border-radius:1rem;text-decoration:none;transition:all .3s cubic-bezier(.4,0,.2,1);position:relative;overflow:hidden}.flexy-card{align-items:center;gap:1.5rem;display:flex}.card:hover{border-color:#ff2d2066;transform:translateY(-2px)}.card:hover .icon-box{background:var(--brand-red);color:#fff}.icon-box{width:40px;height:40px;color:var(--brand-red);background:#1e293b;border-radius:8px;justify-content:center;align-items:center;margin-bottom:1.25rem;transition:background .3s;display:flex}.card h2{font-size:18px;font-weight:600}.card p{color:var(--text-muted);font-size:.9375rem;line-height:1.6}.version-tag{color:var(--brand-red);background:#ff2d201a;border-radius:9999px;margin-top:1rem;padding:.25rem .75rem;font-size:.75rem;font-weight:600;display:inline-block}.trust-bar{border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:40px 0}.trust-label{text-align:center;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1.5rem;font-size:.72rem;font-weight:600}.trust-logos{flex-wrap:wrap;justify-content:center;align-items:center;gap:2.5rem;display:flex}.trust-logo{color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;opacity:.55;font-size:.92rem;font-weight:700;transition:opacity .2s}.trust-logo:hover{opacity:.9}.pitch{border-top-width:0;position:relative}.pitch .wrapper{position:revert-layer;padding-top:calc(var(--spacing) * 16);border:1px solid var(--code-border);border-color:var(--code-border);border-top:none}.pitch-grid{grid-template-columns:1fr 1fr;align-items:center;gap:64px;display:grid}.pitch-panel{padding-inline:calc(var(--spacing) * 4);padding-right:0}.pitch-left-panel{padding-right:0;padding-left:calc(var(--spacing) * 12)}.pitch-right-panel{min-width:calc(var(--spacing) * 0);flex-grow:1}.pitch-label{letter-spacing:.1em;text-transform:uppercase;color:var(--brand-red);margin-bottom:1rem;font-size:.72rem;font-weight:700}.pitch-title{letter-spacing:-.03em;margin-bottom:1.25rem;font-size:clamp(1.6rem,3vw,2.4rem);font-weight:800;line-height:1.2}.pitch-text{color:var(--text-sub);margin-bottom:2rem;font-size:1rem;line-height:1.75}.feature-list{flex-direction:column;gap:.75rem;list-style:none;display:flex}.feature-list li{align-items:flex-start;gap:calc(var(--spacing) * 2.5);color:var(--text-sub);font-size:.9rem;line-height:1.5;display:flex}.feature-list li svg{color:var(--brand-red);flex-shrink:0;margin-top:1px}.pitch-link,.link-arrow{color:var(--brand-red);align-items:center;gap:6px;margin-top:2rem;font-size:.875rem;font-weight:600;transition:gap .2s;display:inline-flex}.pitch-link:hover,.link-arrow:hover{gap:10px}.section-eyebrow{letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);align-items:center;gap:10px;margin-bottom:1rem;font-size:.72rem;font-weight:700;display:flex}.section-eyebrow:before,.section-eyebrow:after{content:"";background:var(--border);flex:1;height:1px}.section-title{letter-spacing:-.03em;text-align:center;margin-bottom:.75rem;font-size:clamp(1.8rem,3.5vw,2.6rem);font-weight:800;line-height:1.2}.section-sub{text-align:center;color:var(--text-sub);max-width:520px;margin:0 auto 3.5rem;font-size:1rem;line-height:1.75}.bento{padding:80px 0}.bento-grid{grid-template-rows:auto;grid-template-columns:repeat(12,1fr);gap:1.25rem;display:grid}.bento-card{padding:2rem;transition:border-color .25s,background .25s,transform .25s;position:relative;overflow:hidden}.bento-full{grid-column:span 12}.bento-8{grid-column:span 8}.bento-4{grid-column:span 4}.bento-6{grid-column:span 6}.bento-7{grid-column:span 7}.bento-5{grid-column:span 5}.bento-card-label{letter-spacing:.1em;text-transform:uppercase;color:var(--brand-red);text-align:left;margin-bottom:.75rem;font-size:.7rem;font-weight:700}.bento-card-title{letter-spacing:-.02em;margin-bottom:.75rem;font-size:1.2rem;font-weight:700;line-height:1.3}.bento-card-text{color:var(--text-sub);text-align:left;max-width:460px;font-size:.875rem;line-height:1.7}.bento-card-link{color:var(--brand-red);align-items:center;gap:5px;margin-top:1.5rem;font-size:.8rem;font-weight:600;transition:gap .2s;display:inline-flex}.bento-card-link:hover{gap:8px}.bento-icon{background:var(--brand-red-subtle);width:40px;height:40px;color:var(--brand-red);border:1px solid var(--brand-red-border);border-radius:11px;justify-content:center;align-items:center;margin-bottom:1.25rem;display:flex}.bento-code{background:var(--code-bg);border:1px solid var(--code-border);border-radius:var(--radius-md);margin-top:1.25rem;padding:1rem 1.25rem;overflow-x:auto}.bento-code pre{font-family:var(--font-mono);color:var(--code-text);font-size:.78rem;line-height:1.6}.partner-logos{flex-direction:column;gap:8px;margin-top:1.5rem;display:flex}.partner-item{border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-raised);color:var(--text-sub);align-items:center;gap:10px;padding:9px 14px;font-size:.82rem;font-weight:600;transition:border-color .2s,color .2s;display:flex}.partner-item:hover{border-color:var(--border-med);color:var(--text)}.partner-item svg{color:var(--text-muted)}.bento-checks{flex-direction:column;gap:.6rem;margin-top:1.25rem;list-style:none;display:flex}.bento-checks li{color:var(--text-sub);align-items:center;gap:8px;font-size:.875rem;display:flex}.bento-checks li svg{color:var(--brand-red);flex-shrink:0}.cta-band{text-align:center;padding:100px 0;position:relative}.cta-band h2{letter-spacing:-.04em;background:linear-gradient(175deg, var(--text) 40%, #a1a1b566);-webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;margin-bottom:1rem;font-size:clamp(2.2rem,5vw,3.8rem);font-weight:800;line-height:1.1}:root[data-theme=light] .cta-band h2{-webkit-text-fill-color:transparent;background:linear-gradient(175deg,#0f0f14 60%,#32325080);-webkit-background-clip:text;background-clip:text}.cta-band p{color:var(--text-sub);max-width:480px;margin-bottom:2.5rem;margin-left:auto;margin-right:auto;font-size:1.05rem}.cta-band-actions{flex-wrap:wrap;justify-content:center;gap:14px;display:flex}.testimonials{border-top:1px solid var(--border);padding:80px 0}.testimonials-grid{grid-template-columns:repeat(3,1fr);gap:1.25rem;display:grid}.testimonial-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.75rem;transition:border-color .25s}.testimonial-card:hover{border-color:var(--border-med)}.testimonial-card.featured{background:linear-gradient(135deg, var(--bg-card) 0%, #ff2d200a 100%);border-color:var(--brand-red-border)}.testimonial-card blockquote{color:var(--text-sub);margin-bottom:1.25rem;font-size:.9rem;line-height:1.7}.testimonial-author{align-items:center;gap:10px;display:flex}.testimonial-avatar{background:var(--brand-red-subtle);border:1px solid var(--brand-red-border);width:36px;height:36px;color:var(--brand-red);border-radius:50%;flex-shrink:0;justify-content:center;align-items:center;font-size:.8rem;font-weight:700;display:flex}.testimonial-name{color:var(--text);font-size:.82rem;font-weight:700}.testimonial-role{color:var(--text-muted);font-size:.75rem}.community{border-top:1px solid var(--border);padding:80px 0}.community-grid{grid-template-columns:1fr 1fr;gap:1.25rem;display:grid}.community-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-xl);padding:2.5rem;transition:border-color .25s,background .25s}.community-card:hover{border-color:var(--border-med);background:var(--bg-card-hover)}.community-card h3{letter-spacing:-.02em;margin-bottom:.75rem;font-size:1.4rem;font-weight:700}.community-card p{color:var(--text-sub);margin-bottom:1.5rem;font-size:.9rem;line-height:1.7}.layout{grid-template-columns:var(--sidebar-w) 1fr 200px;min-height:calc(100vh - var(--header-h));max-width:1500px;margin:0 auto;display:grid}.main{min-width:0;padding:2rem 2.5rem}article{max-width:720px}article h1,article h2,article h3,article h4{color:var(--text);margin-top:2.5rem;margin-bottom:.75rem;font-weight:700;line-height:1.3}article h1{margin-top:0;font-size:2rem}article h2{border-bottom:1px solid var(--border);padding-bottom:.5rem;font-size:1.4rem}article h3{font-size:1.15rem}article h4{font-size:1rem}article h2,article h3,article h4,article a[name]{scroll-margin-top:calc(var(--header-h) + 1.25rem)}article>ul:first-of-type:has(>li>a[href^=\\#]){display:none}article p{color:var(--text-muted);margin-bottom:1rem;line-height:1.8}article a{color:var(--brand-red)}article a:hover{text-decoration:underline}article ul,article ol{color:var(--text-muted);margin:.75rem 0 1rem 1.5rem;line-height:1.8}article li{margin-bottom:.25rem}article code{font-family:var(--font-mono);background:var(--bg-card);border:1px solid var(--border);color:#e879f9;border-radius:4px;padding:.1em .4em;font-size:.875em}article pre{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);margin:1rem 0 1.5rem;padding:1.25rem 1.5rem;position:relative;overflow-x:auto}.copy-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;opacity:0;background:#ffffff0f;border-radius:6px;align-items:center;gap:4px;padding:4px 10px;font-family:inherit;font-size:.72rem;transition:opacity .15s,background .15s,color .15s,border-color .15s;display:flex;position:absolute;top:.5rem;right:.5rem}article pre:hover .copy-btn{opacity:1}.copy-btn:hover{color:var(--text);background:#ffffff1a}.copy-btn.copied{color:#22c55e;opacity:1;border-color:#22c55e4d}article pre code{color:inherit;background:0 0;border:none;padding:0;font-size:.875rem}.example-output{border:1px solid var(--border);border-radius:8px;margin:1rem 0 1.5rem;overflow:hidden}.run-btn{background:var(--bg-card);border:none;border-bottom:1px solid var(--border);width:100%;color:var(--text-muted);cursor:pointer;text-align:left;align-items:center;gap:.4rem;padding:.45rem 1rem;font-family:inherit;font-size:.82rem;transition:background .15s,color .15s;display:inline-flex}.run-btn:hover{color:var(--text);background:#ffffff0d}.run-btn .run-icon{color:var(--brand-red);font-style:normal}.output-console{position:relative;overflow-x:auto;color:#c9d1d9!important;background:#0d1117!important;border:none!important;border-radius:0!important;margin:0!important;padding:1rem 1.25rem!important;font-size:.825rem!important}.output-console .copy-btn{display:none}article blockquote{border-left:3px solid var(--brand-red);color:var(--text-muted);background:var(--bg-card);border-radius:0 8px 8px 0;margin:1.25rem 0;padding:.5rem 1rem;font-style:italic}article hr{border:none;border-top:1px solid var(--border);margin:2rem 0}article table{border-collapse:collapse;border:1px solid var(--border);border-radius:8px;width:100%;margin:1rem 0;font-size:.875rem;overflow:hidden}article th,article td{border-bottom:1px solid var(--border);text-align:left;padding:.6rem .75rem}article th{background:var(--bg-card);color:var(--text);letter-spacing:.04em;text-transform:uppercase;font-size:.8rem;font-weight:600}article td{color:var(--text-muted)}.meta{border-top:1px solid var(--border);color:var(--text-muted);margin-top:2rem;padding-top:1.5rem;font-size:.8rem}.toc{top:calc(var(--header-h) + 1.5rem);max-height:calc(100vh - var(--header-h) - 3rem);scrollbar-width:thin;scrollbar-color:var(--border) transparent;padding:1.5rem 1rem;position:sticky;overflow-y:auto}.toc-title{letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);align-items:center;gap:.4rem;margin-bottom:.75rem;font-size:.68rem;font-weight:700;display:flex}.toc-list,.toc-sub{padding:0;list-style:none}.toc-sub{padding-left:.75rem}.toc-link{color:var(--text-muted);border-left:2px solid #ffffff0f;padding:.25rem 0 .25rem .75rem;font-size:.8rem;line-height:1.4;transition:color .15s,border-color .15s;display:block}.toc-link:hover{color:var(--text);border-left-color:#ffffff2e}.toc-link.active{color:var(--text);border-left-color:var(--brand-red);font-weight:600}.search-btn{align-items:center;gap:calc(var(--spacing) * 2);color:var(--text-muted);min-width:calc(var(--spacing) * 40);cursor:pointer;transition:background .15s,color .15s;display:inline-flex}.search-btn:hover{color:var(--text);background:#ffffff0f}.search-modal-overlay{z-index:300;-webkit-backdrop-filter:blur(4px);background:#000000b3;justify-content:center;align-items:flex-start;padding-top:15vh;display:flex;position:fixed;inset:0}.search-modal{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-lg);width:min(560px,100vw - 2rem);overflow:hidden;box-shadow:0 25px 50px -12px #0009}.search-input-wrap{border-bottom:1px solid var(--border);color:var(--text-muted);align-items:center;gap:.75rem;padding:1rem 1.25rem;display:flex}.search-input-wrap input{color:var(--text);background:0 0;border:none;outline:none;flex:1;font-family:inherit;font-size:1rem}.search-input-wrap input::placeholder{color:var(--text-muted)}.search-results{max-height:360px;padding:.5rem;overflow-y:auto}.search-result-list{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.search-result-item{border-radius:8px;transition:background .1s}.search-result-item:hover,.search-result-active{background:var(--bg-raised)}.search-result-link{color:inherit;border-radius:8px;outline:none;flex-direction:column;gap:2px;padding:10px 12px;text-decoration:none;display:flex}.search-result-link:focus-visible{box-shadow:0 0 0 2px var(--brand-red)}.search-result-title{color:var(--text);font-size:.875rem;font-weight:500;line-height:1.3}.search-result-section{color:var(--brand-red);text-transform:uppercase;letter-spacing:.04em;font-size:.75rem;font-weight:500;line-height:1.2}.search-result-excerpt{color:var(--text-muted);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:.8rem;line-height:1.5;display:-webkit-box;overflow:hidden}.search-result-excerpt mark,.search-result-title mark,.search-result-section mark{color:var(--brand-red);background:0 0;font-weight:600}.search-empty{text-align:center;color:var(--text-muted);padding:1.5rem 1rem;font-size:.875rem}.site-footer{border-top:1px solid var(--border);padding:64px 0 40px}.footer-top{grid-template-columns:220px repeat(4,1fr);gap:48px;margin-bottom:56px;display:grid}.footer-brand p{color:var(--text-muted);max-width:180px;margin-top:.75rem;font-size:.825rem;line-height:1.7}.footer-social{gap:8px;margin-top:1.25rem;display:flex}.footer-col h4{letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1rem;font-size:.7rem;font-weight:700}.footer-col ul{flex-direction:column;gap:.625rem;list-style:none;display:flex}.footer-col a{color:var(--text-sub);font-size:.85rem;transition:color .15s}.footer-col a:hover{color:var(--text)}.footer-bottom{border-top:1px solid var(--border);color:var(--text-muted);justify-content:space-between;align-items:center;padding-top:32px;font-size:.8rem;display:flex}.footer-bottom-links{gap:1.5rem;display:flex}.footer-bottom-links a{color:var(--text-muted);font-size:.8rem;transition:color .15s}.footer-bottom-links a:hover{color:var(--text-sub)}.footer{text-align:center;color:var(--text-muted);margin-top:2rem;font-size:.875rem}}@layer utilities{.collapse{visibility:collapse}.invisible{visibility:hidden}.visible{visibility:visible}.absolute{position:absolute}.fixed{position:fixed}.relative{position:relative}.static{position:static}.sticky{position:sticky}.start{inset-inline-start:var(--spacing)}.end{inset-inline-end:var(--spacing)}.isolate{isolation:isolate}.container{width:100%}@media (min-width:40rem){.container{max-width:40rem}}@media (min-width:48rem){.container{max-width:48rem}}@media (min-width:64rem){.container{max-width:64rem}}@media (min-width:80rem){.container{max-width:80rem}}@media (min-width:96rem){.container{max-width:96rem}}.mx-auto{margin-inline:auto}.mt-8{margin-top:calc(var(--spacing) * 8)}.block{display:block}.contents{display:contents}.flex{display:flex}.grid{display:grid}.hidden{display:none}.inline{display:inline}.table{display:table}.w-full{width:100%}.max-w-2xl{max-width:var(--container-2xl)}.max-w-3xl{max-width:var(--container-3xl)}.max-w-7xl{max-width:var(--container-7xl)}.max-w-\\[1440px\\]{max-width:1440px}.max-w-full{max-width:100%}.min-w-0{min-width:calc(var(--spacing) * 0)}.flex-shrink{flex-shrink:1}.flex-grow,.grow{flex-grow:1}.border-collapse{border-collapse:collapse}.transform{transform:var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)}.resize{resize:both}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-start{align-items:flex-start}.justify-between{justify-content:space-between}.gap-4{gap:calc(var(--spacing) * 4)}.gap-5{gap:calc(var(--spacing) * 5)}.truncate{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.overflow-x-auto{overflow-x:auto}.border{border-style:var(--tw-border-style);border-width:1px}.mask-repeat{-webkit-mask-repeat:repeat;mask-repeat:repeat}.px-4{padding-inline:calc(var(--spacing) * 4)}.py-10{padding-block:calc(var(--spacing) * 10)}.text-center{text-align:center}.text-justify{text-align:justify}.text-wrap{text-wrap:wrap}.capitalize{text-transform:capitalize}.lowercase{text-transform:lowercase}.uppercase{text-transform:uppercase}.italic{font-style:italic}.ordinal{--tw-ordinal:ordinal;font-variant-numeric:var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,)}.overline{text-decoration-line:overline}.underline{text-decoration-line:underline}.shadow{--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.ring{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.outline{outline-style:var(--tw-outline-style);outline-width:1px}.invert{--tw-invert:invert(100%);filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.filter{filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.backdrop-filter{-webkit-backdrop-filter:var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);backdrop-filter:var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,)}.transition{transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to,opacity,box-shadow,transform,translate,scale,rotate,filter,-webkit-backdrop-filter,backdrop-filter,display,content-visibility,overlay,pointer-events;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}@media (min-width:40rem){.sm\\:px-6{padding-inline:calc(var(--spacing) * 6)}}@media (min-width:48rem){.md\\:col-span-2{grid-column:span 2/span 2}.md\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.md\\:flex-row{flex-direction:row}.md\\:items-center{align-items:center}}@media (min-width:64rem){.lg\\:px-8{padding-inline:calc(var(--spacing) * 8)}.lg\\:py-14{padding-block:calc(var(--spacing) * 14)}}}@media (max-width:1100px){.layout{grid-template-columns:var(--sidebar-w) 1fr}.toc{display:none}}@media (max-width:1024px){.site-nav,.site-header{padding:0 1rem}.nav-center,.search-btn-text,.search-btn-keys{display:none}.home-search-btn{min-width:auto}.hamburger-btn{display:flex}.pitch-grid{grid-template-columns:1fr;gap:40px}.bento-8,.bento-4,.bento-7,.bento-5{grid-column:span 12}.footer-top{grid-template-columns:1fr 1fr;gap:32px}.footer-brand{grid-column:span 2}.testimonials-grid{grid-template-columns:1fr 1fr}}@media (max-width:768px){.site-nav,.site-header{padding:0 1rem}.nav-center,.search-btn-text,.search-btn-keys{display:none}.home-search-btn{min-width:auto}.hamburger-btn{display:flex}.header-nav>a:not(.btn-primary){display:none}.layout{grid-template-columns:1fr}.sidebar{width:min(var(--sidebar-w), 85vw);z-index:250;background:var(--bg);height:100vh;padding-top:1rem;transition:transform .3s;position:fixed;top:0;left:0;transform:translate(-100%)}.sidebar-open .sidebar{transform:translate(0)}.hero{padding:64px 0 56px}.hero-left{padding-top:3rem;padding-bottom:1.5rem}.hero h1{font-size:2.4rem}.bento-6{grid-column:span 12}.community-grid,.testimonials-grid{grid-template-columns:1fr}.footer-top{grid-template-columns:1fr 1fr}.footer-brand{grid-column:span 2}.footer-bottom{text-align:center;flex-direction:column;gap:1rem}.trust-logos{gap:1.5rem}.main{padding:1.5rem 1rem}}@media (max-width:520px){.wrapper{padding:0 1rem}.hero-cta{flex-direction:column;align-items:stretch}.cta-primary,.cta-secondary{justify-content:center}.footer-top{grid-template-columns:1fr}.footer-brand{grid-column:auto}.cta-band-actions{flex-direction:column;align-items:center}}@media (max-width:640px){.grid{grid-template-columns:1fr}}@property --tw-rotate-x{syntax:"*";inherits:false}@property --tw-rotate-y{syntax:"*";inherits:false}@property --tw-rotate-z{syntax:"*";inherits:false}@property --tw-skew-x{syntax:"*";inherits:false}@property --tw-skew-y{syntax:"*";inherits:false}@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-ordinal{syntax:"*";inherits:false}@property --tw-slashed-zero{syntax:"*";inherits:false}@property --tw-numeric-figure{syntax:"*";inherits:false}@property --tw-numeric-spacing{syntax:"*";inherits:false}@property --tw-numeric-fraction{syntax:"*";inherits:false}@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-shadow-color{syntax:"*";inherits:false}@property --tw-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-inset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-shadow-color{syntax:"*";inherits:false}@property --tw-inset-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-ring-color{syntax:"*";inherits:false}@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-ring-color{syntax:"*";inherits:false}@property --tw-inset-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-ring-inset{syntax:"*";inherits:false}@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}@property --tw-ring-offset-color{syntax:"*";inherits:false;initial-value:#fff}@property --tw-ring-offset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-outline-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-blur{syntax:"*";inherits:false}@property --tw-brightness{syntax:"*";inherits:false}@property --tw-contrast{syntax:"*";inherits:false}@property --tw-grayscale{syntax:"*";inherits:false}@property --tw-hue-rotate{syntax:"*";inherits:false}@property --tw-invert{syntax:"*";inherits:false}@property --tw-opacity{syntax:"*";inherits:false}@property --tw-saturate{syntax:"*";inherits:false}@property --tw-sepia{syntax:"*";inherits:false}@property --tw-drop-shadow{syntax:"*";inherits:false}@property --tw-drop-shadow-color{syntax:"*";inherits:false}@property --tw-drop-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-drop-shadow-size{syntax:"*";inherits:false}@property --tw-backdrop-blur{syntax:"*";inherits:false}@property --tw-backdrop-brightness{syntax:"*";inherits:false}@property --tw-backdrop-contrast{syntax:"*";inherits:false}@property --tw-backdrop-grayscale{syntax:"*";inherits:false}@property --tw-backdrop-hue-rotate{syntax:"*";inherits:false}@property --tw-backdrop-invert{syntax:"*";inherits:false}@property --tw-backdrop-opacity{syntax:"*";inherits:false}@property --tw-backdrop-saturate{syntax:"*";inherits:false}@property --tw-backdrop-sepia{syntax:"*";inherits:false}@property --tw-font-weight{syntax:"*";inherits:false}@property --tw-tracking{syntax:"*";inherits:false}@property --tw-duration{syntax:"*";inherits:false}@property --tw-ease{syntax:"*";inherits:false}
</style>

  <!-- Prevent flash of unstyled content when light theme is stored -->
  <script>
    (function() {
      var t = localStorage.getItem('`;
  __o += __e(site.themeStorageKey);
  __o += `');
      if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    })();
  </script>
  <script defer src="`;
  __o += __e(site.cdn.alpine);
  __o += `"></script>
</head>
<body 
:class="{ 'sidebar-open': sidebarOpen }"
  x-data="{
    theme: localStorage.getItem('`;
  __o += __e(site.themeStorageKey);
  __o += `') || 'dark',
    sidebarOpen: false,
    searchOpen: false,
    init() {
      this.applyTheme(this.theme);
      this.$watch('theme', t => { localStorage.setItem('`;
  __o += __e(site.themeStorageKey);
  __o += `', t); this.applyTheme(t); });
    },
    applyTheme(t) {
      t === 'light'
        ? document.documentElement.setAttribute('data-theme', 'light')
        : document.documentElement.removeAttribute('data-theme');
      var dark = document.getElementById('hljs-dark');
      var light = document.getElementById('hljs-light');
      if (dark && light) { dark.disabled = (t === 'light'); light.disabled = (t !== 'light'); }
    },
    toggleTheme() { this.theme = this.theme === 'light' ? 'dark' : 'light'; }
  }"


  @keydown
  .escape.window="sidebarOpen = false; searchOpen = false"
>
<div class="ambient-glow"></div>





  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     DOCS HEADER / NAVIGATION
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->

<header class="site-header">
  <a href="`;
  __o += __e(site.nav.home);
  __o += `" class="site-logo">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF2D20" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
    `;
  __o += String(site.logoHtml ?? "");
  __o += `
  </a>

  <nav class="header-nav" aria-label="
${__t("aria.documentation_nav")}
">
    <a href="`;
  __o += __e(site.nav.docs);
  __o += `">
${__t("nav.documentation")}
</a>
    <a href="`;
  __o += __e(site.github);
  __o += `" target="_blank" rel="noopener">
${__t("nav.github")}
</a>

    <button 
@click
="searchOpen = true" class="icon-btn search-btn" aria-label="
${__t("aria.search")}
">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    </button>

    <button 
@click
="toggleTheme()" class="icon-btn" aria-label="
${__t("aria.theme_toggle")}
">
      <svg class="icon-moon" x-show="theme === 'dark'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
      <svg class="icon-sun" x-show="theme === 'light'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
        <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    </button>

    <a href="`;
  __o += __e(site.nav.installation);
  __o += `" class="btn-primary">
${__t("nav.get_started")}
</a>
  </nav>

  <button 
@click
="sidebarOpen = !sidebarOpen" class="hamburger-btn" aria-label="
${__t("aria.toggle_nav")}
">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/>
    </svg>
  </button>
</header>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     SEARCH MODAL
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->

<div
  x-show="searchOpen"
  @click.self="searchOpen = false"
  class="search-modal-overlay"
  style="display: none"
  role="dialog"
  aria-modal="true"
  aria-label="${__t("aria.search_dialog")}"
>
  <div class="search-modal">
    <div class="search-input-wrap">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        id="search-input"
        placeholder="${__t("page.search_placeholder")}"
        autocomplete="off"
        x-init="$watch('searchOpen', v => v && $nextTick(() => $el.focus()))"
      />
    </div>
    <div id="search-results" class="search-results" aria-live="polite"></div>
  </div>
</div>

  <div x-show="sidebarOpen" @click="sidebarOpen = false" class="sidebar-overlay" style="display: none"></div>

  <div class="layout mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8">
    <nav class="sidebar" 




  @click
  ="if($event.target.closest('.sidebar-link')) sidebarOpen = false"
           aria-label="



  ${__t("aria.documentation_nav")}
  "
      > 



  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     SIDEBAR \u2014 Version selector + navigation sections
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->

`;
  if (versions.length > 1) {
    __o += `
<div class="version-selector">
  <label class="version-label" for="version-switcher">
${__t("docs.version_label")}
</label>
  <select id="version-switcher" class="version-select"
          onchange="window.location.pathname = '/docs/' + this.value">
    `;
    versions.forEach(function(v) {
      __o += `
    <option value="`;
      __o += __e(v);
      __o += `"`;
      __o += __e(v === activeVersion ? " selected" : "");
      __o += `>`;
      __o += __e(v);
      __o += `</option>
    `;
    });
    __o += `
  </select>
</div>
`;
  }
  __o += `

`;
  nav.sections.forEach(function(section) {
    __o += `
<details class="sidebar-section"`;
    __o += __e(section.hasActive ? " open" : "");
    __o += `>
  <summary class="sidebar-summary">
    <span class="sidebar-summary-content">
      <span class="sidebar-section-icon">`;
    __o += String(SECTION_ICONS[section.title] ?? DEFAULT_ICON ?? "");
    __o += `</span>
      <span>`;
    __o += __e(section.title);
    __o += `</span>
    </span>
    <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 2l4 4-4 4"/>
    </svg>
  </summary>
  <ul class="sidebar-list">
    `;
    section.items.forEach(function(item) {
      __o += `
    <li>
      <a href="`;
      __o += __e(item.href);
      __o += `"
         class="sidebar-link`;
      __o += __e(item.current ? " active" : "");
      __o += `"
         `;
      __o += __e(item.current ? 'aria-current="page"' : "");
      __o += `
      >`;
      __o += __e(item.title);
      __o += `</a>
    </li>
    `;
    });
    __o += `
  </ul>
</details>
`;
  });
  __o += `

  </nav>

  <main class="main min-w-0">
    <article class="mx-auto w-full max-w-3xl">`;
  __o += String(page.html ?? "");
  __o += `</article>




  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     DOC FOOTER \u2014 Reading time + Edit on GitHub
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->

<div class="doc-footer">
  `;
  if (page.readingTime) {
    __o += `
  <span class="reading-time">`;
    __o += __e(page.readingTime);
    __o += ` 
${__t("page.min_read")}
</span>
  `;
  }
  __o += `
  <a href="`;
  __o += __e(editOnGithub);
  __o += `" class="edit-on-github" target="_blank" rel="noopener noreferrer">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
    </svg>
${__t("page.edit_on_github")}
  </a>
</div>

  </main>





  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     TABLE OF CONTENTS \u2014 Right-side on-page navigation
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->

`;
  var tocEntries = (page.toc || []).filter(function(e) {
    return e.level === 2 || e.level === 3;
  });
  __o += `
`;
  if (tocEntries.length > 0) {
    __o += `
<nav class="toc" aria-label="On this page">
  <p class="toc-title">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
    On this page
  </p>
  <ul class="toc-list">
    `;
    tocEntries.forEach(function(entry) {
      __o += `
    <li class="toc-depth-`;
      __o += __e(entry.level - 2);
      __o += `">
      <a href="#`;
      __o += __e(entry.id);
      __o += `" class="toc-link">`;
      __o += __e(entry.text);
      __o += `</a>
      `;
      if (entry.children && entry.children.filter(function(c) {
        return c.level === 3;
      }).length > 0) {
        __o += `
      <ul class="toc-sub">
        `;
        entry.children.filter(function(c) {
          return c.level === 3;
        }).forEach(function(child) {
          __o += `
        <li><a href="#`;
          __o += __e(child.id);
          __o += `" class="toc-link">`;
          __o += __e(child.text);
          __o += `</a></li>
        `;
        });
        __o += `
      </ul>
      `;
      }
      __o += `
    </li>
    `;
    });
    __o += `
  </ul>
</nav>
`;
  }
  __o += `

  </div>
<script>
;(function () {
  "use strict"

  // \u2500\u2500 Keyboard shortcut: Cmd+K / Ctrl+K \u2192 open search modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault()
      var body = document.body
      if (body._x_dataStack) {
        var alpine = body._x_dataStack[0]
        if (alpine && typeof alpine.searchOpen !== "undefined") {
          alpine.searchOpen = true
          return
        }
      }
      var overlay = document.querySelector(".search-modal-overlay")
      if (overlay) overlay.style.display = ""
      var input = document.getElementById("search-input")
      if (input) input.focus()
    }
  })
})()

</script>
  <script>
/* \u2500\u2500 docs.js \u2014 LumiARQ docs page scripts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Loaded via @scripts('docs.js') in docs-page.veil.html
 * Inlined into the page bundle at build time by the Veil compiler.
 * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

;(function () {
  'use strict';

  /* \u2500\u2500 <run-example> custom element upgrade \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  document.querySelectorAll('run-example').forEach(function (el) {
    var text = el.textContent.trim();
    var wrapper = document.createElement('div');
    wrapper.className = 'example-output';

    var btn = document.createElement('button');
    btn.className = 'run-btn';
    btn.setAttribute('type', 'button');
    btn.innerHTML = '<em class="run-icon">\u25B6</em> <span class="run-label">Run example</span>';

    var output = document.createElement('pre');
    output.className = 'output-console';
    output.textContent = text;
    output.hidden = true;

    btn.addEventListener('click', function () {
      output.hidden = !output.hidden;
      btn.querySelector('.run-label').textContent = output.hidden ? 'Run example' : 'Hide output';
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(output);
    el.replaceWith(wrapper);
  });

  /* \u2500\u2500 TOC active-section tracking \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  var tocLinks = document.querySelectorAll('.toc-link');
  if (tocLinks.length) {
    var HEADER_H = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h') || '60', 10
    );
    var OFFSET = HEADER_H + 20;

    var linkMap = {};
    tocLinks.forEach(function (link) {
      var id = (link.getAttribute('href') || '').replace(/^#/, '');
      if (id) linkMap[id] = link;
    });

    var article = document.querySelector('article');
    if (article) {
      var targets = Array.from(article.querySelectorAll('a[name]'));
      if (!targets.length) targets = Array.from(article.querySelectorAll('h2[id], h3[id]'));

      if (targets.length) {
        var activeLink = null;
        var rafPending = false;

        function setActive(link) {
          if (activeLink === link) return;
          if (activeLink) activeLink.classList.remove('active');
          activeLink = link;
          if (link) link.classList.add('active');
        }

        function update() {
          rafPending = false;
          var scrollY = window.scrollY;
          var threshold = scrollY + OFFSET;
          var best = null;

          for (var i = targets.length - 1; i >= 0; i--) {
            var el = targets[i];
            var absTop = el.getBoundingClientRect().top + scrollY;
            if (absTop <= threshold) { best = el; break; }
          }
          if (!best) best = targets[0];

          var id = best && (best.id || best.getAttribute('name'));
          setActive(id && linkMap[id] ? linkMap[id] : null);
        }

        window.addEventListener('scroll', function () {
          if (!rafPending) { rafPending = true; requestAnimationFrame(update); }
        }, { passive: true });

        update();
      }
    }
  }

  /* \u2500\u2500 Copy-to-clipboard for code blocks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  var copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var checkIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  document.querySelectorAll('article pre:not(.output-console)').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = copyIcon + '<span>Copy</span>';

    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      var text = code ? code.innerText : pre.innerText;

      function showCopied() {
        btn.classList.add('copied');
        btn.innerHTML = checkIcon + '<span>Copied!</span>';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML = copyIcon + '<span>Copy</span>';
        }, 2000);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); showCopied(); } catch (_) {}
        document.body.removeChild(ta);
      }
    });

    pre.appendChild(btn);
  });

  /* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     ALGOLIA-STYLE CLIENT SEARCH
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     - Lazy-fetches /api/search-index on first Cmd+K / modal open
     - Scores: title (4\xD7) > section (2\xD7) > description (2\xD7) > excerpt (1.5\xD7) > body (1\xD7)
     - Highlights matched terms in results
     - Keyboard navigation: \u2191\u2193 to move, Enter to go, Esc to close
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
  (function () {
    var searchInput   = document.getElementById('search-input');
    var searchResults = document.getElementById('search-results');
    if (!searchInput || !searchResults) return;

    var searchIndex  = null;   // lazy-loaded
    var indexLoading = false;
    var debounceTimer = null;
    var activeIdx = -1;

    // \u2500\u2500 Load index \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function loadIndex(cb) {
      if (searchIndex) { cb(searchIndex); return; }
      if (indexLoading) { setTimeout(function () { loadIndex(cb); }, 100); return; }
      indexLoading = true;
      fetch('/api/search-index')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          searchIndex = data.pages || [];
          indexLoading = false;
          cb(searchIndex);
        })
        .catch(function () {
          searchIndex = [];
          indexLoading = false;
          cb(searchIndex);
        });
    }

    // \u2500\u2500 Scoring \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function score(page, terms) {
      var s = 0;
      terms.forEach(function (t) {
        var re = new RegExp(t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'gi');
        var titleMatches   = (page.title       || '').match(re);
        var sectionMatches = (page.section     || '').match(re);
        var descMatches    = (page.description || '').match(re);
        var excerptMatches = (page.excerpt     || '').match(re);
        var bodyMatches    = (page.body        || '').match(re);
        s += (titleMatches   ? titleMatches.length   * 4   : 0);
        s += (sectionMatches ? sectionMatches.length * 2   : 0);
        s += (descMatches    ? descMatches.length    * 2   : 0);
        s += (excerptMatches ? excerptMatches.length * 1.5 : 0);
        s += (bodyMatches    ? bodyMatches.length    * 1   : 0);
      });
      return s;
    }

    // \u2500\u2500 Highlight \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function highlight(text, terms) {
      if (!text) return '';
      var safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      terms.forEach(function (t) {
        var re = new RegExp('(' + t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
        safe = safe.replace(re, '<mark>$1</mark>');
      });
      return safe;
    }

    // \u2500\u2500 Snippet: find the most relevant sentence containing a term \u2500\u2500\u2500\u2500\u2500\u2500
    function snippet(text, terms, maxLen) {
      maxLen = maxLen || 160;
      if (!text) return '';
      var lower = text.toLowerCase();
      var best = -1;
      terms.forEach(function (t) {
        var i = lower.indexOf(t.toLowerCase());
        if (i !== -1 && (best === -1 || i < best)) best = i;
      });
      if (best === -1) return text.slice(0, maxLen);
      var start = Math.max(0, best - 60);
      var end   = Math.min(text.length, start + maxLen);
      var raw   = (start > 0 ? '\u2026' : '') + text.slice(start, end) + (end < text.length ? '\u2026' : '');
      return raw;
    }

    // \u2500\u2500 Render results \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function renderResults(pages, terms) {
      activeIdx = -1;
      if (!pages.length) {
        searchResults.innerHTML = '<p class="search-empty">No results found.</p>';
        return;
      }
      var html = '<ul class="search-result-list" role="listbox">';
      pages.slice(0, 8).forEach(function (page, i) {
        var href    = page.slug === 'index'
          ? '/docs/' + page.version
          : '/docs/' + page.version + '/' + page.slug;
        var snip    = snippet(page.body || page.excerpt || '', terms);
        html += '<li class="search-result-item" role="option" data-idx="' + i + '" data-href="' + href + '">' +
          '<a href="' + href + '" class="search-result-link" tabindex="-1">' +
            '<span class="search-result-title">' + highlight(page.title, terms) + '</span>' +
            (page.section ? '<span class="search-result-section">' + highlight(page.section, terms) + '</span>' : '') +
            (snip ? '<span class="search-result-excerpt">' + highlight(snip, terms) + '</span>' : '') +
          '</a>' +
        '</li>';
      });
      html += '</ul>';
      searchResults.innerHTML = html;

      // click handler
      searchResults.querySelectorAll('.search-result-item').forEach(function (item) {
        item.addEventListener('mousedown', function (e) {
          e.preventDefault();
          window.location.href = item.getAttribute('data-href');
        });
      });
    }

    // \u2500\u2500 Keyboard nav \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function getItems() {
      return Array.from(searchResults.querySelectorAll('.search-result-item'));
    }

    function setActiveItem(idx) {
      var items = getItems();
      items.forEach(function (el) { el.classList.remove('search-result-active'); });
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add('search-result-active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
      activeIdx = idx;
    }

    searchInput.addEventListener('keydown', function (e) {
      var items = getItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveItem(Math.min(activeIdx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveItem(Math.max(activeIdx - 1, 0));
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && items[activeIdx]) {
          var href = items[activeIdx].getAttribute('data-href');
          if (href) window.location.href = href;
        }
      }
    });

    // \u2500\u2500 Search \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function doSearch(query) {
      var q = query.trim();
      if (!q) { searchResults.innerHTML = ''; return; }

      var terms = q.toLowerCase().split(/\\s+/).filter(Boolean);

      loadIndex(function (index) {
        var scored = index
          .map(function (page) { return { page: page, score: score(page, terms) }; })
          .filter(function (r) { return r.score > 0; })
          .sort(function (a, b) { return b.score - a.score; });

        renderResults(scored.map(function (r) { return r.page; }), terms);
      });
    }

    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { doSearch(searchInput.value); }, 150);
    });

    // Prefetch index when modal opens (watch Alpine searchOpen)
    var overlay = document.querySelector('.search-modal-overlay');
    if (overlay && window.MutationObserver) {
      new MutationObserver(function () {
        if (overlay.style.display !== 'none' && !searchIndex && !indexLoading) {
          loadIndex(function () {}); // warm the cache
        }
      }).observe(overlay, { attributes: true, attributeFilter: ['style'] });
    }

  }());

}());

  // Transforms \`<run-example>text</run-example>\` into interactive toggle panels.
  // Must run before Alpine.js initialises (inline scripts execute before defer).
  document.querySelectorAll('run-example').forEach(function (el) {
    var text = el.textContent.trim();
    var wrapper = document.createElement('div');
    wrapper.className = 'example-output';

    var btn = document.createElement('button');
    btn.className = 'run-btn';
    btn.setAttribute('type', 'button');
    btn.innerHTML = '<em class="run-icon">\u25B6</em> <span class="run-label">Run example</span>';

    var output = document.createElement('pre');
    output.className = 'output-console';
    output.textContent = text;
    output.hidden = true;

    btn.addEventListener('click', function () {
      output.hidden = !output.hidden;
      btn.querySelector('.run-label').textContent = output.hidden ? 'Run example' : 'Hide output';
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(output);
    el.replaceWith(wrapper);
  });

  /* \u2500\u2500 TOC active-section tracking \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  var tocLinks = document.querySelectorAll('.toc-link');
  if (tocLinks.length) {
    var HEADER_H = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h') || '60', 10
    );
    var OFFSET = HEADER_H + 20;

    var linkMap = {};
    tocLinks.forEach(function (link) {
      var id = (link.getAttribute('href') || '').replace(/^#/, '');
      if (id) linkMap[id] = link;
    });

    var article = document.querySelector('article');
    if (article) {
      var targets = Array.from(article.querySelectorAll('a[name]'));
      if (!targets.length) targets = Array.from(article.querySelectorAll('h2[id], h3[id]'));

      if (targets.length) {
        var activeLink = null;
        var rafPending = false;

        function setActive(link) {
          if (activeLink === link) return;
          if (activeLink) activeLink.classList.remove('active');
          activeLink = link;
          if (link) link.classList.add('active');
        }

        function update() {
          rafPending = false;
          var scrollY = window.scrollY;
          var threshold = scrollY + OFFSET;
          var best = null;

          for (var i = targets.length - 1; i >= 0; i--) {
            var el = targets[i];
            var absTop = el.getBoundingClientRect().top + scrollY;
            if (absTop <= threshold) { best = el; break; }
          }
          if (!best) best = targets[0];

          var id = best && (best.id || best.getAttribute('name'));
          setActive(id && linkMap[id] ? linkMap[id] : null);
        }

        window.addEventListener('scroll', function () {
          if (!rafPending) { rafPending = true; requestAnimationFrame(update); }
        }, { passive: true });

        update();
      }
    }
  }

  /* \u2500\u2500 Copy-to-clipboard for code blocks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  var copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var checkIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  document.querySelectorAll('article pre:not(.output-console)').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = copyIcon + '<span>Copy</span>';

    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      var text = code ? code.innerText : pre.innerText;

      function showCopied() {
        btn.classList.add('copied');
        btn.innerHTML = checkIcon + '<span>Copied!</span>';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML = copyIcon + '<span>Copy</span>';
        }, 2000);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied);
      } else {
        // Fallback for non-secure contexts (HTTP dev servers)
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); showCopied(); } catch (_) {}
        document.body.removeChild(ta);
      }
    });

    pre.appendChild(btn);
  });

</script>
</body>
</html>
`;
  return __o;
}

// src/storage/framework/cache/views/docs-unavailable-page.veil.ts
function render2(vars, locale2 = {}) {
  const __e = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const __t = (key) => locale2[key] ?? key;
  let __o = "";
  __o += `@vars({})
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>
${__t("docs.unavailable_title")}
  \u2014 LumiARQ
</title>
  <meta name="description" content="

">
  <link rel="preconnect" href="https://fonts.bunny.net">
  <link href="`;
  __o += __e(site.cdn.fonts);
  __o += `" rel="stylesheet">
  <!-- highlight.js: dark theme default, github light for light-mode -->
  <link id="hljs-dark" rel="stylesheet" href="`;
  __o += __e(site.cdn.hljsDark);
  __o += `">
  <link id="hljs-light" rel="stylesheet" href="`;
  __o += __e(site.cdn.hljsLight);
  __o += `" disabled>
<style>
/*! tailwindcss v4.2.2 | MIT License | https://tailwindcss.com */
@layer properties{@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b)))){*,:before,:after,::backdrop{--tw-rotate-x:initial;--tw-rotate-y:initial;--tw-rotate-z:initial;--tw-skew-x:initial;--tw-skew-y:initial;--tw-border-style:solid;--tw-ordinal:initial;--tw-slashed-zero:initial;--tw-numeric-figure:initial;--tw-numeric-spacing:initial;--tw-numeric-fraction:initial;--tw-shadow:0 0 #0000;--tw-shadow-color:initial;--tw-shadow-alpha:100%;--tw-inset-shadow:0 0 #0000;--tw-inset-shadow-color:initial;--tw-inset-shadow-alpha:100%;--tw-ring-color:initial;--tw-ring-shadow:0 0 #0000;--tw-inset-ring-color:initial;--tw-inset-ring-shadow:0 0 #0000;--tw-ring-inset:initial;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-offset-shadow:0 0 #0000;--tw-outline-style:solid;--tw-blur:initial;--tw-brightness:initial;--tw-contrast:initial;--tw-grayscale:initial;--tw-hue-rotate:initial;--tw-invert:initial;--tw-opacity:initial;--tw-saturate:initial;--tw-sepia:initial;--tw-drop-shadow:initial;--tw-drop-shadow-color:initial;--tw-drop-shadow-alpha:100%;--tw-drop-shadow-size:initial;--tw-backdrop-blur:initial;--tw-backdrop-brightness:initial;--tw-backdrop-contrast:initial;--tw-backdrop-grayscale:initial;--tw-backdrop-hue-rotate:initial;--tw-backdrop-invert:initial;--tw-backdrop-opacity:initial;--tw-backdrop-saturate:initial;--tw-backdrop-sepia:initial;--tw-font-weight:initial;--tw-tracking:initial;--tw-duration:initial;--tw-ease:initial}}}@layer theme{:root,:host{--font-sans:ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";--font-mono:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;--color-white:#fff;--spacing:.25rem;--container-2xl:42rem;--container-3xl:48rem;--container-7xl:80rem;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height:calc(1.5 / 1);--text-lg:1.125rem;--text-lg--line-height:calc(1.75 / 1.125);--text-xl:1.25rem;--text-xl--line-height:calc(1.75 / 1.25);--text-7xl:4.5rem;--text-7xl--line-height:1;--font-weight-medium:500;--tracking-tight:-.025em;--radius-sm:.25rem;--radius-md:.375rem;--radius-lg:.5rem;--radius-xl:.75rem;--ease-out:cubic-bezier(0, 0, .2, 1);--default-transition-duration:.15s;--default-transition-timing-function:cubic-bezier(.4, 0, .2, 1);--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono)}}@layer base{*,:after,:before,::backdrop{box-sizing:border-box;border:0 solid;margin:0;padding:0}::file-selector-button{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5;font-family:var(--default-font-family,ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-webkit-tap-highlight-color:transparent}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;-webkit-text-decoration:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-variation-settings:var(--default-mono-font-variation-settings,normal);font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}:-moz-focusring{outline:auto}progress{vertical-align:baseline}summary{display:list-item}ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}button,input,select,optgroup,textarea{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}::file-selector-button{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::placeholder{opacity:1}@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px){::placeholder{color:currentColor}@supports (color:color-mix(in lab, red, red)){::placeholder{color:color-mix(in oklab, currentcolor 50%, transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit{padding-block:0}::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-datetime-edit-month-field{padding-block:0}::-webkit-datetime-edit-day-field{padding-block:0}::-webkit-datetime-edit-hour-field{padding-block:0}::-webkit-datetime-edit-minute-field{padding-block:0}::-webkit-datetime-edit-second-field{padding-block:0}::-webkit-datetime-edit-millisecond-field{padding-block:0}::-webkit-datetime-edit-meridiem-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}button,input:where([type=button],[type=reset],[type=submit]){appearance:button}::file-selector-button{appearance:button}::-webkit-inner-spin-button{height:auto}::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}:root{--brand-red:#ff2d20;--brand-red-dim:#ff2d20e6;--brand-red-glow:#ff2d202e;--brand-red-border:#ff2d204d;--brand-red-subtle:#ff2d2014;--bg:#0a0a0f;--bg-raised:#12121a;--bg-card:#12121ab3;--bg-card-hover:#181822e6;--border:#ffffff12;--border-med:#ffffff1f;--text:#f1f1f5;--text-sub:#a1a1b5;--text-muted:#636380;--code-bg:#0d1117;--code-border:#ffffff1a;--code-text:#c9d1d9;--code-kw:#ff79c6;--code-fn:#50fa7b;--code-str:#f1fa8c;--code-cmt:#6272a4;--code-ty:#8be9fd;--code-num:#bd93f9;--code-punc:#f8f8f2;--radius-sm:8px;--radius-md:14px;--radius-lg:22px;--radius-xl:28px;--header-h:65px;--sidebar-w:260px;--spacing:.25rem;--spacing-sm:.5rem;--spacing-md:.75rem;--spacing-lg:1rem;--spacing-xl:2rem;--font-family:"Inter", -apple-system, BlinkMacSystemFont, sans-serif;--font-mono:"Fira Code", "Cascadia Code", "Consolas", monospace;--font-size:15px;--line-height:1.6;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height:1.5;--text-lg:1.125rem;--text-lg--line-height:calc(1.75 / 1.125);--text-xl:1.25rem;--text-xl--line-height:calc(1.75 / 1.25);--text-7xl:4.5rem;--text-7xl--line-height:1;--tracking-tight:-.025em}:root[data-theme=light]{--bg:#fff;--bg-raised:#f8f8fc;--bg-card:#f8f8fce6;--bg-card-hover:#f0f0f8;--border:#00000012;--border-med:#0000001f;--text:#0f0f14;--text-sub:#3d3d55;--text-muted:#7070a0;--code-bg:#f6f8fa;--code-border:#0000001f;--code-text:#24292f;--code-kw:#cf222e;--code-fn:#116329;--code-str:#0a3069;--code-cmt:#6e7781;--code-ty:#0550ae;--code-num:#6639ba;--code-punc:#24292f;--brand-red-glow:#ff2d201a;--brand-red-subtle:#ff2d200f}*,:before,:after{box-sizing:border-box;margin:0;padding:0}html,body{background:var(--bg);color:var(--text);transition:background-color .2s,color .2s}body{font-family:var(--font-family);font-size:var(--font-size);line-height:var(--line-height);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow-x:hidden}a{color:inherit;text-decoration:none}img,svg{vertical-align:middle;display:inline-block}code,pre{font-family:var(--font-mono)}}@layer components{.btn-primary{height:calc(var(--spacing) * 10);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);background-color:var(--brand-red);padding-inline:calc(var(--spacing) * 4);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--color-white);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);border-width:1px;border-color:#0000;display:inline-flex}@media (hover:hover){.btn-primary:hover{opacity:.9}}.btn-primary:focus{--tw-outline-style:none;outline-style:none}.btn-primary:focus-visible{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.btn-secondary{height:calc(var(--spacing) * 10);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);border-width:1px;border-color:var(--border);background-color:var(--bg-card);padding-inline:calc(var(--spacing) * 4);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--text);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);display:inline-flex}@media (hover:hover){.btn-secondary:hover{background-color:var(--bg-card-hover)}}.btn-secondary:focus{--tw-outline-style:none;outline-style:none}.btn-ghost{height:calc(var(--spacing) * 9);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);padding-inline:calc(var(--spacing) * 3);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--text-sub);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);border-width:1px;border-color:#0000;display:inline-flex}@media (hover:hover){.btn-ghost:hover{background-color:var(--brand-red-subtle);color:var(--text)}}.btn-ghost:focus{--tw-outline-style:none;outline-style:none}.corner-dot{background-color:var(--brand-red);width:7px;height:7px;position:absolute}.ambient-glow{z-index:-1;pointer-events:none;background:radial-gradient(at 50% 0,#ff2d2024 0%,#0000 65%);width:900px;height:700px;position:fixed;top:-200px;left:50%;transform:translate(-50%)}.wrapper{max-width:1280px;margin:0 auto}.wrapper-wide{max-width:1500px;margin:0 auto;padding:0 2rem}.flexy-wrapper{justify-content:space-between;align-items:center;width:100%;display:flex}.site-header,.site-nav{z-index:200;height:var(--header-h);border-bottom:1px solid var(--border);-webkit-backdrop-filter:blur(16px);background:#0a0a0fd1;justify-content:space-between;align-items:center;padding:0 1.75rem;transition:background-color .2s;display:flex;position:sticky;top:0}:root[data-theme=light] .site-header,:root[data-theme=light] .site-nav{background:#ffffffdb}.site-logo,.nav-logo{color:var(--text);flex-shrink:0;align-items:center;gap:10px;font-size:1.1rem;font-weight:700;display:flex}.site-logo span,.nav-logo span{color:var(--brand-red)}.nav-center,.header-nav{align-items:center;gap:1.5rem;display:flex}.nav-center{width:100%}.header-nav{flex-shrink:0;justify-content:flex-end;gap:1rem;margin-left:auto}.nav-center a,.header-nav a{color:var(--text-sub);font-size:.875rem;font-weight:500;transition:color .15s}.nav-center a:hover,.header-nav a:hover{color:var(--text)}.nav-actions{align-items:center;display:flex}.nav-left{gap:calc(var(--spacing) * 5)}.nav-right{gap:calc(var(--spacing) * 3)}.icon-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);background:0 0;flex-shrink:0;justify-content:center;align-items:center;width:34px;height:34px;transition:background .15s,color .15s,border-color .15s;display:flex}.icon-btn:hover{color:var(--text);border-color:var(--border-med);background:#ffffff0f}:root[data-theme=light] .icon-btn:hover{background:#0000000d}.github-badge{border:1px solid var(--border);color:var(--text-sub);border-radius:20px;align-items:center;gap:6px;padding:5px 11px;font-size:.78rem;font-weight:600;transition:border-color .15s,color .15s;display:flex}.github-badge:hover{border-color:var(--border-med);color:var(--text)}.github-badge svg{opacity:.7}.btn-primary,.cta-primary{background:var(--brand-red);border-radius:var(--radius-sm);white-space:nowrap;align-items:center;gap:7px;padding:7px 16px;font-size:.825rem;font-weight:600;transition:opacity .2s;display:inline-flex;color:#fff!important}.btn-primary:hover,.cta-primary:hover{opacity:.88}.cta-secondary{color:var(--text-sub);border-radius:var(--radius-md);border:1px solid var(--border-med);align-items:center;gap:7px;padding:12px 22px;font-size:.9rem;font-weight:600;transition:border-color .2s,color .2s,background .2s;display:inline-flex}.cta-secondary:hover{border-color:var(--border-med);color:var(--text);background:var(--bg-card)}.nav-divider{background:var(--border);width:1px;height:20px;margin:0 4px}.hamburger-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);background:0 0;flex-shrink:0;justify-content:center;align-items:center;width:36px;height:36px;transition:background .15s,color .15s;display:none}.hamburger-btn:hover{color:var(--text);background:#ffffff0f}.sidebar{top:var(--header-h);height:calc(100vh - var(--header-h));border-right:1px solid var(--border);scrollbar-width:thin;scrollbar-color:var(--border) transparent;width:var(--sidebar-w);padding:1.25rem .75rem;position:sticky;overflow-y:auto}.sidebar-section{margin-bottom:.125rem}.sidebar-summary{letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);-webkit-user-select:none;user-select:none;justify-content:space-between;align-items:center;padding:.35rem .5rem;font-size:.68rem;font-weight:700;list-style:none;transition:color .15s;display:flex}.sidebar-summary-content{align-items:center;gap:.4rem;display:flex}.sidebar-section-icon{opacity:.5;flex-shrink:0;align-items:center;transition:opacity .15s;display:flex}.sidebar-summary::-webkit-details-marker{display:none}.sidebar-summary:hover{color:var(--text)}.sidebar-section[open] .chevron{transform:rotate(90deg)}.chevron{color:var(--text-muted);flex-shrink:0;transition:transform .2s}.sidebar-list{padding:.25rem 0 .5rem .5rem;list-style:none}.sidebar-link{border-radius:var(--radius-sm);color:var(--text-muted);border-left:2px solid #0000;padding:.35rem .75rem;font-size:.875rem;transition:background .15s,color .15s,border-color .15s;display:block}.sidebar-link:hover{background:var(--bg-card);color:var(--text);border-left-color:var(--border-med)}.sidebar-link.active{color:var(--brand-red);border-left-color:var(--brand-red);background:#ff2d201a;font-weight:500}.sidebar-overlay{z-index:200;-webkit-backdrop-filter:blur(2px);background:#0009;position:fixed;inset:0}.mobile-nav-overlay{z-index:220;-webkit-backdrop-filter:blur(2px);background:#0000008c;position:fixed;inset:0}.mobile-nav-drawer{top:var(--header-h);width:min(320px,92vw);max-height:calc(100vh - var(--header-h));background:var(--bg);border-left:1px solid var(--border);border-bottom:1px solid var(--border);z-index:230;flex-direction:column;gap:.5rem;padding:1rem;display:flex;position:fixed;right:0;overflow-y:auto}.mobile-nav-link{border-radius:var(--radius-sm);border:1px solid var(--border);color:var(--text-sub);padding:.7rem .9rem;font-size:.9rem;font-weight:500;transition:background .15s,color .15s,border-color .15s;display:block}.mobile-nav-link:hover{color:var(--text);background:var(--bg-card);border-color:var(--border-med)}.hero{text-align:center;position:relative}.hero-badge{border:1px solid var(--brand-red-border);background:var(--brand-red-subtle);color:var(--brand-red);letter-spacing:.04em;border-radius:20px;align-items:center;gap:7px;margin-bottom:2rem;padding:4px 14px;font-size:.78rem;font-weight:600;display:inline-flex}.hero-badge svg{opacity:.8}.hero-left{text-align:start;max-width:746px;padding-bottom:calc(var(--spacing) * 52);padding-top:calc(var(--spacing) * 40);flex-direction:column;display:flex}.hero-right{justify-content:flex-start;width:50%;display:flex}.hero h1{font-size:clamp(var(--text-xl), 6vw, var(--text-7xl));font-weight:inherit;letter-spacing:-.04em;line-height:var(--text-7xl--line-height);background:linear-gradient(175deg, var(--text) 40%, #a1a1b566);-webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;margin-bottom:1.5rem}:root[data-theme=light] .hero h1{-webkit-text-fill-color:transparent;background:linear-gradient(175deg,#0f0f14 50%,#32325080);-webkit-background-clip:text;background-clip:text}.hero-sub{max-width:560px;color:var(--text-sub);text-wrap:balance;font-size:1.15rem;line-height:var(--text-xl--line-height);letter-spacing:var(--tracking-tight);margin-top:calc(var(--spacing) * 4)}.hero-cta{gap:calc(var(--spacing) * 4);margin-top:calc(var(--spacing) * 10);flex-flow:wrap;justify-content:flex-start;display:flex}.hero-visual{width:100%;max-width:450px}.hero-visual .code-window{background:var(--code-bg)}.hero .cta-primary{border-radius:var(--radius-md);padding:12px 26px;font-size:.9rem;transition:transform .2s,box-shadow .2s,opacity .2s;box-shadow:0 10px 30px -6px #ff2d2073}.hero .cta-primary:hover{opacity:1;transform:translateY(-2px);box-shadow:0 16px 36px -6px #ff2d208c}.code-window{background:var(--code-bg);border:1px solid var(--code-border);border-radius:var(--radius-lg);text-align:left;overflow:hidden;box-shadow:0 30px 80px -20px #0009}.code-titlebar{border-bottom:1px solid var(--code-border);background:#ffffff06;align-items:center;gap:6px;padding:12px 16px;display:flex}.dot{border-radius:50%;flex-shrink:0;width:11px;height:11px}.dot-red{background:#ff5f57}.dot-amber{background:#febc2e}.dot-green{background:#28c840}.code-filename{color:var(--text-muted);font-size:.72rem;font-family:var(--font-mono);margin-left:6px}.code-body{padding:1.25rem 1.5rem;overflow-x:auto}.code-body .header{text-align:center;margin-bottom:var(--spacing-xl)}.code-body .logo-container{margin-bottom:var(--spacing-md);display:inline-block}.code-body .header h1{margin-bottom:5px;font-size:18px;font-weight:500}.code-body .header p{font-size:14px}.code-pre{font-family:var(--font-mono);color:var(--code-text);font-size:.82rem;line-height:1.65}.kw{color:var(--code-kw)}.fn{color:var(--code-fn)}.str{color:var(--code-str)}.cmt{color:var(--code-cmt);font-style:italic}.ty{color:var(--code-ty)}.num{color:var(--code-num)}.punc{color:var(--code-punc)}.code-tabs{border-bottom:1px solid var(--code-border);background:#ffffff05;gap:4px;padding:0 1rem;display:grid}.code-tab{font-size:.78rem;font-family:var(--font-mono);color:var(--text-muted);cursor:pointer;background:0 0;border:none;padding:9px 14px;transition:color .15s,border-color .15s}.code-tab.active{color:var(--text);border-bottom-color:var(--brand-red)}.code-tab:hover{color:var(--text-sub)}.grid{gap:var(--spacing-xl);grid-template-columns:repeat(2,1fr);display:grid}.card{background:var(--bg-card);border:1px solid var(--border);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);padding:var(--spacing-sm);color:inherit;border-radius:1rem;text-decoration:none;transition:all .3s cubic-bezier(.4,0,.2,1);position:relative;overflow:hidden}.flexy-card{align-items:center;gap:1.5rem;display:flex}.card:hover{border-color:#ff2d2066;transform:translateY(-2px)}.card:hover .icon-box{background:var(--brand-red);color:#fff}.icon-box{width:40px;height:40px;color:var(--brand-red);background:#1e293b;border-radius:8px;justify-content:center;align-items:center;margin-bottom:1.25rem;transition:background .3s;display:flex}.card h2{font-size:18px;font-weight:600}.card p{color:var(--text-muted);font-size:.9375rem;line-height:1.6}.version-tag{color:var(--brand-red);background:#ff2d201a;border-radius:9999px;margin-top:1rem;padding:.25rem .75rem;font-size:.75rem;font-weight:600;display:inline-block}.trust-bar{border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:40px 0}.trust-label{text-align:center;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1.5rem;font-size:.72rem;font-weight:600}.trust-logos{flex-wrap:wrap;justify-content:center;align-items:center;gap:2.5rem;display:flex}.trust-logo{color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;opacity:.55;font-size:.92rem;font-weight:700;transition:opacity .2s}.trust-logo:hover{opacity:.9}.pitch{border-top-width:0;position:relative}.pitch .wrapper{position:revert-layer;padding-top:calc(var(--spacing) * 16);border:1px solid var(--code-border);border-color:var(--code-border);border-top:none}.pitch-grid{grid-template-columns:1fr 1fr;align-items:center;gap:64px;display:grid}.pitch-panel{padding-inline:calc(var(--spacing) * 4);padding-right:0}.pitch-left-panel{padding-right:0;padding-left:calc(var(--spacing) * 12)}.pitch-right-panel{min-width:calc(var(--spacing) * 0);flex-grow:1}.pitch-label{letter-spacing:.1em;text-transform:uppercase;color:var(--brand-red);margin-bottom:1rem;font-size:.72rem;font-weight:700}.pitch-title{letter-spacing:-.03em;margin-bottom:1.25rem;font-size:clamp(1.6rem,3vw,2.4rem);font-weight:800;line-height:1.2}.pitch-text{color:var(--text-sub);margin-bottom:2rem;font-size:1rem;line-height:1.75}.feature-list{flex-direction:column;gap:.75rem;list-style:none;display:flex}.feature-list li{align-items:flex-start;gap:calc(var(--spacing) * 2.5);color:var(--text-sub);font-size:.9rem;line-height:1.5;display:flex}.feature-list li svg{color:var(--brand-red);flex-shrink:0;margin-top:1px}.pitch-link,.link-arrow{color:var(--brand-red);align-items:center;gap:6px;margin-top:2rem;font-size:.875rem;font-weight:600;transition:gap .2s;display:inline-flex}.pitch-link:hover,.link-arrow:hover{gap:10px}.section-eyebrow{letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);align-items:center;gap:10px;margin-bottom:1rem;font-size:.72rem;font-weight:700;display:flex}.section-eyebrow:before,.section-eyebrow:after{content:"";background:var(--border);flex:1;height:1px}.section-title{letter-spacing:-.03em;text-align:center;margin-bottom:.75rem;font-size:clamp(1.8rem,3.5vw,2.6rem);font-weight:800;line-height:1.2}.section-sub{text-align:center;color:var(--text-sub);max-width:520px;margin:0 auto 3.5rem;font-size:1rem;line-height:1.75}.bento{padding:80px 0}.bento-grid{grid-template-rows:auto;grid-template-columns:repeat(12,1fr);gap:1.25rem;display:grid}.bento-card{padding:2rem;transition:border-color .25s,background .25s,transform .25s;position:relative;overflow:hidden}.bento-full{grid-column:span 12}.bento-8{grid-column:span 8}.bento-4{grid-column:span 4}.bento-6{grid-column:span 6}.bento-7{grid-column:span 7}.bento-5{grid-column:span 5}.bento-card-label{letter-spacing:.1em;text-transform:uppercase;color:var(--brand-red);text-align:left;margin-bottom:.75rem;font-size:.7rem;font-weight:700}.bento-card-title{letter-spacing:-.02em;margin-bottom:.75rem;font-size:1.2rem;font-weight:700;line-height:1.3}.bento-card-text{color:var(--text-sub);text-align:left;max-width:460px;font-size:.875rem;line-height:1.7}.bento-card-link{color:var(--brand-red);align-items:center;gap:5px;margin-top:1.5rem;font-size:.8rem;font-weight:600;transition:gap .2s;display:inline-flex}.bento-card-link:hover{gap:8px}.bento-icon{background:var(--brand-red-subtle);width:40px;height:40px;color:var(--brand-red);border:1px solid var(--brand-red-border);border-radius:11px;justify-content:center;align-items:center;margin-bottom:1.25rem;display:flex}.bento-code{background:var(--code-bg);border:1px solid var(--code-border);border-radius:var(--radius-md);margin-top:1.25rem;padding:1rem 1.25rem;overflow-x:auto}.bento-code pre{font-family:var(--font-mono);color:var(--code-text);font-size:.78rem;line-height:1.6}.partner-logos{flex-direction:column;gap:8px;margin-top:1.5rem;display:flex}.partner-item{border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-raised);color:var(--text-sub);align-items:center;gap:10px;padding:9px 14px;font-size:.82rem;font-weight:600;transition:border-color .2s,color .2s;display:flex}.partner-item:hover{border-color:var(--border-med);color:var(--text)}.partner-item svg{color:var(--text-muted)}.bento-checks{flex-direction:column;gap:.6rem;margin-top:1.25rem;list-style:none;display:flex}.bento-checks li{color:var(--text-sub);align-items:center;gap:8px;font-size:.875rem;display:flex}.bento-checks li svg{color:var(--brand-red);flex-shrink:0}.cta-band{text-align:center;padding:100px 0;position:relative}.cta-band h2{letter-spacing:-.04em;background:linear-gradient(175deg, var(--text) 40%, #a1a1b566);-webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;margin-bottom:1rem;font-size:clamp(2.2rem,5vw,3.8rem);font-weight:800;line-height:1.1}:root[data-theme=light] .cta-band h2{-webkit-text-fill-color:transparent;background:linear-gradient(175deg,#0f0f14 60%,#32325080);-webkit-background-clip:text;background-clip:text}.cta-band p{color:var(--text-sub);max-width:480px;margin-bottom:2.5rem;margin-left:auto;margin-right:auto;font-size:1.05rem}.cta-band-actions{flex-wrap:wrap;justify-content:center;gap:14px;display:flex}.testimonials{border-top:1px solid var(--border);padding:80px 0}.testimonials-grid{grid-template-columns:repeat(3,1fr);gap:1.25rem;display:grid}.testimonial-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.75rem;transition:border-color .25s}.testimonial-card:hover{border-color:var(--border-med)}.testimonial-card.featured{background:linear-gradient(135deg, var(--bg-card) 0%, #ff2d200a 100%);border-color:var(--brand-red-border)}.testimonial-card blockquote{color:var(--text-sub);margin-bottom:1.25rem;font-size:.9rem;line-height:1.7}.testimonial-author{align-items:center;gap:10px;display:flex}.testimonial-avatar{background:var(--brand-red-subtle);border:1px solid var(--brand-red-border);width:36px;height:36px;color:var(--brand-red);border-radius:50%;flex-shrink:0;justify-content:center;align-items:center;font-size:.8rem;font-weight:700;display:flex}.testimonial-name{color:var(--text);font-size:.82rem;font-weight:700}.testimonial-role{color:var(--text-muted);font-size:.75rem}.community{border-top:1px solid var(--border);padding:80px 0}.community-grid{grid-template-columns:1fr 1fr;gap:1.25rem;display:grid}.community-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-xl);padding:2.5rem;transition:border-color .25s,background .25s}.community-card:hover{border-color:var(--border-med);background:var(--bg-card-hover)}.community-card h3{letter-spacing:-.02em;margin-bottom:.75rem;font-size:1.4rem;font-weight:700}.community-card p{color:var(--text-sub);margin-bottom:1.5rem;font-size:.9rem;line-height:1.7}.layout{grid-template-columns:var(--sidebar-w) 1fr 200px;min-height:calc(100vh - var(--header-h));max-width:1500px;margin:0 auto;display:grid}.main{min-width:0;padding:2rem 2.5rem}article{max-width:720px}article h1,article h2,article h3,article h4{color:var(--text);margin-top:2.5rem;margin-bottom:.75rem;font-weight:700;line-height:1.3}article h1{margin-top:0;font-size:2rem}article h2{border-bottom:1px solid var(--border);padding-bottom:.5rem;font-size:1.4rem}article h3{font-size:1.15rem}article h4{font-size:1rem}article h2,article h3,article h4,article a[name]{scroll-margin-top:calc(var(--header-h) + 1.25rem)}article>ul:first-of-type:has(>li>a[href^=\\#]){display:none}article p{color:var(--text-muted);margin-bottom:1rem;line-height:1.8}article a{color:var(--brand-red)}article a:hover{text-decoration:underline}article ul,article ol{color:var(--text-muted);margin:.75rem 0 1rem 1.5rem;line-height:1.8}article li{margin-bottom:.25rem}article code{font-family:var(--font-mono);background:var(--bg-card);border:1px solid var(--border);color:#e879f9;border-radius:4px;padding:.1em .4em;font-size:.875em}article pre{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);margin:1rem 0 1.5rem;padding:1.25rem 1.5rem;position:relative;overflow-x:auto}.copy-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;opacity:0;background:#ffffff0f;border-radius:6px;align-items:center;gap:4px;padding:4px 10px;font-family:inherit;font-size:.72rem;transition:opacity .15s,background .15s,color .15s,border-color .15s;display:flex;position:absolute;top:.5rem;right:.5rem}article pre:hover .copy-btn{opacity:1}.copy-btn:hover{color:var(--text);background:#ffffff1a}.copy-btn.copied{color:#22c55e;opacity:1;border-color:#22c55e4d}article pre code{color:inherit;background:0 0;border:none;padding:0;font-size:.875rem}.example-output{border:1px solid var(--border);border-radius:8px;margin:1rem 0 1.5rem;overflow:hidden}.run-btn{background:var(--bg-card);border:none;border-bottom:1px solid var(--border);width:100%;color:var(--text-muted);cursor:pointer;text-align:left;align-items:center;gap:.4rem;padding:.45rem 1rem;font-family:inherit;font-size:.82rem;transition:background .15s,color .15s;display:inline-flex}.run-btn:hover{color:var(--text);background:#ffffff0d}.run-btn .run-icon{color:var(--brand-red);font-style:normal}.output-console{position:relative;overflow-x:auto;color:#c9d1d9!important;background:#0d1117!important;border:none!important;border-radius:0!important;margin:0!important;padding:1rem 1.25rem!important;font-size:.825rem!important}.output-console .copy-btn{display:none}article blockquote{border-left:3px solid var(--brand-red);color:var(--text-muted);background:var(--bg-card);border-radius:0 8px 8px 0;margin:1.25rem 0;padding:.5rem 1rem;font-style:italic}article hr{border:none;border-top:1px solid var(--border);margin:2rem 0}article table{border-collapse:collapse;border:1px solid var(--border);border-radius:8px;width:100%;margin:1rem 0;font-size:.875rem;overflow:hidden}article th,article td{border-bottom:1px solid var(--border);text-align:left;padding:.6rem .75rem}article th{background:var(--bg-card);color:var(--text);letter-spacing:.04em;text-transform:uppercase;font-size:.8rem;font-weight:600}article td{color:var(--text-muted)}.meta{border-top:1px solid var(--border);color:var(--text-muted);margin-top:2rem;padding-top:1.5rem;font-size:.8rem}.toc{top:calc(var(--header-h) + 1.5rem);max-height:calc(100vh - var(--header-h) - 3rem);scrollbar-width:thin;scrollbar-color:var(--border) transparent;padding:1.5rem 1rem;position:sticky;overflow-y:auto}.toc-title{letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);align-items:center;gap:.4rem;margin-bottom:.75rem;font-size:.68rem;font-weight:700;display:flex}.toc-list,.toc-sub{padding:0;list-style:none}.toc-sub{padding-left:.75rem}.toc-link{color:var(--text-muted);border-left:2px solid #ffffff0f;padding:.25rem 0 .25rem .75rem;font-size:.8rem;line-height:1.4;transition:color .15s,border-color .15s;display:block}.toc-link:hover{color:var(--text);border-left-color:#ffffff2e}.toc-link.active{color:var(--text);border-left-color:var(--brand-red);font-weight:600}.search-btn{align-items:center;gap:calc(var(--spacing) * 2);color:var(--text-muted);min-width:calc(var(--spacing) * 40);cursor:pointer;transition:background .15s,color .15s;display:inline-flex}.search-btn:hover{color:var(--text);background:#ffffff0f}.search-modal-overlay{z-index:300;-webkit-backdrop-filter:blur(4px);background:#000000b3;justify-content:center;align-items:flex-start;padding-top:15vh;display:flex;position:fixed;inset:0}.search-modal{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-lg);width:min(560px,100vw - 2rem);overflow:hidden;box-shadow:0 25px 50px -12px #0009}.search-input-wrap{border-bottom:1px solid var(--border);color:var(--text-muted);align-items:center;gap:.75rem;padding:1rem 1.25rem;display:flex}.search-input-wrap input{color:var(--text);background:0 0;border:none;outline:none;flex:1;font-family:inherit;font-size:1rem}.search-input-wrap input::placeholder{color:var(--text-muted)}.search-results{max-height:360px;padding:.5rem;overflow-y:auto}.search-result-list{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.search-result-item{border-radius:8px;transition:background .1s}.search-result-item:hover,.search-result-active{background:var(--bg-raised)}.search-result-link{color:inherit;border-radius:8px;outline:none;flex-direction:column;gap:2px;padding:10px 12px;text-decoration:none;display:flex}.search-result-link:focus-visible{box-shadow:0 0 0 2px var(--brand-red)}.search-result-title{color:var(--text);font-size:.875rem;font-weight:500;line-height:1.3}.search-result-section{color:var(--brand-red);text-transform:uppercase;letter-spacing:.04em;font-size:.75rem;font-weight:500;line-height:1.2}.search-result-excerpt{color:var(--text-muted);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:.8rem;line-height:1.5;display:-webkit-box;overflow:hidden}.search-result-excerpt mark,.search-result-title mark,.search-result-section mark{color:var(--brand-red);background:0 0;font-weight:600}.search-empty{text-align:center;color:var(--text-muted);padding:1.5rem 1rem;font-size:.875rem}.site-footer{border-top:1px solid var(--border);padding:64px 0 40px}.footer-top{grid-template-columns:220px repeat(4,1fr);gap:48px;margin-bottom:56px;display:grid}.footer-brand p{color:var(--text-muted);max-width:180px;margin-top:.75rem;font-size:.825rem;line-height:1.7}.footer-social{gap:8px;margin-top:1.25rem;display:flex}.footer-col h4{letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1rem;font-size:.7rem;font-weight:700}.footer-col ul{flex-direction:column;gap:.625rem;list-style:none;display:flex}.footer-col a{color:var(--text-sub);font-size:.85rem;transition:color .15s}.footer-col a:hover{color:var(--text)}.footer-bottom{border-top:1px solid var(--border);color:var(--text-muted);justify-content:space-between;align-items:center;padding-top:32px;font-size:.8rem;display:flex}.footer-bottom-links{gap:1.5rem;display:flex}.footer-bottom-links a{color:var(--text-muted);font-size:.8rem;transition:color .15s}.footer-bottom-links a:hover{color:var(--text-sub)}.footer{text-align:center;color:var(--text-muted);margin-top:2rem;font-size:.875rem}}@layer utilities{.collapse{visibility:collapse}.invisible{visibility:hidden}.visible{visibility:visible}.absolute{position:absolute}.fixed{position:fixed}.relative{position:relative}.static{position:static}.sticky{position:sticky}.start{inset-inline-start:var(--spacing)}.end{inset-inline-end:var(--spacing)}.isolate{isolation:isolate}.container{width:100%}@media (min-width:40rem){.container{max-width:40rem}}@media (min-width:48rem){.container{max-width:48rem}}@media (min-width:64rem){.container{max-width:64rem}}@media (min-width:80rem){.container{max-width:80rem}}@media (min-width:96rem){.container{max-width:96rem}}.mx-auto{margin-inline:auto}.mt-8{margin-top:calc(var(--spacing) * 8)}.block{display:block}.contents{display:contents}.flex{display:flex}.grid{display:grid}.hidden{display:none}.inline{display:inline}.table{display:table}.w-full{width:100%}.max-w-2xl{max-width:var(--container-2xl)}.max-w-3xl{max-width:var(--container-3xl)}.max-w-7xl{max-width:var(--container-7xl)}.max-w-\\[1440px\\]{max-width:1440px}.max-w-full{max-width:100%}.min-w-0{min-width:calc(var(--spacing) * 0)}.flex-shrink{flex-shrink:1}.flex-grow,.grow{flex-grow:1}.border-collapse{border-collapse:collapse}.transform{transform:var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)}.resize{resize:both}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-start{align-items:flex-start}.justify-between{justify-content:space-between}.gap-4{gap:calc(var(--spacing) * 4)}.gap-5{gap:calc(var(--spacing) * 5)}.truncate{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.overflow-x-auto{overflow-x:auto}.border{border-style:var(--tw-border-style);border-width:1px}.mask-repeat{-webkit-mask-repeat:repeat;mask-repeat:repeat}.px-4{padding-inline:calc(var(--spacing) * 4)}.py-10{padding-block:calc(var(--spacing) * 10)}.text-center{text-align:center}.text-justify{text-align:justify}.text-wrap{text-wrap:wrap}.capitalize{text-transform:capitalize}.lowercase{text-transform:lowercase}.uppercase{text-transform:uppercase}.italic{font-style:italic}.ordinal{--tw-ordinal:ordinal;font-variant-numeric:var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,)}.overline{text-decoration-line:overline}.underline{text-decoration-line:underline}.shadow{--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.ring{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.outline{outline-style:var(--tw-outline-style);outline-width:1px}.invert{--tw-invert:invert(100%);filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.filter{filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.backdrop-filter{-webkit-backdrop-filter:var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);backdrop-filter:var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,)}.transition{transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to,opacity,box-shadow,transform,translate,scale,rotate,filter,-webkit-backdrop-filter,backdrop-filter,display,content-visibility,overlay,pointer-events;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}@media (min-width:40rem){.sm\\:px-6{padding-inline:calc(var(--spacing) * 6)}}@media (min-width:48rem){.md\\:col-span-2{grid-column:span 2/span 2}.md\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.md\\:flex-row{flex-direction:row}.md\\:items-center{align-items:center}}@media (min-width:64rem){.lg\\:px-8{padding-inline:calc(var(--spacing) * 8)}.lg\\:py-14{padding-block:calc(var(--spacing) * 14)}}}@media (max-width:1100px){.layout{grid-template-columns:var(--sidebar-w) 1fr}.toc{display:none}}@media (max-width:1024px){.site-nav,.site-header{padding:0 1rem}.nav-center,.search-btn-text,.search-btn-keys{display:none}.home-search-btn{min-width:auto}.hamburger-btn{display:flex}.pitch-grid{grid-template-columns:1fr;gap:40px}.bento-8,.bento-4,.bento-7,.bento-5{grid-column:span 12}.footer-top{grid-template-columns:1fr 1fr;gap:32px}.footer-brand{grid-column:span 2}.testimonials-grid{grid-template-columns:1fr 1fr}}@media (max-width:768px){.site-nav,.site-header{padding:0 1rem}.nav-center,.search-btn-text,.search-btn-keys{display:none}.home-search-btn{min-width:auto}.hamburger-btn{display:flex}.header-nav>a:not(.btn-primary){display:none}.layout{grid-template-columns:1fr}.sidebar{width:min(var(--sidebar-w), 85vw);z-index:250;background:var(--bg);height:100vh;padding-top:1rem;transition:transform .3s;position:fixed;top:0;left:0;transform:translate(-100%)}.sidebar-open .sidebar{transform:translate(0)}.hero{padding:64px 0 56px}.hero-left{padding-top:3rem;padding-bottom:1.5rem}.hero h1{font-size:2.4rem}.bento-6{grid-column:span 12}.community-grid,.testimonials-grid{grid-template-columns:1fr}.footer-top{grid-template-columns:1fr 1fr}.footer-brand{grid-column:span 2}.footer-bottom{text-align:center;flex-direction:column;gap:1rem}.trust-logos{gap:1.5rem}.main{padding:1.5rem 1rem}}@media (max-width:520px){.wrapper{padding:0 1rem}.hero-cta{flex-direction:column;align-items:stretch}.cta-primary,.cta-secondary{justify-content:center}.footer-top{grid-template-columns:1fr}.footer-brand{grid-column:auto}.cta-band-actions{flex-direction:column;align-items:center}}@media (max-width:640px){.grid{grid-template-columns:1fr}}@property --tw-rotate-x{syntax:"*";inherits:false}@property --tw-rotate-y{syntax:"*";inherits:false}@property --tw-rotate-z{syntax:"*";inherits:false}@property --tw-skew-x{syntax:"*";inherits:false}@property --tw-skew-y{syntax:"*";inherits:false}@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-ordinal{syntax:"*";inherits:false}@property --tw-slashed-zero{syntax:"*";inherits:false}@property --tw-numeric-figure{syntax:"*";inherits:false}@property --tw-numeric-spacing{syntax:"*";inherits:false}@property --tw-numeric-fraction{syntax:"*";inherits:false}@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-shadow-color{syntax:"*";inherits:false}@property --tw-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-inset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-shadow-color{syntax:"*";inherits:false}@property --tw-inset-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-ring-color{syntax:"*";inherits:false}@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-ring-color{syntax:"*";inherits:false}@property --tw-inset-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-ring-inset{syntax:"*";inherits:false}@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}@property --tw-ring-offset-color{syntax:"*";inherits:false;initial-value:#fff}@property --tw-ring-offset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-outline-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-blur{syntax:"*";inherits:false}@property --tw-brightness{syntax:"*";inherits:false}@property --tw-contrast{syntax:"*";inherits:false}@property --tw-grayscale{syntax:"*";inherits:false}@property --tw-hue-rotate{syntax:"*";inherits:false}@property --tw-invert{syntax:"*";inherits:false}@property --tw-opacity{syntax:"*";inherits:false}@property --tw-saturate{syntax:"*";inherits:false}@property --tw-sepia{syntax:"*";inherits:false}@property --tw-drop-shadow{syntax:"*";inherits:false}@property --tw-drop-shadow-color{syntax:"*";inherits:false}@property --tw-drop-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-drop-shadow-size{syntax:"*";inherits:false}@property --tw-backdrop-blur{syntax:"*";inherits:false}@property --tw-backdrop-brightness{syntax:"*";inherits:false}@property --tw-backdrop-contrast{syntax:"*";inherits:false}@property --tw-backdrop-grayscale{syntax:"*";inherits:false}@property --tw-backdrop-hue-rotate{syntax:"*";inherits:false}@property --tw-backdrop-invert{syntax:"*";inherits:false}@property --tw-backdrop-opacity{syntax:"*";inherits:false}@property --tw-backdrop-saturate{syntax:"*";inherits:false}@property --tw-backdrop-sepia{syntax:"*";inherits:false}@property --tw-font-weight{syntax:"*";inherits:false}@property --tw-tracking{syntax:"*";inherits:false}@property --tw-duration{syntax:"*";inherits:false}@property --tw-ease{syntax:"*";inherits:false}
</style>

  <!-- Prevent flash of unstyled content when light theme is stored -->
  <script>
    (function() {
      var t = localStorage.getItem('`;
  __o += __e(site.themeStorageKey);
  __o += `');
      if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    })();
  </script>
  <script defer src="`;
  __o += __e(site.cdn.alpine);
  __o += `"></script>
</head>
<body 
:class="{ 'sidebar-open': sidebarOpen }"
  x-data="{
    theme: localStorage.getItem('`;
  __o += __e(site.themeStorageKey);
  __o += `') || 'dark',
    sidebarOpen: false,
    searchOpen: false,
    init() {
      this.applyTheme(this.theme);
      this.$watch('theme', t => { localStorage.setItem('`;
  __o += __e(site.themeStorageKey);
  __o += `', t); this.applyTheme(t); });
    },
    applyTheme(t) {
      t === 'light'
        ? document.documentElement.setAttribute('data-theme', 'light')
        : document.documentElement.removeAttribute('data-theme');
      var dark = document.getElementById('hljs-dark');
      var light = document.getElementById('hljs-light');
      if (dark && light) { dark.disabled = (t === 'light'); light.disabled = (t !== 'light'); }
    },
    toggleTheme() { this.theme = this.theme === 'light' ? 'dark' : 'light'; }
  }"



  @keydown
  .escape.window="sidebarOpen = false; searchOpen = false"
>
<div class="ambient-glow"></div>



  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     DOCS HEADER / NAVIGATION
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->

<header class="site-header">
  <a href="`;
  __o += __e(site.nav.home);
  __o += `" class="site-logo">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF2D20" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
    `;
  __o += String(site.logoHtml ?? "");
  __o += `
  </a>

  <nav class="header-nav" aria-label="
${__t("aria.documentation_nav")}
">
    <a href="`;
  __o += __e(site.nav.docs);
  __o += `">
${__t("nav.documentation")}
</a>
    <a href="`;
  __o += __e(site.github);
  __o += `" target="_blank" rel="noopener">
${__t("nav.github")}
</a>

    <button 
@click
="searchOpen = true" class="icon-btn search-btn" aria-label="
${__t("aria.search")}
">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    </button>

    <button 
@click
="toggleTheme()" class="icon-btn" aria-label="
${__t("aria.theme_toggle")}
">
      <svg class="icon-moon" x-show="theme === 'dark'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
      <svg class="icon-sun" x-show="theme === 'light'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
        <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    </button>

    <a href="`;
  __o += __e(site.nav.installation);
  __o += `" class="btn-primary">
${__t("nav.get_started")}
</a>
  </nav>

  <button 
@click
="sidebarOpen = !sidebarOpen" class="hamburger-btn" aria-label="
${__t("aria.toggle_nav")}
">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/>
    </svg>
  </button>
</header>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     SEARCH MODAL
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->

<div
  x-show="searchOpen"
  @click.self="searchOpen = false"
  class="search-modal-overlay"
  style="display: none"
  role="dialog"
  aria-modal="true"
  aria-label="${__t("aria.search_dialog")}"
>
  <div class="search-modal">
    <div class="search-input-wrap">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        id="search-input"
        placeholder="${__t("page.search_placeholder")}"
        autocomplete="off"
        x-init="$watch('searchOpen', v => v && $nextTick(() => $el.focus()))"
      />
    </div>
    <div id="search-results" class="search-results" aria-live="polite"></div>
  </div>
</div>

  <div x-show="sidebarOpen" @click="sidebarOpen = false" class="sidebar-overlay" style="display: none"></div>

  <main class="docs-unavailable mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
    <section class="docs-unavailable-card mx-auto w-full max-w-2xl" role="status">
      <h1 class="unavailable-title">

  ${__t("docs.unavailable_title")}
  </h1>
        <p class="unavailable-message">

  ${__t("docs.unavailable_message")}
  </p>
        <a href="`;
  __o += __e(site.nav.home);
  __o += `" class="unavailable-link">


  ${__t("docs.back_home")}
      </a>
    </section>
  </main>
<script>
;(function () {
  "use strict"

  // \u2500\u2500 Keyboard shortcut: Cmd+K / Ctrl+K \u2192 open search modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault()
      var body = document.body
      if (body._x_dataStack) {
        var alpine = body._x_dataStack[0]
        if (alpine && typeof alpine.searchOpen !== "undefined") {
          alpine.searchOpen = true
          return
        }
      }
      var overlay = document.querySelector(".search-modal-overlay")
      if (overlay) overlay.style.display = ""
      var input = document.getElementById("search-input")
      if (input) input.focus()
    }
  })
})()

</script>
  <script>
/* \u2500\u2500 docs.js \u2014 LumiARQ docs page scripts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Loaded via @scripts('docs.js') in docs-page.veil.html
 * Inlined into the page bundle at build time by the Veil compiler.
 * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

;(function () {
  'use strict';

  /* \u2500\u2500 <run-example> custom element upgrade \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  document.querySelectorAll('run-example').forEach(function (el) {
    var text = el.textContent.trim();
    var wrapper = document.createElement('div');
    wrapper.className = 'example-output';

    var btn = document.createElement('button');
    btn.className = 'run-btn';
    btn.setAttribute('type', 'button');
    btn.innerHTML = '<em class="run-icon">\u25B6</em> <span class="run-label">Run example</span>';

    var output = document.createElement('pre');
    output.className = 'output-console';
    output.textContent = text;
    output.hidden = true;

    btn.addEventListener('click', function () {
      output.hidden = !output.hidden;
      btn.querySelector('.run-label').textContent = output.hidden ? 'Run example' : 'Hide output';
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(output);
    el.replaceWith(wrapper);
  });

  /* \u2500\u2500 TOC active-section tracking \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  var tocLinks = document.querySelectorAll('.toc-link');
  if (tocLinks.length) {
    var HEADER_H = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h') || '60', 10
    );
    var OFFSET = HEADER_H + 20;

    var linkMap = {};
    tocLinks.forEach(function (link) {
      var id = (link.getAttribute('href') || '').replace(/^#/, '');
      if (id) linkMap[id] = link;
    });

    var article = document.querySelector('article');
    if (article) {
      var targets = Array.from(article.querySelectorAll('a[name]'));
      if (!targets.length) targets = Array.from(article.querySelectorAll('h2[id], h3[id]'));

      if (targets.length) {
        var activeLink = null;
        var rafPending = false;

        function setActive(link) {
          if (activeLink === link) return;
          if (activeLink) activeLink.classList.remove('active');
          activeLink = link;
          if (link) link.classList.add('active');
        }

        function update() {
          rafPending = false;
          var scrollY = window.scrollY;
          var threshold = scrollY + OFFSET;
          var best = null;

          for (var i = targets.length - 1; i >= 0; i--) {
            var el = targets[i];
            var absTop = el.getBoundingClientRect().top + scrollY;
            if (absTop <= threshold) { best = el; break; }
          }
          if (!best) best = targets[0];

          var id = best && (best.id || best.getAttribute('name'));
          setActive(id && linkMap[id] ? linkMap[id] : null);
        }

        window.addEventListener('scroll', function () {
          if (!rafPending) { rafPending = true; requestAnimationFrame(update); }
        }, { passive: true });

        update();
      }
    }
  }

  /* \u2500\u2500 Copy-to-clipboard for code blocks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  var copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var checkIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  document.querySelectorAll('article pre:not(.output-console)').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = copyIcon + '<span>Copy</span>';

    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      var text = code ? code.innerText : pre.innerText;

      function showCopied() {
        btn.classList.add('copied');
        btn.innerHTML = checkIcon + '<span>Copied!</span>';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML = copyIcon + '<span>Copy</span>';
        }, 2000);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); showCopied(); } catch (_) {}
        document.body.removeChild(ta);
      }
    });

    pre.appendChild(btn);
  });

  /* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     ALGOLIA-STYLE CLIENT SEARCH
     \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
     - Lazy-fetches /api/search-index on first Cmd+K / modal open
     - Scores: title (4\xD7) > section (2\xD7) > description (2\xD7) > excerpt (1.5\xD7) > body (1\xD7)
     - Highlights matched terms in results
     - Keyboard navigation: \u2191\u2193 to move, Enter to go, Esc to close
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
  (function () {
    var searchInput   = document.getElementById('search-input');
    var searchResults = document.getElementById('search-results');
    if (!searchInput || !searchResults) return;

    var searchIndex  = null;   // lazy-loaded
    var indexLoading = false;
    var debounceTimer = null;
    var activeIdx = -1;

    // \u2500\u2500 Load index \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function loadIndex(cb) {
      if (searchIndex) { cb(searchIndex); return; }
      if (indexLoading) { setTimeout(function () { loadIndex(cb); }, 100); return; }
      indexLoading = true;
      fetch('/api/search-index')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          searchIndex = data.pages || [];
          indexLoading = false;
          cb(searchIndex);
        })
        .catch(function () {
          searchIndex = [];
          indexLoading = false;
          cb(searchIndex);
        });
    }

    // \u2500\u2500 Scoring \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function score(page, terms) {
      var s = 0;
      terms.forEach(function (t) {
        var re = new RegExp(t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'gi');
        var titleMatches   = (page.title       || '').match(re);
        var sectionMatches = (page.section     || '').match(re);
        var descMatches    = (page.description || '').match(re);
        var excerptMatches = (page.excerpt     || '').match(re);
        var bodyMatches    = (page.body        || '').match(re);
        s += (titleMatches   ? titleMatches.length   * 4   : 0);
        s += (sectionMatches ? sectionMatches.length * 2   : 0);
        s += (descMatches    ? descMatches.length    * 2   : 0);
        s += (excerptMatches ? excerptMatches.length * 1.5 : 0);
        s += (bodyMatches    ? bodyMatches.length    * 1   : 0);
      });
      return s;
    }

    // \u2500\u2500 Highlight \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function highlight(text, terms) {
      if (!text) return '';
      var safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      terms.forEach(function (t) {
        var re = new RegExp('(' + t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
        safe = safe.replace(re, '<mark>$1</mark>');
      });
      return safe;
    }

    // \u2500\u2500 Snippet: find the most relevant sentence containing a term \u2500\u2500\u2500\u2500\u2500\u2500
    function snippet(text, terms, maxLen) {
      maxLen = maxLen || 160;
      if (!text) return '';
      var lower = text.toLowerCase();
      var best = -1;
      terms.forEach(function (t) {
        var i = lower.indexOf(t.toLowerCase());
        if (i !== -1 && (best === -1 || i < best)) best = i;
      });
      if (best === -1) return text.slice(0, maxLen);
      var start = Math.max(0, best - 60);
      var end   = Math.min(text.length, start + maxLen);
      var raw   = (start > 0 ? '\u2026' : '') + text.slice(start, end) + (end < text.length ? '\u2026' : '');
      return raw;
    }

    // \u2500\u2500 Render results \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function renderResults(pages, terms) {
      activeIdx = -1;
      if (!pages.length) {
        searchResults.innerHTML = '<p class="search-empty">No results found.</p>';
        return;
      }
      var html = '<ul class="search-result-list" role="listbox">';
      pages.slice(0, 8).forEach(function (page, i) {
        var href    = page.slug === 'index'
          ? '/docs/' + page.version
          : '/docs/' + page.version + '/' + page.slug;
        var snip    = snippet(page.body || page.excerpt || '', terms);
        html += '<li class="search-result-item" role="option" data-idx="' + i + '" data-href="' + href + '">' +
          '<a href="' + href + '" class="search-result-link" tabindex="-1">' +
            '<span class="search-result-title">' + highlight(page.title, terms) + '</span>' +
            (page.section ? '<span class="search-result-section">' + highlight(page.section, terms) + '</span>' : '') +
            (snip ? '<span class="search-result-excerpt">' + highlight(snip, terms) + '</span>' : '') +
          '</a>' +
        '</li>';
      });
      html += '</ul>';
      searchResults.innerHTML = html;

      // click handler
      searchResults.querySelectorAll('.search-result-item').forEach(function (item) {
        item.addEventListener('mousedown', function (e) {
          e.preventDefault();
          window.location.href = item.getAttribute('data-href');
        });
      });
    }

    // \u2500\u2500 Keyboard nav \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function getItems() {
      return Array.from(searchResults.querySelectorAll('.search-result-item'));
    }

    function setActiveItem(idx) {
      var items = getItems();
      items.forEach(function (el) { el.classList.remove('search-result-active'); });
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add('search-result-active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
      activeIdx = idx;
    }

    searchInput.addEventListener('keydown', function (e) {
      var items = getItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveItem(Math.min(activeIdx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveItem(Math.max(activeIdx - 1, 0));
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && items[activeIdx]) {
          var href = items[activeIdx].getAttribute('data-href');
          if (href) window.location.href = href;
        }
      }
    });

    // \u2500\u2500 Search \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function doSearch(query) {
      var q = query.trim();
      if (!q) { searchResults.innerHTML = ''; return; }

      var terms = q.toLowerCase().split(/\\s+/).filter(Boolean);

      loadIndex(function (index) {
        var scored = index
          .map(function (page) { return { page: page, score: score(page, terms) }; })
          .filter(function (r) { return r.score > 0; })
          .sort(function (a, b) { return b.score - a.score; });

        renderResults(scored.map(function (r) { return r.page; }), terms);
      });
    }

    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { doSearch(searchInput.value); }, 150);
    });

    // Prefetch index when modal opens (watch Alpine searchOpen)
    var overlay = document.querySelector('.search-modal-overlay');
    if (overlay && window.MutationObserver) {
      new MutationObserver(function () {
        if (overlay.style.display !== 'none' && !searchIndex && !indexLoading) {
          loadIndex(function () {}); // warm the cache
        }
      }).observe(overlay, { attributes: true, attributeFilter: ['style'] });
    }

  }());

}());

  // Transforms \`<run-example>text</run-example>\` into interactive toggle panels.
  // Must run before Alpine.js initialises (inline scripts execute before defer).
  document.querySelectorAll('run-example').forEach(function (el) {
    var text = el.textContent.trim();
    var wrapper = document.createElement('div');
    wrapper.className = 'example-output';

    var btn = document.createElement('button');
    btn.className = 'run-btn';
    btn.setAttribute('type', 'button');
    btn.innerHTML = '<em class="run-icon">\u25B6</em> <span class="run-label">Run example</span>';

    var output = document.createElement('pre');
    output.className = 'output-console';
    output.textContent = text;
    output.hidden = true;

    btn.addEventListener('click', function () {
      output.hidden = !output.hidden;
      btn.querySelector('.run-label').textContent = output.hidden ? 'Run example' : 'Hide output';
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(output);
    el.replaceWith(wrapper);
  });

  /* \u2500\u2500 TOC active-section tracking \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  var tocLinks = document.querySelectorAll('.toc-link');
  if (tocLinks.length) {
    var HEADER_H = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h') || '60', 10
    );
    var OFFSET = HEADER_H + 20;

    var linkMap = {};
    tocLinks.forEach(function (link) {
      var id = (link.getAttribute('href') || '').replace(/^#/, '');
      if (id) linkMap[id] = link;
    });

    var article = document.querySelector('article');
    if (article) {
      var targets = Array.from(article.querySelectorAll('a[name]'));
      if (!targets.length) targets = Array.from(article.querySelectorAll('h2[id], h3[id]'));

      if (targets.length) {
        var activeLink = null;
        var rafPending = false;

        function setActive(link) {
          if (activeLink === link) return;
          if (activeLink) activeLink.classList.remove('active');
          activeLink = link;
          if (link) link.classList.add('active');
        }

        function update() {
          rafPending = false;
          var scrollY = window.scrollY;
          var threshold = scrollY + OFFSET;
          var best = null;

          for (var i = targets.length - 1; i >= 0; i--) {
            var el = targets[i];
            var absTop = el.getBoundingClientRect().top + scrollY;
            if (absTop <= threshold) { best = el; break; }
          }
          if (!best) best = targets[0];

          var id = best && (best.id || best.getAttribute('name'));
          setActive(id && linkMap[id] ? linkMap[id] : null);
        }

        window.addEventListener('scroll', function () {
          if (!rafPending) { rafPending = true; requestAnimationFrame(update); }
        }, { passive: true });

        update();
      }
    }
  }

  /* \u2500\u2500 Copy-to-clipboard for code blocks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  var copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var checkIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  document.querySelectorAll('article pre:not(.output-console)').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = copyIcon + '<span>Copy</span>';

    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      var text = code ? code.innerText : pre.innerText;

      function showCopied() {
        btn.classList.add('copied');
        btn.innerHTML = checkIcon + '<span>Copied!</span>';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML = copyIcon + '<span>Copy</span>';
        }, 2000);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied);
      } else {
        // Fallback for non-secure contexts (HTTP dev servers)
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); showCopied(); } catch (_) {}
        document.body.removeChild(ta);
      }
    });

    pre.appendChild(btn);
  });

</script>
</body>
</html>
`;
  return __o;
}

// src/modules/Docs/ui/web/pages/docs.page.ts
function DocsPageTemplate(props) {
  const locale2 = loadLocale(getContext().locale);
  return render(props, locale2);
}
function DocsUnavailableTemplate() {
  const locale2 = loadLocale(getContext().locale);
  return render2({}, locale2);
}

// src/modules/Docs/logic/queries/get-doc-page.query.ts
async function GetDocPageQuery(version, slug) {
  const page = await getDocPage(version, slug);
  if (!page || page.frontmatter.draft) return null;
  return page;
}

// src/modules/Docs/logic/queries/get-all-doc-pages.query.ts
async function GetAllDocPagesQuery(version) {
  const pages = await getAllDocPages(version);
  return pages.filter((p) => !p.frontmatter.draft);
}

// src/modules/Docs/logic/tasks/build-nav-tree.task.ts
var SECTION_ORDER = {
  Prologue: 0,
  "Getting Started": 1,
  "Architecture Concepts": 2,
  "The Basics": 3,
  "The Logic Layer": 4,
  "Digging Deeper": 5,
  Security: 6,
  Database: 7,
  Testing: 8,
  Packages: 9,
  "Agentic Development": 10,
  Changelog: 11,
  Roadmap: 12
};
function sectionOrder(name) {
  return SECTION_ORDER[name] ?? 99;
}
function BuildNavTreeTask({ pages, currentSlug, version }) {
  const sorted = [...pages].sort((a, b) => {
    const sA = a.frontmatter.section ?? "";
    const sB = b.frontmatter.section ?? "";
    if (sA !== sB) return sectionOrder(sA) - sectionOrder(sB);
    return a.frontmatter.order - b.frontmatter.order;
  });
  const sectionMap = /* @__PURE__ */ new Map();
  for (const p of sorted) {
    const section = p.frontmatter.section ?? "Overview";
    if (!sectionMap.has(section)) sectionMap.set(section, []);
    sectionMap.get(section).push({
      title: p.frontmatter.title,
      slug: p.slug,
      href: p.slug === "index" ? `/docs/${version}` : `/docs/${version}/${p.slug}`,
      current: p.slug === currentSlug
    });
  }
  const sections = Array.from(sectionMap.entries()).map(([title, items]) => ({
    title,
    items,
    hasActive: items.some((i) => i.current)
  }));
  return {
    sections,
    flat: sections.flatMap((s) => s.items)
  };
}

// src/modules/Docs/logic/queries/get-doc-nav.query.ts
async function GetDocNavQuery(version, currentSlug) {
  const pages = await GetAllDocPagesQuery(version);
  return BuildNavTreeTask({ pages, currentSlug, version });
}

// src/modules/Docs/http/handlers/docs-page.handler.ts
var DocsPageHandler = defineHandler2(async (ctx) => {
  const versionParam = ctx.req.param("version");
  const slugParam = ctx.req.param("slug");
  const versions = getVersions();
  const defaultVersion = getDefaultVersion();
  const isVersion = versionParam ? /^\d+\.\w+$/.test(versionParam) || versionParam === "master" || versionParam === "main" : false;
  const version = isVersion ? versionParam : defaultVersion;
  const slug = isVersion ? slugParam ?? "index" : versionParam ?? "index";
  const [page, nav] = await Promise.all([GetDocPageQuery(version, slug), GetDocNavQuery(version, slug)]);
  if (!page) {
    return ctx.html(DocsUnavailableTemplate(), 503);
  }
  const editOnGithub = `https://github.com/${env.DOCS_GITHUB_OWNER}/${env.DOCS_GITHUB_REPO}/blob/${version}/${slug}.md`;
  return ctx.html(DocsPageTemplate({ page, nav, activeVersion: version, versions, editOnGithub }));
});

// src/config/app.ts
import "@lumiarq/framework";
var app_default = {
  name: env.APP_NAME,
  url: env.APP_URL,
  idempotency: { ttl: "24h", store: "session" }
};

// src/modules/Docs/http/routes/docs.web.ts
Route2.get("/docs", DocsPageHandler, {
  name: "docs.index",
  render: "static",
  meta: () => ({
    title: `Documentation \u2014 ${app_default.name}`,
    description: "Complete guide to building applications with the LumiARQ framework.",
    canonical: url("/docs")
  })
});
Route2.get("/docs/:version", DocsPageHandler, {
  name: "docs.version.index",
  render: "static",
  meta: ({ params }) => ({
    title: `Documentation ${params.version ?? ""} \u2014 ${app_default.name}`,
    description: "LumiARQ framework documentation.",
    canonical: url(`/docs/${params.version}`)
  })
});
Route2.get("/docs/:version/:slug", DocsPageHandler, {
  name: "docs.page",
  render: "static",
  meta: ({ params }) => ({
    title: `${params.slug?.replace(/-/g, " ") ?? "Documentation"} \u2014 ${app_default.name}`,
    description: "LumiARQ framework documentation.",
    canonical: url(`/docs/${params.version}/${params.slug}`)
  })
});

// src/modules/Welcome/http/routes/welcome.web.ts
import { Route as Route3 } from "@lumiarq/framework";
import { url as url2 } from "@lumiarq/framework";

// src/modules/Welcome/http/handlers/welcome.handler.ts
import { app as app2, defineHandler as defineHandler3 } from "@lumiarq/framework";

// src/modules/Welcome/ui/web/welcome.page.ts
import { loadLocale as loadLocale2 } from "@lumiarq/framework/veil";

// src/storage/framework/cache/views/welcome-page.veil.ts
function render3(vars, locale2 = {}) {
  const __e = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const __t = (key) => locale2[key] ?? key;
  const { version, environment, appName, isLocal } = vars;
  let __o = "";
  __o += `<!--
  layouts/base-layout.veil.html  (Shared)
  Minimal page shell. No Alpine, no header.
  Slots: title, styles, head, body-attrs, body, scripts
-->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>
Welcome \u2014 `;
  __o += __e(appName);
  __o += `
</title>
  <link rel="preconnect" href="https://fonts.bunny.net">
  <link href="https://fonts.bunny.net/css?family=inter:400,500,600,700,800&display=swap" rel="stylesheet">
<style>
/*! tailwindcss v4.2.2 | MIT License | https://tailwindcss.com */
@layer properties{@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b)))){*,:before,:after,::backdrop{--tw-rotate-x:initial;--tw-rotate-y:initial;--tw-rotate-z:initial;--tw-skew-x:initial;--tw-skew-y:initial;--tw-border-style:solid;--tw-ordinal:initial;--tw-slashed-zero:initial;--tw-numeric-figure:initial;--tw-numeric-spacing:initial;--tw-numeric-fraction:initial;--tw-shadow:0 0 #0000;--tw-shadow-color:initial;--tw-shadow-alpha:100%;--tw-inset-shadow:0 0 #0000;--tw-inset-shadow-color:initial;--tw-inset-shadow-alpha:100%;--tw-ring-color:initial;--tw-ring-shadow:0 0 #0000;--tw-inset-ring-color:initial;--tw-inset-ring-shadow:0 0 #0000;--tw-ring-inset:initial;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-offset-shadow:0 0 #0000;--tw-outline-style:solid;--tw-blur:initial;--tw-brightness:initial;--tw-contrast:initial;--tw-grayscale:initial;--tw-hue-rotate:initial;--tw-invert:initial;--tw-opacity:initial;--tw-saturate:initial;--tw-sepia:initial;--tw-drop-shadow:initial;--tw-drop-shadow-color:initial;--tw-drop-shadow-alpha:100%;--tw-drop-shadow-size:initial;--tw-backdrop-blur:initial;--tw-backdrop-brightness:initial;--tw-backdrop-contrast:initial;--tw-backdrop-grayscale:initial;--tw-backdrop-hue-rotate:initial;--tw-backdrop-invert:initial;--tw-backdrop-opacity:initial;--tw-backdrop-saturate:initial;--tw-backdrop-sepia:initial;--tw-font-weight:initial;--tw-tracking:initial;--tw-duration:initial;--tw-ease:initial}}}@layer theme{:root,:host{--font-sans:ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";--font-mono:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;--color-white:#fff;--spacing:.25rem;--container-2xl:42rem;--container-3xl:48rem;--container-7xl:80rem;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height:calc(1.5 / 1);--text-lg:1.125rem;--text-lg--line-height:calc(1.75 / 1.125);--text-xl:1.25rem;--text-xl--line-height:calc(1.75 / 1.25);--text-7xl:4.5rem;--text-7xl--line-height:1;--font-weight-medium:500;--tracking-tight:-.025em;--radius-sm:.25rem;--radius-md:.375rem;--radius-lg:.5rem;--radius-xl:.75rem;--ease-out:cubic-bezier(0, 0, .2, 1);--default-transition-duration:.15s;--default-transition-timing-function:cubic-bezier(.4, 0, .2, 1);--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono)}}@layer base{*,:after,:before,::backdrop{box-sizing:border-box;border:0 solid;margin:0;padding:0}::file-selector-button{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5;font-family:var(--default-font-family,ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-webkit-tap-highlight-color:transparent}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;-webkit-text-decoration:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-variation-settings:var(--default-mono-font-variation-settings,normal);font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}:-moz-focusring{outline:auto}progress{vertical-align:baseline}summary{display:list-item}ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}button,input,select,optgroup,textarea{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}::file-selector-button{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::placeholder{opacity:1}@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px){::placeholder{color:currentColor}@supports (color:color-mix(in lab, red, red)){::placeholder{color:color-mix(in oklab, currentcolor 50%, transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit{padding-block:0}::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-datetime-edit-month-field{padding-block:0}::-webkit-datetime-edit-day-field{padding-block:0}::-webkit-datetime-edit-hour-field{padding-block:0}::-webkit-datetime-edit-minute-field{padding-block:0}::-webkit-datetime-edit-second-field{padding-block:0}::-webkit-datetime-edit-millisecond-field{padding-block:0}::-webkit-datetime-edit-meridiem-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}button,input:where([type=button],[type=reset],[type=submit]){appearance:button}::file-selector-button{appearance:button}::-webkit-inner-spin-button{height:auto}::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}:root{--brand-red:#ff2d20;--brand-red-dim:#ff2d20e6;--brand-red-glow:#ff2d202e;--brand-red-border:#ff2d204d;--brand-red-subtle:#ff2d2014;--bg:#0a0a0f;--bg-raised:#12121a;--bg-card:#12121ab3;--bg-card-hover:#181822e6;--border:#ffffff12;--border-med:#ffffff1f;--text:#f1f1f5;--text-sub:#a1a1b5;--text-muted:#636380;--code-bg:#0d1117;--code-border:#ffffff1a;--code-text:#c9d1d9;--code-kw:#ff79c6;--code-fn:#50fa7b;--code-str:#f1fa8c;--code-cmt:#6272a4;--code-ty:#8be9fd;--code-num:#bd93f9;--code-punc:#f8f8f2;--radius-sm:8px;--radius-md:14px;--radius-lg:22px;--radius-xl:28px;--header-h:65px;--sidebar-w:260px;--spacing:.25rem;--spacing-sm:.5rem;--spacing-md:.75rem;--spacing-lg:1rem;--spacing-xl:2rem;--font-family:"Inter", -apple-system, BlinkMacSystemFont, sans-serif;--font-mono:"Fira Code", "Cascadia Code", "Consolas", monospace;--font-size:15px;--line-height:1.6;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height:1.5;--text-lg:1.125rem;--text-lg--line-height:calc(1.75 / 1.125);--text-xl:1.25rem;--text-xl--line-height:calc(1.75 / 1.25);--text-7xl:4.5rem;--text-7xl--line-height:1;--tracking-tight:-.025em}:root[data-theme=light]{--bg:#fff;--bg-raised:#f8f8fc;--bg-card:#f8f8fce6;--bg-card-hover:#f0f0f8;--border:#00000012;--border-med:#0000001f;--text:#0f0f14;--text-sub:#3d3d55;--text-muted:#7070a0;--code-bg:#f6f8fa;--code-border:#0000001f;--code-text:#24292f;--code-kw:#cf222e;--code-fn:#116329;--code-str:#0a3069;--code-cmt:#6e7781;--code-ty:#0550ae;--code-num:#6639ba;--code-punc:#24292f;--brand-red-glow:#ff2d201a;--brand-red-subtle:#ff2d200f}*,:before,:after{box-sizing:border-box;margin:0;padding:0}html,body{background:var(--bg);color:var(--text);transition:background-color .2s,color .2s}body{font-family:var(--font-family);font-size:var(--font-size);line-height:var(--line-height);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow-x:hidden}a{color:inherit;text-decoration:none}img,svg{vertical-align:middle;display:inline-block}code,pre{font-family:var(--font-mono)}}@layer components{.btn-primary{height:calc(var(--spacing) * 10);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);background-color:var(--brand-red);padding-inline:calc(var(--spacing) * 4);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--color-white);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);border-width:1px;border-color:#0000;display:inline-flex}@media (hover:hover){.btn-primary:hover{opacity:.9}}.btn-primary:focus{--tw-outline-style:none;outline-style:none}.btn-primary:focus-visible{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.btn-secondary{height:calc(var(--spacing) * 10);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);border-width:1px;border-color:var(--border);background-color:var(--bg-card);padding-inline:calc(var(--spacing) * 4);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--text);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);display:inline-flex}@media (hover:hover){.btn-secondary:hover{background-color:var(--bg-card-hover)}}.btn-secondary:focus{--tw-outline-style:none;outline-style:none}.btn-ghost{height:calc(var(--spacing) * 9);cursor:pointer;justify-content:center;align-items:center;gap:calc(var(--spacing) * 2);border-radius:var(--radius-lg);border-style:var(--tw-border-style);padding-inline:calc(var(--spacing) * 3);font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height));--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium);--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight);white-space:nowrap;color:var(--text-sub);transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration));--tw-duration:.1s;--tw-ease:var(--ease-out);transition-duration:.1s;transition-timing-function:var(--ease-out);border-width:1px;border-color:#0000;display:inline-flex}@media (hover:hover){.btn-ghost:hover{background-color:var(--brand-red-subtle);color:var(--text)}}.btn-ghost:focus{--tw-outline-style:none;outline-style:none}.corner-dot{background-color:var(--brand-red);width:7px;height:7px;position:absolute}.ambient-glow{z-index:-1;pointer-events:none;background:radial-gradient(at 50% 0,#ff2d2024 0%,#0000 65%);width:900px;height:700px;position:fixed;top:-200px;left:50%;transform:translate(-50%)}.wrapper{max-width:1280px;margin:0 auto}.wrapper-wide{max-width:1500px;margin:0 auto;padding:0 2rem}.flexy-wrapper{justify-content:space-between;align-items:center;width:100%;display:flex}.site-header,.site-nav{z-index:200;height:var(--header-h);border-bottom:1px solid var(--border);-webkit-backdrop-filter:blur(16px);background:#0a0a0fd1;justify-content:space-between;align-items:center;padding:0 1.75rem;transition:background-color .2s;display:flex;position:sticky;top:0}:root[data-theme=light] .site-header,:root[data-theme=light] .site-nav{background:#ffffffdb}.site-logo,.nav-logo{color:var(--text);flex-shrink:0;align-items:center;gap:10px;font-size:1.1rem;font-weight:700;display:flex}.site-logo span,.nav-logo span{color:var(--brand-red)}.nav-center,.header-nav{align-items:center;gap:1.5rem;display:flex}.nav-center{width:100%}.header-nav{flex-shrink:0;justify-content:flex-end;gap:1rem;margin-left:auto}.nav-center a,.header-nav a{color:var(--text-sub);font-size:.875rem;font-weight:500;transition:color .15s}.nav-center a:hover,.header-nav a:hover{color:var(--text)}.nav-actions{align-items:center;display:flex}.nav-left{gap:calc(var(--spacing) * 5)}.nav-right{gap:calc(var(--spacing) * 3)}.icon-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);background:0 0;flex-shrink:0;justify-content:center;align-items:center;width:34px;height:34px;transition:background .15s,color .15s,border-color .15s;display:flex}.icon-btn:hover{color:var(--text);border-color:var(--border-med);background:#ffffff0f}:root[data-theme=light] .icon-btn:hover{background:#0000000d}.github-badge{border:1px solid var(--border);color:var(--text-sub);border-radius:20px;align-items:center;gap:6px;padding:5px 11px;font-size:.78rem;font-weight:600;transition:border-color .15s,color .15s;display:flex}.github-badge:hover{border-color:var(--border-med);color:var(--text)}.github-badge svg{opacity:.7}.btn-primary,.cta-primary{background:var(--brand-red);border-radius:var(--radius-sm);white-space:nowrap;align-items:center;gap:7px;padding:7px 16px;font-size:.825rem;font-weight:600;transition:opacity .2s;display:inline-flex;color:#fff!important}.btn-primary:hover,.cta-primary:hover{opacity:.88}.cta-secondary{color:var(--text-sub);border-radius:var(--radius-md);border:1px solid var(--border-med);align-items:center;gap:7px;padding:12px 22px;font-size:.9rem;font-weight:600;transition:border-color .2s,color .2s,background .2s;display:inline-flex}.cta-secondary:hover{border-color:var(--border-med);color:var(--text);background:var(--bg-card)}.nav-divider{background:var(--border);width:1px;height:20px;margin:0 4px}.hamburger-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);background:0 0;flex-shrink:0;justify-content:center;align-items:center;width:36px;height:36px;transition:background .15s,color .15s;display:none}.hamburger-btn:hover{color:var(--text);background:#ffffff0f}.sidebar{top:var(--header-h);height:calc(100vh - var(--header-h));border-right:1px solid var(--border);scrollbar-width:thin;scrollbar-color:var(--border) transparent;width:var(--sidebar-w);padding:1.25rem .75rem;position:sticky;overflow-y:auto}.sidebar-section{margin-bottom:.125rem}.sidebar-summary{letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);cursor:pointer;border-radius:var(--radius-sm);-webkit-user-select:none;user-select:none;justify-content:space-between;align-items:center;padding:.35rem .5rem;font-size:.68rem;font-weight:700;list-style:none;transition:color .15s;display:flex}.sidebar-summary-content{align-items:center;gap:.4rem;display:flex}.sidebar-section-icon{opacity:.5;flex-shrink:0;align-items:center;transition:opacity .15s;display:flex}.sidebar-summary::-webkit-details-marker{display:none}.sidebar-summary:hover{color:var(--text)}.sidebar-section[open] .chevron{transform:rotate(90deg)}.chevron{color:var(--text-muted);flex-shrink:0;transition:transform .2s}.sidebar-list{padding:.25rem 0 .5rem .5rem;list-style:none}.sidebar-link{border-radius:var(--radius-sm);color:var(--text-muted);border-left:2px solid #0000;padding:.35rem .75rem;font-size:.875rem;transition:background .15s,color .15s,border-color .15s;display:block}.sidebar-link:hover{background:var(--bg-card);color:var(--text);border-left-color:var(--border-med)}.sidebar-link.active{color:var(--brand-red);border-left-color:var(--brand-red);background:#ff2d201a;font-weight:500}.sidebar-overlay{z-index:200;-webkit-backdrop-filter:blur(2px);background:#0009;position:fixed;inset:0}.mobile-nav-overlay{z-index:220;-webkit-backdrop-filter:blur(2px);background:#0000008c;position:fixed;inset:0}.mobile-nav-drawer{top:var(--header-h);width:min(320px,92vw);max-height:calc(100vh - var(--header-h));background:var(--bg);border-left:1px solid var(--border);border-bottom:1px solid var(--border);z-index:230;flex-direction:column;gap:.5rem;padding:1rem;display:flex;position:fixed;right:0;overflow-y:auto}.mobile-nav-link{border-radius:var(--radius-sm);border:1px solid var(--border);color:var(--text-sub);padding:.7rem .9rem;font-size:.9rem;font-weight:500;transition:background .15s,color .15s,border-color .15s;display:block}.mobile-nav-link:hover{color:var(--text);background:var(--bg-card);border-color:var(--border-med)}.hero{text-align:center;position:relative}.hero-badge{border:1px solid var(--brand-red-border);background:var(--brand-red-subtle);color:var(--brand-red);letter-spacing:.04em;border-radius:20px;align-items:center;gap:7px;margin-bottom:2rem;padding:4px 14px;font-size:.78rem;font-weight:600;display:inline-flex}.hero-badge svg{opacity:.8}.hero-left{text-align:start;max-width:746px;padding-bottom:calc(var(--spacing) * 52);padding-top:calc(var(--spacing) * 40);flex-direction:column;display:flex}.hero-right{justify-content:flex-start;width:50%;display:flex}.hero h1{font-size:clamp(var(--text-xl), 6vw, var(--text-7xl));font-weight:inherit;letter-spacing:-.04em;line-height:var(--text-7xl--line-height);background:linear-gradient(175deg, var(--text) 40%, #a1a1b566);-webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;margin-bottom:1.5rem}:root[data-theme=light] .hero h1{-webkit-text-fill-color:transparent;background:linear-gradient(175deg,#0f0f14 50%,#32325080);-webkit-background-clip:text;background-clip:text}.hero-sub{max-width:560px;color:var(--text-sub);text-wrap:balance;font-size:1.15rem;line-height:var(--text-xl--line-height);letter-spacing:var(--tracking-tight);margin-top:calc(var(--spacing) * 4)}.hero-cta{gap:calc(var(--spacing) * 4);margin-top:calc(var(--spacing) * 10);flex-flow:wrap;justify-content:flex-start;display:flex}.hero-visual{width:100%;max-width:450px}.hero-visual .code-window{background:var(--code-bg)}.hero .cta-primary{border-radius:var(--radius-md);padding:12px 26px;font-size:.9rem;transition:transform .2s,box-shadow .2s,opacity .2s;box-shadow:0 10px 30px -6px #ff2d2073}.hero .cta-primary:hover{opacity:1;transform:translateY(-2px);box-shadow:0 16px 36px -6px #ff2d208c}.code-window{background:var(--code-bg);border:1px solid var(--code-border);border-radius:var(--radius-lg);text-align:left;overflow:hidden;box-shadow:0 30px 80px -20px #0009}.code-titlebar{border-bottom:1px solid var(--code-border);background:#ffffff06;align-items:center;gap:6px;padding:12px 16px;display:flex}.dot{border-radius:50%;flex-shrink:0;width:11px;height:11px}.dot-red{background:#ff5f57}.dot-amber{background:#febc2e}.dot-green{background:#28c840}.code-filename{color:var(--text-muted);font-size:.72rem;font-family:var(--font-mono);margin-left:6px}.code-body{padding:1.25rem 1.5rem;overflow-x:auto}.code-body .header{text-align:center;margin-bottom:var(--spacing-xl)}.code-body .logo-container{margin-bottom:var(--spacing-md);display:inline-block}.code-body .header h1{margin-bottom:5px;font-size:18px;font-weight:500}.code-body .header p{font-size:14px}.code-pre{font-family:var(--font-mono);color:var(--code-text);font-size:.82rem;line-height:1.65}.kw{color:var(--code-kw)}.fn{color:var(--code-fn)}.str{color:var(--code-str)}.cmt{color:var(--code-cmt);font-style:italic}.ty{color:var(--code-ty)}.num{color:var(--code-num)}.punc{color:var(--code-punc)}.code-tabs{border-bottom:1px solid var(--code-border);background:#ffffff05;gap:4px;padding:0 1rem;display:grid}.code-tab{font-size:.78rem;font-family:var(--font-mono);color:var(--text-muted);cursor:pointer;background:0 0;border:none;padding:9px 14px;transition:color .15s,border-color .15s}.code-tab.active{color:var(--text);border-bottom-color:var(--brand-red)}.code-tab:hover{color:var(--text-sub)}.grid{gap:var(--spacing-xl);grid-template-columns:repeat(2,1fr);display:grid}.card{background:var(--bg-card);border:1px solid var(--border);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);padding:var(--spacing-sm);color:inherit;border-radius:1rem;text-decoration:none;transition:all .3s cubic-bezier(.4,0,.2,1);position:relative;overflow:hidden}.flexy-card{align-items:center;gap:1.5rem;display:flex}.card:hover{border-color:#ff2d2066;transform:translateY(-2px)}.card:hover .icon-box{background:var(--brand-red);color:#fff}.icon-box{width:40px;height:40px;color:var(--brand-red);background:#1e293b;border-radius:8px;justify-content:center;align-items:center;margin-bottom:1.25rem;transition:background .3s;display:flex}.card h2{font-size:18px;font-weight:600}.card p{color:var(--text-muted);font-size:.9375rem;line-height:1.6}.version-tag{color:var(--brand-red);background:#ff2d201a;border-radius:9999px;margin-top:1rem;padding:.25rem .75rem;font-size:.75rem;font-weight:600;display:inline-block}.trust-bar{border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:40px 0}.trust-label{text-align:center;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1.5rem;font-size:.72rem;font-weight:600}.trust-logos{flex-wrap:wrap;justify-content:center;align-items:center;gap:2.5rem;display:flex}.trust-logo{color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase;opacity:.55;font-size:.92rem;font-weight:700;transition:opacity .2s}.trust-logo:hover{opacity:.9}.pitch{border-top-width:0;position:relative}.pitch .wrapper{position:revert-layer;padding-top:calc(var(--spacing) * 16);border:1px solid var(--code-border);border-color:var(--code-border);border-top:none}.pitch-grid{grid-template-columns:1fr 1fr;align-items:center;gap:64px;display:grid}.pitch-panel{padding-inline:calc(var(--spacing) * 4);padding-right:0}.pitch-left-panel{padding-right:0;padding-left:calc(var(--spacing) * 12)}.pitch-right-panel{min-width:calc(var(--spacing) * 0);flex-grow:1}.pitch-label{letter-spacing:.1em;text-transform:uppercase;color:var(--brand-red);margin-bottom:1rem;font-size:.72rem;font-weight:700}.pitch-title{letter-spacing:-.03em;margin-bottom:1.25rem;font-size:clamp(1.6rem,3vw,2.4rem);font-weight:800;line-height:1.2}.pitch-text{color:var(--text-sub);margin-bottom:2rem;font-size:1rem;line-height:1.75}.feature-list{flex-direction:column;gap:.75rem;list-style:none;display:flex}.feature-list li{align-items:flex-start;gap:calc(var(--spacing) * 2.5);color:var(--text-sub);font-size:.9rem;line-height:1.5;display:flex}.feature-list li svg{color:var(--brand-red);flex-shrink:0;margin-top:1px}.pitch-link,.link-arrow{color:var(--brand-red);align-items:center;gap:6px;margin-top:2rem;font-size:.875rem;font-weight:600;transition:gap .2s;display:inline-flex}.pitch-link:hover,.link-arrow:hover{gap:10px}.section-eyebrow{letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);align-items:center;gap:10px;margin-bottom:1rem;font-size:.72rem;font-weight:700;display:flex}.section-eyebrow:before,.section-eyebrow:after{content:"";background:var(--border);flex:1;height:1px}.section-title{letter-spacing:-.03em;text-align:center;margin-bottom:.75rem;font-size:clamp(1.8rem,3.5vw,2.6rem);font-weight:800;line-height:1.2}.section-sub{text-align:center;color:var(--text-sub);max-width:520px;margin:0 auto 3.5rem;font-size:1rem;line-height:1.75}.bento{padding:80px 0}.bento-grid{grid-template-rows:auto;grid-template-columns:repeat(12,1fr);gap:1.25rem;display:grid}.bento-card{padding:2rem;transition:border-color .25s,background .25s,transform .25s;position:relative;overflow:hidden}.bento-full{grid-column:span 12}.bento-8{grid-column:span 8}.bento-4{grid-column:span 4}.bento-6{grid-column:span 6}.bento-7{grid-column:span 7}.bento-5{grid-column:span 5}.bento-card-label{letter-spacing:.1em;text-transform:uppercase;color:var(--brand-red);text-align:left;margin-bottom:.75rem;font-size:.7rem;font-weight:700}.bento-card-title{letter-spacing:-.02em;margin-bottom:.75rem;font-size:1.2rem;font-weight:700;line-height:1.3}.bento-card-text{color:var(--text-sub);text-align:left;max-width:460px;font-size:.875rem;line-height:1.7}.bento-card-link{color:var(--brand-red);align-items:center;gap:5px;margin-top:1.5rem;font-size:.8rem;font-weight:600;transition:gap .2s;display:inline-flex}.bento-card-link:hover{gap:8px}.bento-icon{background:var(--brand-red-subtle);width:40px;height:40px;color:var(--brand-red);border:1px solid var(--brand-red-border);border-radius:11px;justify-content:center;align-items:center;margin-bottom:1.25rem;display:flex}.bento-code{background:var(--code-bg);border:1px solid var(--code-border);border-radius:var(--radius-md);margin-top:1.25rem;padding:1rem 1.25rem;overflow-x:auto}.bento-code pre{font-family:var(--font-mono);color:var(--code-text);font-size:.78rem;line-height:1.6}.partner-logos{flex-direction:column;gap:8px;margin-top:1.5rem;display:flex}.partner-item{border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-raised);color:var(--text-sub);align-items:center;gap:10px;padding:9px 14px;font-size:.82rem;font-weight:600;transition:border-color .2s,color .2s;display:flex}.partner-item:hover{border-color:var(--border-med);color:var(--text)}.partner-item svg{color:var(--text-muted)}.bento-checks{flex-direction:column;gap:.6rem;margin-top:1.25rem;list-style:none;display:flex}.bento-checks li{color:var(--text-sub);align-items:center;gap:8px;font-size:.875rem;display:flex}.bento-checks li svg{color:var(--brand-red);flex-shrink:0}.cta-band{text-align:center;padding:100px 0;position:relative}.cta-band h2{letter-spacing:-.04em;background:linear-gradient(175deg, var(--text) 40%, #a1a1b566);-webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;margin-bottom:1rem;font-size:clamp(2.2rem,5vw,3.8rem);font-weight:800;line-height:1.1}:root[data-theme=light] .cta-band h2{-webkit-text-fill-color:transparent;background:linear-gradient(175deg,#0f0f14 60%,#32325080);-webkit-background-clip:text;background-clip:text}.cta-band p{color:var(--text-sub);max-width:480px;margin-bottom:2.5rem;margin-left:auto;margin-right:auto;font-size:1.05rem}.cta-band-actions{flex-wrap:wrap;justify-content:center;gap:14px;display:flex}.testimonials{border-top:1px solid var(--border);padding:80px 0}.testimonials-grid{grid-template-columns:repeat(3,1fr);gap:1.25rem;display:grid}.testimonial-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.75rem;transition:border-color .25s}.testimonial-card:hover{border-color:var(--border-med)}.testimonial-card.featured{background:linear-gradient(135deg, var(--bg-card) 0%, #ff2d200a 100%);border-color:var(--brand-red-border)}.testimonial-card blockquote{color:var(--text-sub);margin-bottom:1.25rem;font-size:.9rem;line-height:1.7}.testimonial-author{align-items:center;gap:10px;display:flex}.testimonial-avatar{background:var(--brand-red-subtle);border:1px solid var(--brand-red-border);width:36px;height:36px;color:var(--brand-red);border-radius:50%;flex-shrink:0;justify-content:center;align-items:center;font-size:.8rem;font-weight:700;display:flex}.testimonial-name{color:var(--text);font-size:.82rem;font-weight:700}.testimonial-role{color:var(--text-muted);font-size:.75rem}.community{border-top:1px solid var(--border);padding:80px 0}.community-grid{grid-template-columns:1fr 1fr;gap:1.25rem;display:grid}.community-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-xl);padding:2.5rem;transition:border-color .25s,background .25s}.community-card:hover{border-color:var(--border-med);background:var(--bg-card-hover)}.community-card h3{letter-spacing:-.02em;margin-bottom:.75rem;font-size:1.4rem;font-weight:700}.community-card p{color:var(--text-sub);margin-bottom:1.5rem;font-size:.9rem;line-height:1.7}.layout{grid-template-columns:var(--sidebar-w) 1fr 200px;min-height:calc(100vh - var(--header-h));max-width:1500px;margin:0 auto;display:grid}.main{min-width:0;padding:2rem 2.5rem}article{max-width:720px}article h1,article h2,article h3,article h4{color:var(--text);margin-top:2.5rem;margin-bottom:.75rem;font-weight:700;line-height:1.3}article h1{margin-top:0;font-size:2rem}article h2{border-bottom:1px solid var(--border);padding-bottom:.5rem;font-size:1.4rem}article h3{font-size:1.15rem}article h4{font-size:1rem}article h2,article h3,article h4,article a[name]{scroll-margin-top:calc(var(--header-h) + 1.25rem)}article>ul:first-of-type:has(>li>a[href^=\\#]){display:none}article p{color:var(--text-muted);margin-bottom:1rem;line-height:1.8}article a{color:var(--brand-red)}article a:hover{text-decoration:underline}article ul,article ol{color:var(--text-muted);margin:.75rem 0 1rem 1.5rem;line-height:1.8}article li{margin-bottom:.25rem}article code{font-family:var(--font-mono);background:var(--bg-card);border:1px solid var(--border);color:#e879f9;border-radius:4px;padding:.1em .4em;font-size:.875em}article pre{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);margin:1rem 0 1.5rem;padding:1.25rem 1.5rem;position:relative;overflow-x:auto}.copy-btn{border:1px solid var(--border);color:var(--text-muted);cursor:pointer;opacity:0;background:#ffffff0f;border-radius:6px;align-items:center;gap:4px;padding:4px 10px;font-family:inherit;font-size:.72rem;transition:opacity .15s,background .15s,color .15s,border-color .15s;display:flex;position:absolute;top:.5rem;right:.5rem}article pre:hover .copy-btn{opacity:1}.copy-btn:hover{color:var(--text);background:#ffffff1a}.copy-btn.copied{color:#22c55e;opacity:1;border-color:#22c55e4d}article pre code{color:inherit;background:0 0;border:none;padding:0;font-size:.875rem}.example-output{border:1px solid var(--border);border-radius:8px;margin:1rem 0 1.5rem;overflow:hidden}.run-btn{background:var(--bg-card);border:none;border-bottom:1px solid var(--border);width:100%;color:var(--text-muted);cursor:pointer;text-align:left;align-items:center;gap:.4rem;padding:.45rem 1rem;font-family:inherit;font-size:.82rem;transition:background .15s,color .15s;display:inline-flex}.run-btn:hover{color:var(--text);background:#ffffff0d}.run-btn .run-icon{color:var(--brand-red);font-style:normal}.output-console{position:relative;overflow-x:auto;color:#c9d1d9!important;background:#0d1117!important;border:none!important;border-radius:0!important;margin:0!important;padding:1rem 1.25rem!important;font-size:.825rem!important}.output-console .copy-btn{display:none}article blockquote{border-left:3px solid var(--brand-red);color:var(--text-muted);background:var(--bg-card);border-radius:0 8px 8px 0;margin:1.25rem 0;padding:.5rem 1rem;font-style:italic}article hr{border:none;border-top:1px solid var(--border);margin:2rem 0}article table{border-collapse:collapse;border:1px solid var(--border);border-radius:8px;width:100%;margin:1rem 0;font-size:.875rem;overflow:hidden}article th,article td{border-bottom:1px solid var(--border);text-align:left;padding:.6rem .75rem}article th{background:var(--bg-card);color:var(--text);letter-spacing:.04em;text-transform:uppercase;font-size:.8rem;font-weight:600}article td{color:var(--text-muted)}.meta{border-top:1px solid var(--border);color:var(--text-muted);margin-top:2rem;padding-top:1.5rem;font-size:.8rem}.toc{top:calc(var(--header-h) + 1.5rem);max-height:calc(100vh - var(--header-h) - 3rem);scrollbar-width:thin;scrollbar-color:var(--border) transparent;padding:1.5rem 1rem;position:sticky;overflow-y:auto}.toc-title{letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);align-items:center;gap:.4rem;margin-bottom:.75rem;font-size:.68rem;font-weight:700;display:flex}.toc-list,.toc-sub{padding:0;list-style:none}.toc-sub{padding-left:.75rem}.toc-link{color:var(--text-muted);border-left:2px solid #ffffff0f;padding:.25rem 0 .25rem .75rem;font-size:.8rem;line-height:1.4;transition:color .15s,border-color .15s;display:block}.toc-link:hover{color:var(--text);border-left-color:#ffffff2e}.toc-link.active{color:var(--text);border-left-color:var(--brand-red);font-weight:600}.search-btn{align-items:center;gap:calc(var(--spacing) * 2);color:var(--text-muted);min-width:calc(var(--spacing) * 40);cursor:pointer;transition:background .15s,color .15s;display:inline-flex}.search-btn:hover{color:var(--text);background:#ffffff0f}.search-modal-overlay{z-index:300;-webkit-backdrop-filter:blur(4px);background:#000000b3;justify-content:center;align-items:flex-start;padding-top:15vh;display:flex;position:fixed;inset:0}.search-modal{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-lg);width:min(560px,100vw - 2rem);overflow:hidden;box-shadow:0 25px 50px -12px #0009}.search-input-wrap{border-bottom:1px solid var(--border);color:var(--text-muted);align-items:center;gap:.75rem;padding:1rem 1.25rem;display:flex}.search-input-wrap input{color:var(--text);background:0 0;border:none;outline:none;flex:1;font-family:inherit;font-size:1rem}.search-input-wrap input::placeholder{color:var(--text-muted)}.search-results{max-height:360px;padding:.5rem;overflow-y:auto}.search-result-list{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.search-result-item{border-radius:8px;transition:background .1s}.search-result-item:hover,.search-result-active{background:var(--bg-raised)}.search-result-link{color:inherit;border-radius:8px;outline:none;flex-direction:column;gap:2px;padding:10px 12px;text-decoration:none;display:flex}.search-result-link:focus-visible{box-shadow:0 0 0 2px var(--brand-red)}.search-result-title{color:var(--text);font-size:.875rem;font-weight:500;line-height:1.3}.search-result-section{color:var(--brand-red);text-transform:uppercase;letter-spacing:.04em;font-size:.75rem;font-weight:500;line-height:1.2}.search-result-excerpt{color:var(--text-muted);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:.8rem;line-height:1.5;display:-webkit-box;overflow:hidden}.search-result-excerpt mark,.search-result-title mark,.search-result-section mark{color:var(--brand-red);background:0 0;font-weight:600}.search-empty{text-align:center;color:var(--text-muted);padding:1.5rem 1rem;font-size:.875rem}.site-footer{border-top:1px solid var(--border);padding:64px 0 40px}.footer-top{grid-template-columns:220px repeat(4,1fr);gap:48px;margin-bottom:56px;display:grid}.footer-brand p{color:var(--text-muted);max-width:180px;margin-top:.75rem;font-size:.825rem;line-height:1.7}.footer-social{gap:8px;margin-top:1.25rem;display:flex}.footer-col h4{letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1rem;font-size:.7rem;font-weight:700}.footer-col ul{flex-direction:column;gap:.625rem;list-style:none;display:flex}.footer-col a{color:var(--text-sub);font-size:.85rem;transition:color .15s}.footer-col a:hover{color:var(--text)}.footer-bottom{border-top:1px solid var(--border);color:var(--text-muted);justify-content:space-between;align-items:center;padding-top:32px;font-size:.8rem;display:flex}.footer-bottom-links{gap:1.5rem;display:flex}.footer-bottom-links a{color:var(--text-muted);font-size:.8rem;transition:color .15s}.footer-bottom-links a:hover{color:var(--text-sub)}.footer{text-align:center;color:var(--text-muted);margin-top:2rem;font-size:.875rem}}@layer utilities{.collapse{visibility:collapse}.invisible{visibility:hidden}.visible{visibility:visible}.absolute{position:absolute}.fixed{position:fixed}.relative{position:relative}.static{position:static}.sticky{position:sticky}.start{inset-inline-start:var(--spacing)}.end{inset-inline-end:var(--spacing)}.isolate{isolation:isolate}.container{width:100%}@media (min-width:40rem){.container{max-width:40rem}}@media (min-width:48rem){.container{max-width:48rem}}@media (min-width:64rem){.container{max-width:64rem}}@media (min-width:80rem){.container{max-width:80rem}}@media (min-width:96rem){.container{max-width:96rem}}.mx-auto{margin-inline:auto}.mt-8{margin-top:calc(var(--spacing) * 8)}.block{display:block}.contents{display:contents}.flex{display:flex}.grid{display:grid}.hidden{display:none}.inline{display:inline}.table{display:table}.w-full{width:100%}.max-w-2xl{max-width:var(--container-2xl)}.max-w-3xl{max-width:var(--container-3xl)}.max-w-7xl{max-width:var(--container-7xl)}.max-w-\\[1440px\\]{max-width:1440px}.max-w-full{max-width:100%}.min-w-0{min-width:calc(var(--spacing) * 0)}.flex-shrink{flex-shrink:1}.flex-grow,.grow{flex-grow:1}.border-collapse{border-collapse:collapse}.transform{transform:var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)}.resize{resize:both}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-start{align-items:flex-start}.justify-between{justify-content:space-between}.gap-4{gap:calc(var(--spacing) * 4)}.gap-5{gap:calc(var(--spacing) * 5)}.truncate{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.overflow-x-auto{overflow-x:auto}.border{border-style:var(--tw-border-style);border-width:1px}.mask-repeat{-webkit-mask-repeat:repeat;mask-repeat:repeat}.px-4{padding-inline:calc(var(--spacing) * 4)}.py-10{padding-block:calc(var(--spacing) * 10)}.text-center{text-align:center}.text-justify{text-align:justify}.text-wrap{text-wrap:wrap}.capitalize{text-transform:capitalize}.lowercase{text-transform:lowercase}.uppercase{text-transform:uppercase}.italic{font-style:italic}.ordinal{--tw-ordinal:ordinal;font-variant-numeric:var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,)}.overline{text-decoration-line:overline}.underline{text-decoration-line:underline}.shadow{--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.ring{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)}.outline{outline-style:var(--tw-outline-style);outline-width:1px}.invert{--tw-invert:invert(100%);filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.filter{filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.backdrop-filter{-webkit-backdrop-filter:var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);backdrop-filter:var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,)}.transition{transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to,opacity,box-shadow,transform,translate,scale,rotate,filter,-webkit-backdrop-filter,backdrop-filter,display,content-visibility,overlay,pointer-events;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}@media (min-width:40rem){.sm\\:px-6{padding-inline:calc(var(--spacing) * 6)}}@media (min-width:48rem){.md\\:col-span-2{grid-column:span 2/span 2}.md\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.md\\:flex-row{flex-direction:row}.md\\:items-center{align-items:center}}@media (min-width:64rem){.lg\\:px-8{padding-inline:calc(var(--spacing) * 8)}.lg\\:py-14{padding-block:calc(var(--spacing) * 14)}}}@media (max-width:1100px){.layout{grid-template-columns:var(--sidebar-w) 1fr}.toc{display:none}}@media (max-width:1024px){.site-nav,.site-header{padding:0 1rem}.nav-center,.search-btn-text,.search-btn-keys{display:none}.home-search-btn{min-width:auto}.hamburger-btn{display:flex}.pitch-grid{grid-template-columns:1fr;gap:40px}.bento-8,.bento-4,.bento-7,.bento-5{grid-column:span 12}.footer-top{grid-template-columns:1fr 1fr;gap:32px}.footer-brand{grid-column:span 2}.testimonials-grid{grid-template-columns:1fr 1fr}}@media (max-width:768px){.site-nav,.site-header{padding:0 1rem}.nav-center,.search-btn-text,.search-btn-keys{display:none}.home-search-btn{min-width:auto}.hamburger-btn{display:flex}.header-nav>a:not(.btn-primary){display:none}.layout{grid-template-columns:1fr}.sidebar{width:min(var(--sidebar-w), 85vw);z-index:250;background:var(--bg);height:100vh;padding-top:1rem;transition:transform .3s;position:fixed;top:0;left:0;transform:translate(-100%)}.sidebar-open .sidebar{transform:translate(0)}.hero{padding:64px 0 56px}.hero-left{padding-top:3rem;padding-bottom:1.5rem}.hero h1{font-size:2.4rem}.bento-6{grid-column:span 12}.community-grid,.testimonials-grid{grid-template-columns:1fr}.footer-top{grid-template-columns:1fr 1fr}.footer-brand{grid-column:span 2}.footer-bottom{text-align:center;flex-direction:column;gap:1rem}.trust-logos{gap:1.5rem}.main{padding:1.5rem 1rem}}@media (max-width:520px){.wrapper{padding:0 1rem}.hero-cta{flex-direction:column;align-items:stretch}.cta-primary,.cta-secondary{justify-content:center}.footer-top{grid-template-columns:1fr}.footer-brand{grid-column:auto}.cta-band-actions{flex-direction:column;align-items:center}}@media (max-width:640px){.grid{grid-template-columns:1fr}}@property --tw-rotate-x{syntax:"*";inherits:false}@property --tw-rotate-y{syntax:"*";inherits:false}@property --tw-rotate-z{syntax:"*";inherits:false}@property --tw-skew-x{syntax:"*";inherits:false}@property --tw-skew-y{syntax:"*";inherits:false}@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-ordinal{syntax:"*";inherits:false}@property --tw-slashed-zero{syntax:"*";inherits:false}@property --tw-numeric-figure{syntax:"*";inherits:false}@property --tw-numeric-spacing{syntax:"*";inherits:false}@property --tw-numeric-fraction{syntax:"*";inherits:false}@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-shadow-color{syntax:"*";inherits:false}@property --tw-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-inset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-shadow-color{syntax:"*";inherits:false}@property --tw-inset-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-ring-color{syntax:"*";inherits:false}@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-ring-color{syntax:"*";inherits:false}@property --tw-inset-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-ring-inset{syntax:"*";inherits:false}@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}@property --tw-ring-offset-color{syntax:"*";inherits:false;initial-value:#fff}@property --tw-ring-offset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-outline-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-blur{syntax:"*";inherits:false}@property --tw-brightness{syntax:"*";inherits:false}@property --tw-contrast{syntax:"*";inherits:false}@property --tw-grayscale{syntax:"*";inherits:false}@property --tw-hue-rotate{syntax:"*";inherits:false}@property --tw-invert{syntax:"*";inherits:false}@property --tw-opacity{syntax:"*";inherits:false}@property --tw-saturate{syntax:"*";inherits:false}@property --tw-sepia{syntax:"*";inherits:false}@property --tw-drop-shadow{syntax:"*";inherits:false}@property --tw-drop-shadow-color{syntax:"*";inherits:false}@property --tw-drop-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-drop-shadow-size{syntax:"*";inherits:false}@property --tw-backdrop-blur{syntax:"*";inherits:false}@property --tw-backdrop-brightness{syntax:"*";inherits:false}@property --tw-backdrop-contrast{syntax:"*";inherits:false}@property --tw-backdrop-grayscale{syntax:"*";inherits:false}@property --tw-backdrop-hue-rotate{syntax:"*";inherits:false}@property --tw-backdrop-invert{syntax:"*";inherits:false}@property --tw-backdrop-opacity{syntax:"*";inherits:false}@property --tw-backdrop-saturate{syntax:"*";inherits:false}@property --tw-backdrop-sepia{syntax:"*";inherits:false}@property --tw-font-weight{syntax:"*";inherits:false}@property --tw-tracking{syntax:"*";inherits:false}@property --tw-duration{syntax:"*";inherits:false}@property --tw-ease{syntax:"*";inherits:false}
</style>
  <style>
/* \u2500\u2500 Theme variables \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
:root {
  --accent: #ff2d20;
  --card-bg: rgba(30, 41, 59, 0.5);
  --border: rgba(51, 65, 85, 0.5);
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
}

/* \u2500\u2500 Resets \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* \u2500\u2500 Body \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
body {
  background-color: #030712;
  background-image:
    radial-gradient(at 0% 0%, hsla(253, 16%, 7%, 1) 0, transparent 50%),
    radial-gradient(at 50% 0%, hsla(225, 39%, 30%, 0.2) 0, transparent 50%);
  color: var(--text-main);
  font-family:
    "Inter",
    system-ui,
    -apple-system,
    sans-serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

/* \u2500\u2500 Spotlight \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.spotlight {
  position: fixed;
  top: -10%;
  left: 50%;
  transform: translateX(-50%);
  width: 1000px;
  height: 600px;
  background: radial-gradient(circle, rgba(255, 45, 32, 0.1) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

/* \u2500\u2500 Layout \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
main {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 800px;
  padding: 2rem;
}

.header {
  text-align: center;
  margin-bottom: 4rem;
}

.logo-container {
  margin-bottom: 2rem;
  display: inline-block;
}

.logo-mark {
  height: 56px;
  width: auto;
  fill: var(--accent);
  filter: drop-shadow(0 0 15px rgba(255, 45, 32, 0.3));
}

h1 {
  font-size: 3rem;
  font-weight: 600;
  letter-spacing: -0.04em;
  margin-bottom: 1rem;
  background: linear-gradient(to bottom, #fff, #94a3b8);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* \u2500\u2500 Grid & cards \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
  margin-bottom: 3rem;
}

.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  backdrop-filter: blur(12px);
  padding: 2rem;
  border-radius: 1rem;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  text-decoration: none;
  color: inherit;
  position: relative;
  overflow: hidden;
}

.card:hover {
  border-color: rgba(255, 45, 32, 0.4);
  transform: translateY(-2px);
}

.card:hover .icon-box {
  background: var(--accent);
  color: white;
}

.icon-box {
  width: 40px;
  height: 40px;
  background: #1e293b;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.25rem;
  color: var(--accent);
  transition: background 0.3s;
}

.card h2 {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.card p {
  color: var(--text-muted);
  font-size: 0.9375rem;
  line-height: 1.6;
}

/* \u2500\u2500 Version tag \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.version-tag {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  background: rgba(255, 45, 32, 0.1);
  color: var(--accent);
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-top: 1rem;
}

/* \u2500\u2500 Footer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.footer {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-top: 2rem;
}

/* \u2500\u2500 Responsive \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
  h1 {
    font-size: 2.25rem;
  }
}

</style>
<meta name="robots" content="noindex, nofollow">
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
</head>
<body 

>
<div class="spotlight"></div>

  <main class="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
    <div class="header mx-auto max-w-3xl text-center">
      <div class="logo-container">
        <svg class="logo-mark" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"/>
        </svg>
      </div>
      <h1>`;
  __o += __e(appName);
  __o += `</h1>
      <p style="color: var(--text-muted)">A web framework that expresses your artistry.</p>
      <div class="version-tag">`;
  __o += __e(environment);
  __o += ` v`;
  __o += __e(version);
  __o += `</div>
    </div>

    <div class="grid mt-8 grid-cols-1 gap-5 md:grid-cols-2">
      <a href="/docs" class="card">
        <div class="icon-box">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
          </svg>
        </div>
        <h2>Documentation</h2>
        <p>LumiARQ has wonderful documentation covering every aspect of the framework.</p>
      </a>

      <a href="https://github.com/lumiarq/lumiarq" class="card">
        <div class="icon-box">
          <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
        </div>
        <h2>GitHub</h2>
        <p>Explore the source code, contribute, or star the repository to show support.</p>
      </a>

      <div class="card md:col-span-2">
        <div class="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2>Getting Started</h2>
            <p>Ready to build? Edit <code style="color: var(--accent)">src/modules/Welcome</code> to start your journey.</p>
          </div>
          `;
  if (isLocal) {
    __o += `<code style="background: #030712; padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid var(--border); font-size: 0.7rem;" class="max-w-full overflow-x-auto">lumis make:module Home</code>`;
  }
  __o += `
        </div>
      </div>
    </div>

    <footer class="footer">
      LumiARQ JS &copy; `;
  __o += __e((/* @__PURE__ */ new Date()).getFullYear());
  __o += ` &mdash; Optimized for performance.
    </footer>
  </main>

</body>
</html>
`;
  return __o;
}

// src/modules/Welcome/ui/web/welcome.page.ts
var locale = loadLocale2();
function WelcomePageTemplate({ version, environment, appName }) {
  return render3({ version, environment, appName, isLocal: environment === "local" }, locale);
}

// src/modules/Welcome/http/handlers/welcome.handler.ts
var WelcomeHandler = defineHandler3(async (ctx) => {
  return ctx.html(
    WelcomePageTemplate({
      version: "1.0.0",
      environment: app2().environment(),
      appName: app_default.name
    })
  );
});

// src/modules/Welcome/http/routes/welcome.web.ts
Route3.get("/", WelcomeHandler, {
  name: "welcome",
  render: "static",
  revalidate: false,
  meta: () => ({
    title: `Welcome \u2014 ${app_default.name}`,
    description: "A full-stack TypeScript framework inspired by Laravel.",
    canonical: url2("/")
  })
});

// bootstrap/entry.ts
var entry_default = boot({
  onError: handleIgnitionError
});

// bootstrap/vercel.ts
import { createVercelAdapter } from "@illumiarq/adapters/vercel";
var config = { runtime: "nodejs" };
var vercel_default = createVercelAdapter(entry_default);
export {
  config,
  vercel_default as default
};
