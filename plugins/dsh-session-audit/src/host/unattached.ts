/**
 * Projecting an unattached record into what the browser may see.
 *
 * The registry's record carries the diagnostics the host log reads, and those
 * messages quote absolute paths — `readArtifactText` says which file it could
 * not read. A reader looking at a session needs to know *why* an audit is not
 * attached and never *where* it sits, so this projection keeps the stable
 * `code` and drops the message. It lives in one small module because that is
 * the whole decision, and a decision with a test is one that stays made.
 */
import type { AuditRecord } from "@yadsh/dsh-audit-core";
import type { UnattachedAuditValue } from "../types.js";

/**
 * One unattached record as the browser may see it.
 *
 * The blocking diagnostic is the first `error`-severity one; a record that
 * carries only warnings still reports the first of them rather than nothing,
 * because "why is this not attached" is what the reader asked.
 */
export function toUnattachedValue(record: AuditRecord): UnattachedAuditValue {
  const blocking =
    record.errors.find((error) => error.severity === "error") ??
    record.errors[0];
  return {
    auditId: record.auditId,
    status: record.status,
    code: blocking?.code ?? "",
    modifiedAt: record.modifiedAt,
  };
}
