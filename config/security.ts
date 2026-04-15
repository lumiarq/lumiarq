import { type SecurityConfig } from "@lumiarq/framework"
import { env } from "../bootstrap/env"

export default {
  trustedProxies: ["*"],
  rateLimitPerMinute: 60,
  cors: { origins: [env.APP_URL], credentials: true },
  bodyScanning: { enabled: true, patterns: ["sql-injection", "xss"] },
} satisfies SecurityConfig
