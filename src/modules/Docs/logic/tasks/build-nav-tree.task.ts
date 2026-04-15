import type { DocNav, DocNavSection, DocNavItem } from "@/modules/Docs/contracts/types/docs.types"

// ─── Section ordering ─────────────────────────────────────────────────────────

const SECTION_ORDER: Record<string, number> = {
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
  Roadmap: 12,
}

function sectionOrder(name: string): number {
  return SECTION_ORDER[name] ?? 99
}

// ─── Input type ───────────────────────────────────────────────────────────────

interface BuildNavInput {
  pages: Array<{
    slug: string
    frontmatter: { title: string; section?: string; order: number; draft: boolean }
  }>
  currentSlug: string
  version: string
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export function BuildNavTreeTask({ pages, currentSlug, version }: BuildNavInput): DocNav {
  const sorted = [...pages].sort((a, b) => {
    const sA = a.frontmatter.section ?? ""
    const sB = b.frontmatter.section ?? ""
    if (sA !== sB) return sectionOrder(sA) - sectionOrder(sB)
    return a.frontmatter.order - b.frontmatter.order
  })

  const sectionMap = new Map<string, DocNavItem[]>()
  for (const p of sorted) {
    const section = p.frontmatter.section ?? "Overview"
    if (!sectionMap.has(section)) sectionMap.set(section, [])
    sectionMap.get(section)!.push({
      title: p.frontmatter.title,
      slug: p.slug,
      href: p.slug === "index" ? `/docs/${version}` : `/docs/${version}/${p.slug}`,
      current: p.slug === currentSlug,
    })
  }

  const sections: DocNavSection[] = Array.from(sectionMap.entries()).map(([title, items]) => ({
    title,
    items,
    hasActive: items.some((i) => i.current),
  }))

  return {
    sections,
    flat: sections.flatMap((s) => s.items),
  }
}
