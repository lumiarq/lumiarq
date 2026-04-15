import { app, defineHandler } from "@lumiarq/framework"
import type { WelcomePageProps } from "@/modules/Welcome/contracts/types/welcome.page.types"
import { WelcomePageTemplate } from "@/modules/Welcome/ui/web/welcome.page"
import appConfig from "@/config/app"

export const WelcomeHandler = defineHandler(async (ctx: any) => {
  return ctx.html(
    WelcomePageTemplate({
      version: "1.0.0",
      environment: app().environment(),
      appName: appConfig.name,
    } as WelcomePageProps),
  )
})
