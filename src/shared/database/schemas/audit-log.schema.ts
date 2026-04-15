import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  actorId: text("actor_id"),
  actorType: text("actor_type", {
    enum: ["user", "system", "scheduler"],
  }),
  input: text("input").notNull(),
  resultSummary: text("result_summary"),
  status: text("status", {
    enum: ["success", "failure", "unauthorized"],
  }).notNull(),
  error: text("error"),
  durationMs: integer("duration_ms").notNull(),
  requestId: text("request_id"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
})
