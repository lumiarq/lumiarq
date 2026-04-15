import type { DatabaseConfig } from "@lumiarq/framework"
import { env } from "@/bootstrap/env"
import { app } from "@lumiarq/framework"

export default {
  default: env.DB_CONNECTION ?? "sqlite",
  connections: {
    sqlite: {
      driver: "sqlite",
      url: env.DATABASE_URL,
      foreignKeyConstraints: true,
    },
    postgres: {
      driver: "postgres",
      host: env.DB_HOST ?? "localhost",
      port: env.DB_PORT ?? 5432,
      database: env.DB_DATABASE ?? "",
      username: env.DB_USERNAME ?? "",
      password: env.DB_PASSWORD ?? "",
      ssl: app().isProduction(),
      pool: {
        min: 2,
        max: 10,
        acquireTimeout: 30_000,
        idleTimeout: 10_000,
      },
    },
  },
} satisfies DatabaseConfig
