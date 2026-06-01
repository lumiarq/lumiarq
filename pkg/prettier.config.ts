import type { Config } from "prettier"

const config: Config = {
  semi: false,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "all",
  printWidth: 120,
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
  plugins: ["@lumiarq/prettier-plugin-veil"],
}

export default config
