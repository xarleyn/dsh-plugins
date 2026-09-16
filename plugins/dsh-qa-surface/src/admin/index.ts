/**
 * The administrative console's server side: authorization, conversation
 * queries over stored session logs, the quality records (feedback, reviews,
 * the derived queue, the audit trail) and their aggregations.
 */
export { QaAdminService } from "./service.js";
export type { QaAdminServiceOptions } from "./service.js";
export {
  QA_ADMIN_PAGE_DEFAULT,
  QA_ADMIN_PAGE_MAX,
  QA_ADMIN_SCAN_LIMIT,
} from "./service.js";
export {
  allows,
  permissionsOf,
  readsEveryConversation,
} from "./permissions.js";
export { QaQualityStore, defaultQualityFilePath } from "./quality-store.js";
export type { QaManualQueueEntry } from "./quality-store.js";
export {
  QA_FEEDBACK_REASONS,
  QA_FEEDBACK_RATINGS,
  QA_QUALITY_ISSUES,
  QA_QUALITY_SEVERITIES,
  QA_REMEDIATION_TARGETS,
} from "./quality-store.js";
export { aggregateQuality } from "./metrics.js";
export type { QaConversationFact } from "./metrics.js";
export { deriveQueue } from "./queue.js";
export type { QaQueueInput, QaToolFailureSignal } from "./queue.js";
export { paginate } from "./paging.js";
export { projectTranscript } from "./conversation-log.js";
export type {
  QaProjectedTranscript,
  StoredSessionEvent,
} from "./conversation-log.js";
export {
  createSessionLogReader,
  staticSessionLogReader,
} from "./session-log.js";
export type {
  QaSessionLogReader,
  QaSessionReadResult,
  QaStoredSessionHeader,
} from "./session-log.js";
export { defaultAdminRedactor, maskSecrets } from "./redaction.js";
export type { QaAdminRedactor } from "./redaction.js";
