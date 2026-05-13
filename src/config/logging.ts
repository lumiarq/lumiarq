import type { LoggingConfig } from "@lumiarq/framework"
import { env } from "@/bootstrap/env"

export default {
  level: env.APP_ENV === "production" ? "error" : "debug",
  prettify: env.APP_ENV === "local",
  channels: {
    console: { driver: "console" },
    file: { driver: "file", path: "src/storage/logs/lumiarq.log" },
  },
  default: env.APP_ENV === "production" ? "file" : "console",
} satisfies LoggingConfig
