import type { MailConfig } from "@lumiarq/framework"
import { env } from "../../bootstrap/env"

export default {
  driver: env.MAIL_DRIVER ?? "stub",
  from: {
    address: env.MAIL_FROM_ADDRESS ?? "noreply@example.com",
    name: env.MAIL_FROM_NAME ?? "LumiARQ App",
  },
} satisfies MailConfig
