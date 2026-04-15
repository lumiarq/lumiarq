import { type AppConfig } from "@lumiarq/framework"
import { env } from "@/bootstrap/env"

export default {
  name: env.APP_NAME,
  url: env.APP_URL,
  idempotency: { ttl: "24h", store: "session" },
} satisfies AppConfig
