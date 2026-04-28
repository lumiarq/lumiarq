import type { CacheConfig } from "@lumiarq/framework"
import { env } from "@/bootstrap/env"

export default {
  driver: env.CACHE_DRIVER ?? "memory",
  prefix: "lumiarq",
  ttl: { default: 3600 },
} satisfies CacheConfig
