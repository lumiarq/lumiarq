import type { LoggingConfig } from "@lumiarq/framework"
import { app } from "@lumiarq/framework"

export default {
  level: app().isProduction() ? "error" : "debug",
  prettify: app().isLocal(),
  channels: {
    console: { driver: "console" },
    file: { driver: "file", path: "storage/logs/app.log" },
  },
  default: app().isProduction() ? "file" : "console",
} satisfies LoggingConfig
