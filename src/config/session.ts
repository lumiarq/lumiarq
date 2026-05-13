import { type SessionConfig } from "@lumiarq/framework"
import { env } from "../../bootstrap/env"

export default {
  driver: env.SESSION_DRIVER ?? "database",
  lifetime: 7 * 24 * 60,
  cookie: {
    name: "lumiarq_session",
    httpOnly: true,
    sameSite: "Lax",
    secure: env.APP_ENV === "production",
  },
} satisfies SessionConfig
