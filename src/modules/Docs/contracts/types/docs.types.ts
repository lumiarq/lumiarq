import type { ContentPage, TocEntry } from "@lumiarq/framework"

// ─── Frontmatter ──────────────────────────────────────────────────────────────

export interface DocFrontmatter {
  title: string
  description?: string
  section?: string
  order: number
  draft: boolean
}

// ─── Navigation types ─────────────────────────────────────────────────────────

export interface DocNavItem {
  title: string
  slug: string
  href: string
  current: boolean
}

export interface DocNavSection {
  title: string
  items: DocNavItem[]
  hasActive: boolean
}

export interface DocNav {
  sections: DocNavSection[]
  flat: DocNavItem[]
}

// ─── Legacy page props (kept for Veil template compatibility) ─────────────────

export interface DocPageProps {
  slug: string
  title: string
  html: string
  description?: string
  section?: string
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface ApiDocSummary {
  slug: string
  title: string
  description?: string
  section?: string
  order: number
  excerpt: string
  readingTime: number
}

export interface ApiDocPage extends ApiDocSummary {
  html: string
  toc: TocEntry[]
}

export interface ApiDocListResponse {
  pages: ApiDocSummary[]
}

// Re-export framework types so the rest of the module doesn't need direct deps
export type { TocEntry }

/** A single parsed documentation page (from the framework's content loader). */
export type DocPage = ContentPage<DocFrontmatter>

/** A lightweight summary used to build the sidebar nav. */
export type DocSummary = Pick<DocPage, "slug" | "readingTime" | "excerpt"> & {
  title: string
  description?: string
  section?: string
  order: number
}

export type PageMeta = { slug: string; title: string; href: string; active: boolean }
export type SidebarGroup = { section: string; pages: PageMeta[] }

/** A published doc version string, e.g. "1.x". */
export type DocVersion = string
