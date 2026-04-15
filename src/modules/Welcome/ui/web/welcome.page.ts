import { loadLocale } from "@lumiarq/framework/veil"
import { render } from "@/storage/framework/cache/views/welcome-page.veil"
import type { WelcomePageProps } from "@/modules/Welcome/contracts/types/welcome.page.types"

const locale = loadLocale()

export function WelcomePageTemplate({ version, environment, appName }: WelcomePageProps): string {
  return render({ version, environment, appName, isLocal: environment === "local" }, locale)
}
