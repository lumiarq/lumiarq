import { getAllDocPages } from "@/modules/Docs/logic/sources/github-docs.source"
import type { DocPage } from "@/modules/Docs/contracts/types/docs.types"

export async function GetAllDocPagesQuery(version: string): Promise<DocPage[]> {
  const pages = await getAllDocPages(version)
  return pages.filter((p) => !p.frontmatter.draft) as DocPage[]
}
