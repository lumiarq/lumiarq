import type { NeatConfig } from "@lumiarq/framework"

export default {
  format: {
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
    sortTailwindClasses: true,
  },
  structure: {
    enforceModuleConventions: true,
    enforceConfigTypes: true,
    enforceRouteFiles: false,
  },
  rules: {
    "format.parse-failed": "error",
    "format.file-not-neat": "error",
    "structure.module-templates-required": "error",
    "structure.config-satisfies-required": "warn",
  },
  overrides: [
    {
      files: ".arc/**",
      ignore: true,
    },
    {
      files: "src/shared/ui/assets/**",
      ignore: true,
    },
    {
      files: "config/**/*.ts",
      rules: {
        "structure.config-satisfies-required": "warn",
      },
    },
  ],
  audit: {
    showFixes: true,
    showRuleIds: true,
    maxItems: 50,
    sarif: {
      enabled: false,
      output: "storage/framework/reports/neat.sarif.json",
    },
  },
  ignore: ["public/", "storage/"],
} satisfies NeatConfig
