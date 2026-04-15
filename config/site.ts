import { env } from "@/bootstrap/env"

export const site = {
  /** Brand */
  name: env.APP_NAME,
  titleSuffix: `— ${env.APP_NAME}`,
  logoHtml: `Lumi<span>ARQ</span>`,

  /** Theme */
  themeStorageKey: "lumiarq-theme",

  /** URLs */
  github: "https://github.com/lumiarq/lumiarq",
  twitter: "https://twitter.com/lumiarq",
  discord: "https://discord.gg/lumiarq",
  discussions: "https://github.com/lumiarq/lumiarq/discussions",
  changelog: "https://github.com/lumiarq/lumiarq/releases",
  issues: "https://github.com/lumiarq/lumiarq/issues",

  /** CDN assets */
  cdn: {
    alpine: "https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js",
    hljsDark: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css",
    hljsLight: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css",
    fonts: "https://fonts.bunny.net/css?family=inter:400,500,600,700,800&display=swap",
  },

  /** Internal navigation paths */
  nav: {
    docs: "/docs",
    installation: "/docs/1.x/installation",
    home: "/",
  },
} as const satisfies Record<string, unknown>

export type Site = typeof site
