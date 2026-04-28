import type { QueueConfig } from "@lumiarq/framework"
import { env } from "../../bootstrap/env"

export default {
  driver: env.QUEUE_DRIVER ?? "stub",
  default: "default",
  queues: {
    default: { concurrency: 5 },
    events: { concurrency: 10 },
    mail: { concurrency: 3 },
    schedule: { concurrency: 2 },
  },
} satisfies QueueConfig
