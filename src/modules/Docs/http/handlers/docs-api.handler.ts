import { defineHandler } from "@lumiarq/framework"
import { getAllDocPages, getDefaultVersion } from "@/modules/Docs/logic/sources/github-docs.source"

// GET /api/docs — list all non-draft pages for the default version
export const DocsListApiHandler = defineHandler(async (ctx) => {
  const version = getDefaultVersion()
  const pages = await getAllDocPages(version)

  return ctx.json({
    pages: pages.map((p) => ({
      slug: p.slug,
      title: p.frontmatter.title,
      description: p.frontmatter.description,
      section: p.frontmatter.section,
      order: p.frontmatter.order,
      excerpt: p.excerpt,
      readingTime: p.readingTime,
    })),
  })
})

// GET /api/search-index — build search index from GitHub-cached docs
// Strips HTML to plain text so the client can do full-text matching.
export const SearchIndexApiHandler = defineHandler(async (ctx) => {
  const version = getDefaultVersion()
  const pages = await getAllDocPages(version)

  const index = pages.map((p) => ({
    slug: p.slug,
    version,
    title: p.frontmatter.title,
    section: p.frontmatter.section ?? "",
    description: p.frontmatter.description ?? "",
    excerpt: p.excerpt ?? "",
    body: (p.html ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3_000),
  }))

  return ctx.json({ pages: index, createdAt: new Date().toISOString() })
})
