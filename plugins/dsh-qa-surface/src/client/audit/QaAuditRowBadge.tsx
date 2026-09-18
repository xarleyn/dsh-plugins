/**
 * The row badge: "this chat was audited", and what the audit found.
 *
 * Two visually distinct things, on purpose (SPEC §52). The check mark and the
 * label say *an audit exists*; the verdict and the counts say *what it found*.
 * A green tick next to "poor" has to read as "audited, and it went badly",
 * which is why the tick is never the thing that carries the quality.
 */
import type { ReactNode } from "react";
import { findingsLabel, verdictLabel, verdictTone } from "@yadsh/dsh-audit-ui";
import type { QaAuditMark } from "./types.js";

export interface QaAuditRowBadgeProps {
  readonly mark: QaAuditMark;
  /** Whether the row also carries a delete control, which takes the right slot. */
  readonly withDelete: boolean;
  readonly onOpen: () => void;
}

export function QaAuditRowBadge(props: QaAuditRowBadgeProps): ReactNode {
  const { mark } = props;
  const tone = verdictTone(mark.verdict);
  const counts = `Проведён: ${verdictLabel(mark.verdict)} · ${findingsLabel({
    critical: mark.critical,
    major: mark.major,
    minor: mark.minor,
    observation: mark.observation,
    other: mark.other,
  })}`;
  return (
    <button
      type="button"
      className={
        props.withDelete
          ? "dsh-qa-sidebar__item-audit dsh-qa-sidebar__item-audit--with-delete"
          : "dsh-qa-sidebar__item-audit"
      }
      aria-label={`Открыть аудит чата. ${counts}`}
      title={counts}
      onClick={props.onOpen}
    >
      <svg
        className="dsh-qa-sidebar__item-audit-check"
        viewBox="0 0 14 14"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="m3 7.5 2.5 2.5L11 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`dsh-qa-sidebar__item-audit-verdict dsh-qa-sidebar__item-audit-verdict--${tone}`}
      >
        {verdictLabel(mark.verdict)}
      </span>
    </button>
  );
}
