import { loadLocale } from "@lumiarq/framework/veil"
import { getContext } from "@lumiarq/framework/context"
import type { DocsPageTemplateProps } from "@/modules/Docs/ui/web/types/page.types"
import { render } from "@/storage/framework/cache/views/docs-page.veil"
import { render as renderUnavailable } from "@/storage/framework/cache/views/docs-unavailable-page.veil"

export function DocsPageTemplate(props: DocsPageTemplateProps): string {
  const locale = loadLocale(getContext().locale)
  return render(props, locale)
}

export function DocsUnavailableTemplate(): string {
  const locale = loadLocale(getContext().locale)
  return renderUnavailable({}, locale)
}
