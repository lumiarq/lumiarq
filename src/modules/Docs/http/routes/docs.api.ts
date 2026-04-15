import { Route } from "@lumiarq/framework"
import { DocsListApiHandler, SearchIndexApiHandler } from "@/modules/Docs/http/handlers/docs-api.handler"

Route.get("/api/docs", DocsListApiHandler, {
  name: "docs.api.list",
  render: "static",
})

// Serves the search index for client-side Algolia-style search
Route.get("/api/search-index", SearchIndexApiHandler, {
  name: "docs.api.search-index",
  render: "static",
})
