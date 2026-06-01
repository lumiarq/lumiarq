import { type AuthConfig } from "@lumiarq/framework"

export default {
  features: {
    emailVerification: true,
    passwordConfirmation: true,
  },
} satisfies AuthConfig
