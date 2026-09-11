import { memo, useState, type ReactNode } from "react";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import { QA_VERSION, QaChangelogModal } from "./QaChangelog.js";
import { relativeTime } from "./format.js";

/** One renderable row of the chat-history sidebar. */
export interface QaChatRow {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
  readonly active: boolean;
  readonly meta: string;
  readonly updatedAt: number;
}

/**
 * Project this browser's indexed chat ids onto the host session list, most
 * recently updated first. Opening a chat is not an update: only the host's
 * `updatedAt` (fresh messages) orders the list. Ids the host no longer lists
 * are skipped (the controller prunes them on switch).
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
      updatedAt: summary.updatedAt,
    });
  }
  return rows.sort((left, right) => right.updatedAt - left.updatedAt);
}

export interface QaSidebarProps {
  readonly rows: readonly QaChatRow[];
  /** Deployment brand shown next to the logo (also while collapsed). */
  readonly title: string;
  /** Optional image logo; a built-in mark is drawn when null. */
  readonly logoUrl: string | null;
  /** Storage prefix used to remember the collapsed state across reloads. */
  readonly stateKey: string;
  readonly showNewChat: boolean;
  readonly busy: boolean;
  readonly onSwitch: (sessionId: string) => void;
  readonly onNewChat: () => void;
  /** Removes a chat from this browser's index; omit to hide the control. */
  readonly onDelete?: (sessionId: string) => void;
  /** The signed-in account; omit when accounts are disabled. */
  readonly account?: {
    readonly email: string;
    readonly role: string;
    readonly onLogout: () => void;
  };
}

function readCollapsed(key: string): boolean {
  try {
    return window.localStorage.getItem(`${key}:sidebar-collapsed`) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(key: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      `${key}:sidebar-collapsed`,
      collapsed ? "1" : "0",
    );
  } catch {
    // A denied localStorage write only costs persistence across reloads.
  }
}

function DefaultMark() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.75a6.4 6.4 0 0 0-4.9 10.52c.2.24.28.5.24.79l-.2 1.44 1.9-.7c.24-.09.5-.06.74.05A6.4 6.4 0 1 0 10 2.75Z" />
      <path d="M7.4 8.1h5.2M7.4 11h3.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 2.8v8.4M2.8 7h8.4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="6.25" cy="6.25" r="3.75" />
      <path d="m9.2 9.2 2.55 2.55" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="m8.75 3.5-3.5 3.5 3.5 3.5" />
    </svg>
  );
}

function rowMatches(row: QaChatRow, query: string): boolean {
  return row.title.toLowerCase().includes(query);
}

/**
 * Whether two sidebar row lists show the same thing. Rows are rebuilt on
 * every surface render (relative timestamps drift), so the memoized sidebar
 * compares by content and skips frames that only move the transcript.
 */
export function sameChatRows(
  a: readonly QaChatRow[],
  b: readonly QaChatRow[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index] as QaChatRow;
    return (
      row.id === other.id &&
      row.title === other.title &&
      row.running === other.running &&
      row.active === other.active &&
      row.meta === other.meta &&
      row.updatedAt === other.updatedAt
    );
  });
}

