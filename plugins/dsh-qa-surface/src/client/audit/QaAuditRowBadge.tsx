/**
 * The row badge: "this chat was audited", and what the audit found.
 *
 * Two visually distinct things, on purpose (SPEC §52). The check mark and the
 * label say *an audit exists*; the verdict and the counts say *what it found*.
 * A green tick next to "poor" has to read as "audited, and it went badly",
 * which is why the tick is never the thing that carries the quality.
 */
import type { ReactNode } from "react";
import { verdictLabel, verdictTone } from "@yadsh/dsh-audit-ui";
import type { QaAuditMark } from "./types.js";

const verdictLabels: Readonly<Record<string, string>> = {
  excellent: "Отлично",
  good: "Хорошо",
  mixed: "Есть замечания",
  poor: "Плохо",
  failed: "Неудачно",
  insufficient_evidence: "Мало данных",
};

export interface QaAuditRowBadgeProps {
  readonly mark: QaAuditMark;
  /** Whether the row also carries a delete control, which takes the right slot. */
  readonly withDelete: boolean;
  readonly onOpen: () => void;
}

export function QaAuditRowBadge(props: QaAuditRowBadgeProps): ReactNode {
  const { mark } = props;
  const tone = verdictTone(mark.verdict);
  const label = verdictLabels[mark.verdict] ?? verdictLabel(mark.verdict);
  const findings = (
    [
      [mark.critical, "критичных"],
      [mark.major, "существенных"],
      [mark.minor, "небольших"],
      [mark.observation, "наблюдений"],
      [mark.other, "прочих"],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, kind]) => `${kind}: ${count}`)
    .join(" · ");
  const counts = `Проведён: ${label} · ${findings || "Замечаний нет"}`;
  return (
    <button
      type="button"
      className={
        props.withDelete
          ? "dsh-qa-sidebar__item-audit dsh-qa-sidebar__item-audit--with-delete"
          : "dsh-qa-sidebar__item-audit"
      }
      data-testid="qa-audit-badge"
      aria-label={`Открыть аудит чата. ${counts}`}
      title={counts}
      onClick={props.onOpen}
    >
      <svg
        className="dsh-qa-sidebar__item-audit-check"
        data-testid="qa-audit-badge-check"
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
        data-testid="qa-audit-badge-verdict"
      >
        {label}
      </span>
    </button>
  );
}
