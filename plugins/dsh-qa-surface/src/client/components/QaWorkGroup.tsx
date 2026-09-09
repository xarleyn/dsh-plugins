import { useEffect, useRef, useState } from "react";
import type { QaWorkItem } from "../../types.js";
import { Markdown } from "./Markdown.js";

export interface QaWorkGroupProps {
  readonly status: "running" | "complete";
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly items: readonly QaWorkItem[];
  readonly renderMarkdown: boolean;
}

export function formatWorkDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 1) return "< 1 с";
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} мин` : `${minutes} мин ${remainder} с`;
}

export const THINKING_PHRASES = Object.freeze([
  "Скребу по сусекам…",
  "Кумекаю…",
  "Навожу резкость…",
  "Собираю мысли в кучку…",
  "Раскладываю по полочкам…",
  "Сверяю приметы…",
]);

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      className="dsh-qa-work__chevron"
      data-open={open || undefined}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <path d="m5.25 3.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}

function ThinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.25a4.25 4.25 0 0 0-2.45 7.72c.48.34.7.72.7 1.15v.13h3.5v-.13c0-.43.22-.81.7-1.15A4.25 4.25 0 0 0 8 2.25Z" />
      <path d="M6.35 13h3.3M6.9 14.5h2.2" />
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.8 2.4a3.2 3.2 0 0 0-3.73 4.12l-3.4 3.4a1.55 1.55 0 1 0 2.2 2.2l3.4-3.4A3.2 3.2 0 0 0 12.4 5l-1.85 1.1-1.5-1.5L9.8 2.4Z" />
    </svg>
  );
}

function RobotIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="5" width="10" height="7.5" rx="1.75" />
      <path d="M8 2.5V5m0-.25a.9.9 0 1 0-.01-1.8.9.9 0 0 0 .01 1.8ZM5.4 8.4h1.7M8.9 8.4h1.7M6 10.4h4" />
    </svg>
  );
}

function isDelegationTool(name: string): boolean {
  return name === "subagent" || name === "subagent_fork";
}

function WorkItemIcon({ item }: { readonly item: QaWorkItem }) {
  if (item.kind !== "tool") return <ThinkIcon />;
  if (isDelegationTool(item.name)) return <RobotIcon />;
  if (item.status === "running") {
    return <span className="dsh-qa-work-item__spinner" aria-hidden="true" />;
  }
  if (item.status === "ok") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m3.5 8.25 2.7 2.7 6.3-6.3" />
      </svg>
    );
  }
  return <ToolIcon />;
}

function toolStatusLabel(
  status: Extract<QaWorkItem, { kind: "tool" }>["status"],
) {
  switch (status) {
    case "running":
      return "Выполняется";
    case "ok":
      return "Готово";
    case "error":
      return "Ошибка";
    case "stopped":
      return "Остановлено";
  }
}

function QaToolWorkItem({
  item,
}: {
  readonly item: Extract<QaWorkItem, { kind: "tool" }>;
}) {
  const expandable = item.input !== null || item.output !== null;
  const delegation = isDelegationTool(item.name);
  const header = (
    <>
      <span className="dsh-qa-work-item__icon" data-state={item.status}>
        <WorkItemIcon item={item} />
      </span>
      <span className="dsh-qa-work-item__label">{item.label}</span>
      <span className="dsh-qa-work-item__summary">{item.summary}</span>
      {item.subagentId === undefined ? null : (
        <span className="dsh-qa-work-item__agent-id" title={item.subagentId}>
          {item.subagentId.slice(0, 8)}
        </span>
      )}
      <span className="dsh-qa-sr-only">{toolStatusLabel(item.status)}</span>
      {expandable ? <Chevron open={false} /> : null}
    </>
  );

  if (!expandable) {
    return (
      <div
        className="dsh-qa-work-item dsh-qa-work-item--tool"
        data-tool={delegation ? "subagent" : undefined}
      >
        {header}
      </div>
    );
  }
  return (
    <details
      className="dsh-qa-work-tool"
      data-tool={delegation ? "subagent" : undefined}
    >
      <summary className="dsh-qa-work-item dsh-qa-work-item--tool">
        {header}
      </summary>
      <div className="dsh-qa-work-tool__body">
        {item.input === null ? null : (
          <section aria-label={`Входные данные: ${item.label}`}>
            <span>Входные данные</span>
            <pre>{item.input}</pre>
          </section>
        )}
        {item.output === null ? null : (
          <section aria-label={`Результат: ${item.label}`}>
            <span>Результат</span>
            <pre>{item.output}</pre>
          </section>
        )}
      </div>
    </details>
  );
}

function QaTextWorkItem({
  item,
  renderMarkdown,
}: {
  readonly item: Extract<QaWorkItem, { kind: "reasoning" | "progress" }>;
  readonly renderMarkdown: boolean;
}) {
  return (
    <section
      className="dsh-qa-work-item dsh-qa-work-item--text"
      data-state={item.status}
      aria-label={item.kind === "reasoning" ? "Рассуждение" : "Ход работы"}
    >
      <div className="dsh-qa-work-item__text-head">
        <span className="dsh-qa-work-item__icon">
          <ThinkIcon />
        </span>
        <span className="dsh-qa-work-item__label">
          {item.kind === "reasoning" ? "Размышление" : "Ход работы"}
        </span>
      </div>
      <div className="dsh-qa-work-item__text">
        {renderMarkdown ? <Markdown text={item.text} /> : item.text}
      </div>
    </section>
  );
}

export function QaWorkGroup({
  status,
  startedAt,
  endedAt,
  items,
  renderMarkdown,
}: QaWorkGroupProps) {
  const [open, setOpen] = useState(status === "running");
  const [now, setNow] = useState(() => Date.now());
  const previousStatus = useRef(status);

  useEffect(() => {
    if (previousStatus.current === "running" && status === "complete") {
      setOpen(false);
    } else if (previousStatus.current === "complete" && status === "running") {
      setOpen(true);
    }
    previousStatus.current = status;
  }, [status]);

  useEffect(() => {
    if (status !== "running" || startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt, status]);

  const duration =
    startedAt === undefined
      ? null
      : formatWorkDuration((endedAt ?? now) - startedAt);
  const label =
    status === "running"
      ? `${
          THINKING_PHRASES[
            Math.floor(
              Math.max(0, (endedAt ?? now) - (startedAt ?? now)) / 4_000,
            ) % THINKING_PHRASES.length
          ]
        }${duration === null ? "" : ` · ${duration}`}`
      : duration === null
        ? "Ход работы"
        : `Готово за ${duration}`;

  return (
    <section className="dsh-qa-work" data-state={status}>
      <button
        type="button"
        className="dsh-qa-work__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {status === "running" ? (
          <span className="dsh-qa-work__spinner" aria-hidden="true" />
        ) : null}
        <span>{label}</span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="dsh-qa-work__body">
          {items.map((item) =>
            item.kind === "tool" ? (
              <QaToolWorkItem key={item.id} item={item} />
            ) : (
              <QaTextWorkItem
                key={item.id}
                item={item}
                renderMarkdown={renderMarkdown}
              />
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}