/** The per-browser chat history shown beside the QA conversation. */
export const QaSidebar = memo(
  function QaSidebar(props: QaSidebarProps) {
    const [collapsed, setCollapsed] = useState(() =>
      readCollapsed(props.stateKey),
    );
    const [query, setQuery] = useState("");
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [changelogOpen, setChangelogOpen] = useState(false);
    const toggleCollapsed = () => {
      const next = !collapsed;
      setCollapsed(next);
      writeCollapsed(props.stateKey, next);
    };
    if (collapsed) {
      return (
        <nav
          className="dsh-qa-sidebar dsh-qa-sidebar--collapsed"
          aria-label="История чатов"
        >
          <button
            type="button"
            className="dsh-qa-sidebar__expand"
            aria-label="Развернуть историю чатов"
            title="Развернуть историю чатов"
            onClick={toggleCollapsed}
          >
            <ChevronIcon />
          </button>
        </nav>
      );
    }
    const normalizedQuery = query.trim().toLowerCase();
    const visibleRows =
      normalizedQuery === ""
        ? props.rows
        : props.rows.filter((row) => rowMatches(row, normalizedQuery));
    const confirmingVisible =
      confirmingId !== null &&
      props.rows.some((row) => row.id === confirmingId);
    const brand: ReactNode =
      props.logoUrl === null ? (
        <DefaultMark />
      ) : (
        <img src={props.logoUrl} alt="" />
      );
    return (
      <nav className="dsh-qa-sidebar" aria-label="История чатов">
        <div className="dsh-qa-sidebar__head">
          <span className="dsh-qa-sidebar__brand" title={props.title}>
            <span className="dsh-qa-sidebar__logo">{brand}</span>
            <span className="dsh-qa-sidebar__name">{props.title}</span>
          </span>
          <button
            type="button"
            className="dsh-qa-sidebar__collapse"
            aria-label="Свернуть историю чатов"
            title="Свернуть историю чатов"
            onClick={toggleCollapsed}
          >
            <ChevronIcon />
          </button>
        </div>
        {props.showNewChat ? (
          <div className="dsh-qa-sidebar__newbar">
            <button
              type="button"
              className="dsh-qa-sidebar__new"
              disabled={props.busy}
              onClick={props.onNewChat}
            >
              <PlusIcon />
              Новый чат
            </button>
          </div>
        ) : null}
        <div className="dsh-qa-sidebar__search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            placeholder="Поиск по чатам"
            aria-label="Поиск по чатам"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div className="dsh-qa-sidebar__list">
          {props.rows.length === 0 ? (
            <p className="dsh-qa-sidebar__empty">Здесь пока пусто</p>
          ) : visibleRows.length === 0 ? (
            <p className="dsh-qa-sidebar__empty">Ничего не найдено</p>
          ) : (
            visibleRows.map((row) => {
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
                      {confirming ? (
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="m3.5 8.5 3 3L12.5 5" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M2.5 4h11M6.5 4V2.5h3V4m-6.2 0 .6 9.5h7.2L12 4" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="dsh-qa-sidebar__footer">
          {props.account === undefined ? null : (
            <div
              className="dsh-qa-sidebar__account"
              title={`${props.account.email} (${props.account.role})`}
            >
              <span className="dsh-qa-sidebar__account-name">
                {props.account.email}
                {props.account.role === "admin" ? " · admin" : ""}
              </span>
              <button
                type="button"
                className="dsh-qa-sidebar__account-exit"
                title="Выйти из аккаунта"
                aria-label="Выйти из аккаунта"
                onClick={props.account.onLogout}
              >
                <svg viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M8.5 2.5h3v9h-3M5.5 9.5 3 7l2.5-2.5M3 7h6" />
                </svg>
              </button>
            </div>
          )}
          <button
            type="button"
            className="dsh-qa-sidebar__version"
            aria-haspopup="dialog"
            title="История версий"
            onClick={() => setChangelogOpen(true)}
          >
            Версия {QA_VERSION}
          </button>
        </div>
        <QaChangelogModal
          open={changelogOpen}
          onClose={() => setChangelogOpen(false)}
        />
      </nav>
    );
  },
  (prev, next) =>
    prev.title === next.title &&
    prev.logoUrl === next.logoUrl &&
    prev.stateKey === next.stateKey &&
    prev.showNewChat === next.showNewChat &&
    prev.busy === next.busy &&
    prev.onSwitch === next.onSwitch &&
    prev.onNewChat === next.onNewChat &&
    prev.onDelete === next.onDelete &&
    prev.account?.email === next.account?.email &&
    prev.account?.role === next.account?.role &&
    prev.account?.onLogout === next.account?.onLogout &&
    sameChatRows(prev.rows, next.rows),
);
