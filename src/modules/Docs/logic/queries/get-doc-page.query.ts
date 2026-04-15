import { getDocPage } from "@/modules/Docs/logic/sources/github-docs.source"
import type { DocPage } from "@/modules/Docs/contracts/types/docs.types"

export async function GetDocPageQuery(version: string, slug: string): Promise<DocPage | null> {
  const page = await getDocPage(version, slug)
  if (!page || page.frontmatter.draft) return null
  return page as DocPage
}
