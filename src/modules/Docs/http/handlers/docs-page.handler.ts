import { defineHandler } from "@lumiarq/framework"
import { env } from "@/bootstrap/env"
import { DocsPageTemplate, DocsUnavailableTemplate } from "@/modules/Docs/ui/web/docs.page"
import { GetDocPageQuery } from "@/modules/Docs/logic/queries/get-doc-page.query"
import { GetDocNavQuery } from "@/modules/Docs/logic/queries/get-doc-nav.query"
import { getVersions, getDefaultVersion } from "@/modules/Docs/logic/sources/github-docs.source"

export const DocsPageHandler = defineHandler(async (ctx) => {
  // URL shapes:
  //   /docs                   → default version, "index" slug
  //   /docs/:version          → specified version, "index" slug
  //   /docs/:version/:slug    → specified version + slug
  const versionParam = ctx.req.param("version")
  const slugParam = ctx.req.param("slug")

  const versions = getVersions()
  const defaultVersion = getDefaultVersion()

  // Real versions always contain a dot or equal "master"/"main": e.g. "1.x"
  const isVersion = versionParam
    ? /^\d+\.\w+$/.test(versionParam) || versionParam === "master" || versionParam === "main"
    : false

  const version = isVersion ? versionParam! : defaultVersion
  const slug = isVersion ? (slugParam ?? "index") : (versionParam ?? "index") // versionParam holds the slug when no real version given

  const [page, nav] = await Promise.all([GetDocPageQuery(version, slug), GetDocNavQuery(version, slug)])

  if (!page) {
    return ctx.html(DocsUnavailableTemplate(), 503)
  }

  const editOnGithub = `https://github.com/${env.DOCS_GITHUB_OWNER}/${env.DOCS_GITHUB_REPO}/blob/${version}/${slug}.md`

  return ctx.html(DocsPageTemplate({ page, nav, activeVersion: version, versions, editOnGithub }))
})
