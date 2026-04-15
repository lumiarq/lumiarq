import { app } from "@lumiarq/framework"

import type {
  MailerContract,
  QueueContract,
  StorageContract,
  CacheContract,
  AuditContract,
  LoggerContract,
} from "@lumiarq/framework/contracts"

import { StubMailer, StubQueue, StubStorage, StubCache, StubAudit, RequestLogger } from "@lumiarq/framework/runtime"

import loggingConfig from "@/config/logging"
import storageConfig from "@/config/storage"

/* These bindings are intentionally local-first starter implementations.
 * They keep the app runnable on day one, and can be replaced incrementally
 * as infrastructure moves from local development to real production services.
 */

// Logger — reads ExecutionContext from ALS at log time
// Developers write: logger.info('message') — requestId + actorId auto-injected
export const logger: LoggerContract = new RequestLogger({
  level: loggingConfig.level,
  prettify: loggingConfig.prettify,
})

// Mailer — v1: logs to console, does not send
// v2: replace with new ResendMailer(mailConfig) or new SMTPMailer(mailConfig)
export const mailer: MailerContract = new StubMailer({ logger })

// Queue — v1: executes jobs synchronously in-process
// v2: replace with new BullMQQueue(queueConfig) or new DatabaseQueue(queueConfig)
export const queue: QueueContract = new StubQueue({ logger })

// Storage — v1: reads/writes to storage/app/ on local filesystem
// v2: replace with new S3Storage(storageConfig) or new R2Storage(storageConfig)
export const storage: StorageContract = new StubStorage({
  root: storageConfig.disks.local.root,
  logger,
})

// Cache — v1: in-memory Map, cleared on restart
// v2: replace with new RedisCache(cacheConfig) or new CloudflareKVCache(cacheConfig)
export const cache: CacheContract = new StubCache()

// Audit — reads ExecutionContext from ALS at record time
// resolveActor() derives actorType from contextType — no explicit params needed
export const audit: AuditContract = new StubAudit({
  verbose: app().isLocal(),
})
