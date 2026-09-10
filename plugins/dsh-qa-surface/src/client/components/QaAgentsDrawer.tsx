import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import { relativeTime } from "./format.js";

/** One row of the agents panel: a subagent session of the open chat. */
export interface QaSubagentRow {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
  readonly completed: boolean;
  readonly meta: string;
}

/**
 * Direct subagent children of the open chat, running first. Reads the host
 * session list's lineage (parentId + origin), so no extra subscription beyond
 * the list the surface already follows.
 */
export function collectSubagents(
  byId: Readonly<Record<string, SessionSummary>>,
  rootId: string | null,
  now: number = Date.now(),
): readonly QaSubagentRow[] {
  if (rootId === null) return [];
  const rows: QaSubagentRow[] = [];
  for (const summary of Object.values(byId)) {
    if (summary.parentId !== rootId || summary.origin !== "subagent") continue;
    rows.push({
      id: summary.id,
      title: summary.blank ? "Субагент" : summary.displayTitle,
      running: summary.running,
      completed: summary.completed === true,
      meta: relativeTime(summary.updatedAt, now),
    });
  }
  return rows.sort((left, right) =>
    left.running === right.running ? 0 : left.running ? -1 : 1,
  );
}

export interface QaAgentsDrawerProps {
  readonly agents: readonly QaSubagentRow[];
  /** The subagent currently watched, if any. */
  readonly activeId: string | null;
  readonly onView: (id: string, title: string) => void;
  readonly onClose: () => void;
}

/** Right-hand panel listing the chat's subagents. */
export function QaAgentsDrawer({
  agents,
  activeId,
  onView,
  onClose,
}: QaAgentsDrawerProps) {
  return (
    <aside className="dsh-qa-agents" aria-label="Субагенты чата">
      <div className="dsh-qa-agents__head">
        <span>Субагенты ({agents.length})</span>
        <button
          type="button"
          aria-label="Закрыть список субагентов"
          title="Закрыть"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </div>
      <div className="dsh-qa-agents__list">
        {agents.map((agent) => {
          const active = activeId === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              className={
                active
                  ? "dsh-qa-agents__item dsh-qa-agents__item--active"
                  : "dsh-qa-agents__item"
              }
              onClick={() => onView(agent.id, agent.title)}
            >
              <span
                className={
                  agent.running
                    ? "dsh-qa-agents__dot dsh-qa-agents__dot--running"
                    : "dsh-qa-agents__dot"
                }
                aria-hidden="true"
              />
              <span className="dsh-qa-agents__text">
                <span className="dsh-qa-agents__title">{agent.title}</span>
                <span className="dsh-qa-agents__meta">
                  {agent.running
                    ? "выполняется"
                    : agent.completed
                      ? "завершён"
                      : agent.meta}
                </span>
              </span>
              <span className="dsh-qa-agents__open">
                {active ? "открыт" : "смотреть"}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
