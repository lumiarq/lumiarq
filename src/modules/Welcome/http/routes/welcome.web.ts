import { Route } from "@lumiarq/framework"
import { url } from "@lumiarq/framework"
import { WelcomeHandler } from "@/modules/Welcome/http/handlers/welcome.handler"
import appConfig from "@/config/app"

Route.get("/", WelcomeHandler, {
  name: "welcome",
  render: "static",
  revalidate: false,
  meta: () => ({
    title: `Welcome — ${appConfig.name}`,
    description: "A full-stack TypeScript framework inspired by Laravel.",
    canonical: url("/"),
  }),
})
