import { type AuthConfig } from "@lumiarq/framework"
import type { A } from "vitest/dist/reporters-w_64AS5f.js"

export default {
  features: {
    emailVerification: true,
    passwordConfirmation: true,
  },
} satisfies AuthConfig
