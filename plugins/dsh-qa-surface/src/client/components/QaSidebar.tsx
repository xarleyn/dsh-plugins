import { useState } from "react";
import type { SessionSummary } from "@deepseek-ai/dsh-client-runtime/client";

/** One renderable row of the chat-history sidebar. */
export interface QaChatRow {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
  readonly active: boolean;
  readonly meta: string;
}

function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(1, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "только что";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} дн`;
  return new Date(timestamp).toLocaleDateString("ru-RU");
}

/**
 * Project this browser's indexed chat ids onto the host session list. Ids the
 * host no longer lists are skipped (the controller prunes them on switch);
 * order stays the index's most-recently-used order.
 */
export function buildChatRows(
  chatIds: readonly string[],
  byId: Readonly<Record<string, SessionSummary>>,
  activeId: string | null,
  now: number = Date.now(),
): readonly QaChatRow[] {
  const rows: QaChatRow[] = [];
  for (const id of chatIds) {
    const summary = byId[id];
    if (summary === undefined) continue;
    rows.push({
      id,
      title: summary.blank ? "Новый чат" : summary.displayTitle,
      running: summary.running,
      active: id === activeId,
      meta: relativeTime(summary.updatedAt, now),
    });
  }
  return rows;
}

export interface QaSidebarProps {
  readonly rows: readonly QaChatRow[];
  readonly showNewChat: boolean;
  readonly busy: boolean;
  readonly onSwitch: (sessionId: string) => void;
  readonly onNewChat: () => void;
  /** Removes a chat from this browser's index; omit to hide the control. */
  readonly onDelete?: (sessionId: string) => void;
}

const TRASH_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4h11M6.5 4V2.5h3V4m-6.2 0 .6 9.5h7.2L12 4" />
  </svg>
);

const CONFIRM_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3L12.5 5" />
  </svg>
);

/** The minimal per-browser chat history shown beside the QA conversation. */
export function QaSidebar(props: QaSidebarProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmingVisible =
    confirmingId !== null && props.rows.some((row) => row.id === confirmingId);
  return (
    <nav className="dsh-qa-sidebar" aria-label="История чатов">
      <div className="dsh-qa-sidebar__head">
        <span className="dsh-qa-sidebar__title">Чаты</span>
        {props.showNewChat ? (
          <button
            type="button"
            className="dsh-qa-sidebar__new"
            disabled={props.busy}
            onClick={props.onNewChat}
          >
            Новый чат
          </button>
        ) : null}
      </div>
      <div className="dsh-qa-sidebar__list">
        {props.rows.length === 0 ? (
          <p className="dsh-qa-sidebar__empty">Здесь пока пусто</p>
        ) : (
          props.rows.map((row) => {
            const confirming = confirmingVisible && confirmingId === row.id;
            return (
              <div
                key={row.id}
                className={
                  row.active
                    ? "dsh-qa-sidebar__item dsh-qa-sidebar__item--active"
                    : "dsh-qa-sidebar__item"
                }
              >
                <button
                  type="button"
                  className="dsh-qa-sidebar__item-main"
                  aria-current={row.active ? "true" : undefined}
                  onClick={() => props.onSwitch(row.id)}
                >
                  <span className="dsh-qa-sidebar__item-title">
                    {row.title}
                  </span>
                  <span className="dsh-qa-sidebar__item-meta">
                    {row.running ? (
                      <span
                        className="dsh-qa-sidebar__dot"
                        role="img"
                        aria-label="Выполняется"
                      />
                    ) : null}
                    {row.meta}
                  </span>
                </button>
                {props.onDelete === undefined ? null : (
                  <button
                    type="button"
                    className={
                      confirming
                        ? "dsh-qa-sidebar__item-delete dsh-qa-sidebar__item-delete--confirm"
                        : "dsh-qa-sidebar__item-delete"
                    }
                    aria-label={
                      confirming ? "Подтвердить удаление чата" : "Удалить чат"
                    }
                    title={
                      confirming
                        ? "Нажмите ещё раз для удаления"
                        : "Удалить чат"
                    }
                    onClick={() => {
                      if (confirming) {
                        setConfirmingId(null);
                        props.onDelete?.(row.id);
                        return;
                      }
                      setConfirmingId(row.id);
                    }}
                  >
                    {confirming ? CONFIRM_ICON : TRASH_ICON}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </nav>
  );
}
