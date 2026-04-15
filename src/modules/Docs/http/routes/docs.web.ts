import { Route, url } from "@lumiarq/framework"
import { DocsPageHandler } from "@/modules/Docs/http/handlers/docs-page.handler"
import appConfig from "@/config/app"

// /docs  →  default version index
Route.get("/docs", DocsPageHandler, {
  name: "docs.index",
  render: "static",
  meta: () => ({
    title: `Documentation — ${appConfig.name}`,
    description: "Complete guide to building applications with the LumiARQ framework.",
    canonical: url("/docs"),
  }),
})

// /docs/:version  →  index page for that version, e.g. /docs/1.x
Route.get("/docs/:version", DocsPageHandler, {
  name: "docs.version.index",
  render: "static",
  meta: ({ params }) => ({
    title: `Documentation ${params.version ?? ""} — ${appConfig.name}`,
    description: "LumiARQ framework documentation.",
    canonical: url(`/docs/${params.version}`),
  }),
})

// /docs/:version/:slug  →  specific page, e.g. /docs/1.x/routing
Route.get("/docs/:version/:slug", DocsPageHandler, {
  name: "docs.page",
  render: "static",
  meta: ({ params }) => ({
    title: `${params.slug?.replace(/-/g, " ") ?? "Documentation"} — ${appConfig.name}`,
    description: "LumiARQ framework documentation.",
    canonical: url(`/docs/${params.version}/${params.slug}`),
  }),
})
