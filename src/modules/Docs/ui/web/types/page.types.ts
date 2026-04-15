import type { TocEntry, ContentPage } from "@lumiarq/framework"
import type { DocFrontmatter, DocNav } from "@/modules/Docs/contracts/types/docs.types"

export type { TocEntry }

// DocsPageData is the full ContentPage shape — no mapping needed between loader and template
export type DocsPageData = ContentPage<DocFrontmatter>

export interface DocsPageTemplateProps {
  page: DocsPageData
  nav: DocNav
  activeVersion: string
  versions: string[]
  /** Full URL to edit this page on GitHub */
  editOnGithub: string
}
