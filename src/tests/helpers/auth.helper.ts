import { withTestContext } from "@lumiarq/framework/runtime"

export interface TestAuthOptions {
  userId?: string
  identityId?: string
  email?: string
  role?: string
  locale?: string
  verified?: boolean
}

// Returns withTestContext overrides for unit/integration tests
export function asAuthContext(options: TestAuthOptions = {}) {
  return {
    userId: options.userId ?? crypto.randomUUID(),
    role: options.role ?? "USER",
    locale: options.locale ?? "en",
  }
}

// Creates a real JWT token for feature tests
// Auth module must be installed (lumis auth:install) before this is usable
export async function createTestAuth(options: TestAuthOptions = {}): Promise<{ token: string; userId: string }> {
  // Implemented after lumis auth:install adds IssueJwtTask
  // Placeholder until Auth module is installed
  const userId = options.userId ?? crypto.randomUUID()
  return { token: `test-token-${userId}`, userId }
}
