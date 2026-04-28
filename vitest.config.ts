import { defineConfig } from "vitest/config"
import { resolve } from "path"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/tests/setup.ts"],
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
      "@": resolve(__dirname, "src"),
      "@/modules": resolve(__dirname, "src/modules"),
      "@/shared": resolve(__dirname, "src/shared"),
      "@/bootstrap": resolve(__dirname, "bootstrap"),
      "@/config": resolve(__dirname, "src/config"),
      "@/lang": resolve(__dirname, "src/lang"),
      "@/storage": resolve(__dirname, "src/storage"),
    },
  },
})
