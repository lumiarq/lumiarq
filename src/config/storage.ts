import type { StorageConfig } from "@lumiarq/framework"
import { env } from "../../bootstrap/env"
import { join } from "path"

export default {
  driver: env.STORAGE_DRIVER ?? "local",
  default: "local",
  disks: {
    local: {
      driver: "local",
      root: join(process.cwd(), "storage/app"),
    },
    public: {
      driver: "local",
      root: join(process.cwd(), "public/storage"),
      visibility: "public" as const,
    },
  },
} satisfies StorageConfig
