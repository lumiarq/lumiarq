import { createConnection } from "@lumiarq/framework/database"

export async function createTestDb() {
  const db = await createConnection({
    url: ":memory:",
  })

  return db
}
