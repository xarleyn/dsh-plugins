/**
 * The producer entry point.
 *
 * Published as its own subpath (`@yadsh/dsh-audit-core/producer`) because it is
 * the only part of this package that touches the filesystem. Nothing a browser
 * bundle can reach imports it, and the main entry stays free of `node:fs`.
 */
export {
  publishAudit,
  AuditPublishError,
  type PublishAuditRequest,
  type PublishAuditResult,
} from "./publish-audit.js";
