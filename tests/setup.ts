import { beforeAll, afterAll, afterEach, vi } from "vitest"
import { eventBus } from "@lumiarq/framework"

process.env.APP_ENV = "testing"
process.env.NODE_ENV = "test"
process.env.DATABASE_URL = ":memory:"

beforeAll(async () => {
  // Global setup — add external service mocking here if needed
})

afterAll(async () => {
  // Global teardown
})

afterEach(() => {
  // Always clear EventBus listeners between tests
  eventBus.clearListeners()
  vi.clearAllMocks()
})
