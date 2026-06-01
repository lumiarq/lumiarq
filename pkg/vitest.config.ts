import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

const projectRoot = resolve(import.meta.dirname, "..")

export default defineConfig({
  test: {
    root: projectRoot,
    passWithNoTests: true,
    globals: true,
    environment: "node",
    setupFiles: [resolve(projectRoot, "src/tests/setup.ts")],
    include: ["src/modules/**/tests/**/*.test.ts", "src/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(projectRoot, "src"),
      "@/modules": resolve(projectRoot, "src/modules"),
      "@/shared": resolve(projectRoot, "src/shared"),
      "@/bootstrap": resolve(projectRoot, "bootstrap"),
      "@/config": resolve(projectRoot, "src/config"),
      "@/lang": resolve(projectRoot, "src/lang"),
      "@/storage": resolve(projectRoot, "src/storage"),
    },
  },
})
