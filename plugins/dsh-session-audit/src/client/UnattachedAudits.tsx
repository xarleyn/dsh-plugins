/**
 * The audits that exist but appear in no session.
 *
 * An audit bound to no session is invisible by design: showing it under a
 * session it does not describe would be a lie about someone's work. Silent,
 * though, is a different thing — an operator who copies an audit into the root
 * and sees nothing anywhere has no way to tell a missing audit from one the
 * registry is holding, which is exactly the hour this notice exists to save.
 *
 * Everything it says comes from the registry's own diagnostics, so it costs no
 * file read: the host sends the stable error code and this file owns the
 * wording.
 */
import type { ReactNode } from "react";
import type { UnattachedAuditValue } from "../types.js";

/**
 * Why an audit is not attached, in the reader's words.
 *
 * The host's `message` is written for the log and names paths, so the code is
 * the only thing that crosses the wire; the wording lives here, one sentence
 * per code, and an unknown code degrades to a sentence that still tells the
 * truth about what the reader knows.
 */
const REASONS: Readonly<Record<string, string>> = {
  MISSING_ANALYSIS: "analysis.json has not arrived",
  MISSING_REPORT: "REPORT.md has not arrived",
  INVALID_JSON: "analysis.json is not valid JSON",
  INVALID_SCHEMA: "analysis.json does not match a known schema",
  UNSUPPORTED_SCHEMA: "its schema is newer than this build understands",
  SESSION_ID_MISMATCH:
    "its analysis names a different session than its directory does",
  SESSION_NOT_FOUND:
    "no session matches its directory name, and its analysis names none",
  SESSION_ID_AMBIGUOUS: "more than one session matches its directory name",
  FILE_TOO_LARGE: "an artifact is larger than the configured limit",
  READ_FAILED: "an artifact could not be read",
};

const UNKNOWN_REASON = "the registry could not say why";

export interface UnattachedAuditsProps {
  /** The audits the registry holds that no session view can show. */
  readonly items: readonly UnattachedAuditValue[];
}

/** The unseen audits, as a title, a sentence of context and the list itself. */
export function UnattachedAudits(props: UnattachedAuditsProps): ReactNode {
  const { items } = props;
  if (items.length === 0) return null;

  const title =
    items.length === 1
      ? "1 audit is not shown in any session"
      : `${items.length} audits are not shown in any session`;

  return (
    <div className="dsh-audit-unattached">
      <p className="dsh-audit-unattached__title">{title}</p>
      <p className="dsh-audit-unattached__hint">
        They sit in the audit root, but no session is bound to them, so no
        session&rsquo;s view can open them. Fix the audit or the directory name
        it is filed under, and it appears in its own session.
      </p>
      <ul className="dsh-audit-unattached__list">
        {items.map((item) => (
          <li className="dsh-audit-unattached__item" key={item.auditId}>
            <code className="dsh-audit-unattached__id">{item.auditId}</code>
            <span className="dsh-audit-unattached__reason">
              {REASONS[item.code] ?? UNKNOWN_REASON}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
