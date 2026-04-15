import { GetAllDocPagesQuery } from "./get-all-doc-pages.query"
import { BuildNavTreeTask } from "../tasks/build-nav-tree.task"
import type { DocNav } from "@/modules/Docs/contracts/types/docs.types"

export async function GetDocNavQuery(version: string, currentSlug: string): Promise<DocNav> {
  const pages = await GetAllDocPagesQuery(version)
  return BuildNavTreeTask({ pages, currentSlug, version })
}
