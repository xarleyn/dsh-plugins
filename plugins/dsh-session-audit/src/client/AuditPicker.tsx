import { useState, type ReactNode } from "react";
import { verdictLabel } from "@yadsh/dsh-audit-ui";
import type { AuditSummaryValue } from "../types.js";

const PAGE_SIZE = 40;

export function AuditPicker(props: {
  readonly label: string;
  readonly emptyLabel: string;
  readonly entries: readonly AuditSummaryValue[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}): ReactNode {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(props.entries.length / PAGE_SIZE) - 1);
  const index = Math.min(page, lastPage);
  const visible = props.entries.slice(
    index * PAGE_SIZE,
    (index + 1) * PAGE_SIZE,
  );
  const selected = props.entries.find(
    (entry) => entry.auditId === props.selected,
  );
  if (selected !== undefined && !visible.includes(selected))
    visible.unshift(selected);
  return (
    <div className="dsh-audit-picker">
      <label>
        {props.label}
        <select
          value={props.selected}
          onChange={(event) => props.onSelect(event.currentTarget.value)}
        >
          <option value="">{props.emptyLabel}</option>
          {visible.map((audit) => (
            <option key={audit.auditId} value={audit.auditId}>
              {verdictLabel(audit.verdict)} ·{" "}
              {audit.modifiedAt.replace("T", " ").slice(0, 19)} UTC ·{" "}
              {audit.auditId}
            </option>
          ))}
        </select>
      </label>
      {lastPage > 0 ? (
        <div
          className="dsh-audit-picker__pages"
          role="group"
          aria-label={`${props.label} pages`}
        >
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setPage(index - 1)}
          >
            Newer
          </button>
          <span>
            {index + 1} / {lastPage + 1}
          </span>
          <button
            type="button"
            disabled={index === lastPage}
            onClick={() => setPage(index + 1)}
          >
            Older
          </button>
        </div>
      ) : null}
    </div>
  );
}
