import { memo, useRef, useState, type ReactNode } from "react";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import { isDelegatedSession } from "../lineage.js";
import { QaAuditRowBadge } from "../audit/QaAuditRowBadge.js";
import { auditMark, type QaAuditSummary } from "../audit/types.js";
import { QaSettingsButton } from "../user-settings/fields.js";
import { QA_VERSION, QaChangelogModal } from "./QaChangelog.js";
import { QaModal } from "./QaModal.js";
import { relativeTime } from "./format.js";
import { QaSidebarHandle, useQaSidebarWidth } from "./QaWidthHandle.js";

/** One renderable row of the chat-history sidebar. */
export interface QaChatRow {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
  readonly active: boolean;
  readonly meta: string;
  readonly updatedAt: number;
  /** Chat owner's display name; present in the admin ownership view only. */
  readonly ownerName?: string;
}

/**
 * Project this browser's indexed chat ids onto the host session list, most
 * recently updated first. Opening a chat is not an update: only the host's
 * `updatedAt` (fresh messages) orders the list. Ids the host no longer lists
 * are skipped (the controller prunes them on switch), and so is a delegated
 * child: a subagent's session is not a chat, even when an ownership record
 * from an older release still names it.
 */
export function buildChatRows(
  chatIds: readonly string[],
  byId: Readonly<Record<string, SessionSummary>>,
  activeId: string | null,
  ownerNameOf?: (sessionId: string) => string | undefined,
  now: number = Date.now(),
): readonly QaChatRow[] {
  const rows: QaChatRow[] = [];
  for (const id of chatIds) {
    const summary = byId[id];
    if (summary === undefined || isDelegatedSession(summary)) continue;
    const ownerName = ownerNameOf?.(id);
    rows.push({
      id,
      title: summary.blank ? "Новый чат" : summary.displayTitle,
      running: summary.running,
      active: id === activeId,
      meta: relativeTime(summary.updatedAt, now),
      updatedAt: summary.updatedAt,
      ...(ownerName === undefined ? {} : { ownerName }),
    });
  }
  return rows.sort((left, right) => right.updatedAt - left.updatedAt);
}

/** One per-owner section of the admin sidebar grouping. */
export interface QaSidebarSection {
  /**
   * Section header; chats nobody claimed group under "Без владельца". An
   * empty name renders no header (the flat, non-grouped mode).
   */
  readonly name: string;
  readonly rows: readonly QaChatRow[];
}

/**
 * Group rows into per-owner sections for the admin view. Sections order by
 * their freshest row so the busiest users float up; unclaimed chats go last.
 * Row order inside a section is already the global updatedAt order.
 */
export function buildOwnerSections(
  rows: readonly QaChatRow[],
): readonly QaSidebarSection[] {
  const groups = new Map<string, QaChatRow[]>();
  for (const row of rows) {
    const key = row.ownerName ?? "";
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }
  const sections: QaSidebarSection[] = [...groups].map(([name, groupRows]) => ({
    name: name === "" ? "Без владельца" : name,
    rows: groupRows,
  }));
  sections.sort((left, right) => {
    if (left.name === "Без владельца") return 1;
    if (right.name === "Без владельца") return -1;
    return (right.rows[0]?.updatedAt ?? 0) - (left.rows[0]?.updatedAt ?? 0);
  });
  return sections;
}

export interface QaSidebarProps {
  readonly rows: readonly QaChatRow[];
  /**
   * Render per-owner sections instead of the flat list; the admin ownership
   * view. Rows without an owner name fall into a trailing section.
   */
  readonly groupByOwner?: boolean;
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
  /**
   * Audit summaries by chat id, for the row badge. Empty when the audit plugin
   * is not installed — the badge is then absent rather than empty.
   */
  readonly audits?: ReadonlyMap<string, QaAuditSummary>;
  /** Opens the audit dialog for a chat; omit when audits are unavailable. */
  readonly onAudit?: (sessionId: string) => void;
  /** The signed-in account; omit when accounts are disabled. */
  readonly account?: {
    readonly email: string;
    readonly role: string;
    readonly onLogout: () => void;
    /**
     * Entry point of the user-settings dialog: the name to show and the way to
     * open it. Omitted when the deployment gives the account nothing to
     * configure, which also leaves the footer name as plain text. Memoized by
     * the caller: this object is compared by reference.
     */
    readonly settings?: {
      /** Full name the user wrote, or the email when they wrote none. */
      readonly label: string;
      readonly onOpen: () => void;
    };
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

function ClearIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="m3.5 3.5 7 7m0-7-7 7" />
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
  return (
    row.title.toLowerCase().includes(query) ||
    row.ownerName?.toLowerCase().includes(query) === true
  );
}

/**
 * How each chat is named by the controls acting on it, keyed by id. A title is
 * not unique — every chat reads «Новый чат» until its first answer lands — so
 * a repeated title is numbered by its place in the list, which is the order
 * the reader is shown. The numbering runs over every chat rather than only the
 * rows a search leaves visible, so one chat's name does not change because
 * another is filtered out, and a lone match still says how many share it.
 */
function nameChats(rows: readonly QaChatRow[]): Map<string, string> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.title, (totals.get(row.title) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  for (const row of rows) {
    const ordinal = (seen.get(row.title) ?? 0) + 1;
    seen.set(row.title, ordinal);
    const total = totals.get(row.title) ?? 1;
    names.set(
      row.id,
      total > 1 ? `«${row.title}» (${ordinal} из ${total})` : `«${row.title}»`,
    );
  }
  return names;
}

/**
 * The name of one chat among the chats this browser lists. A row the list does
 * not hold is the chat nobody has named yet, and that one reads «Новый чат».
 */
function nameOfChat(
  names: ReadonlyMap<string, string>,
  row: QaChatRow | undefined,
): string {
  if (row === undefined) return "«Новый чат»";
  return names.get(row.id) ?? `«${row.title}»`;
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
      row.updatedAt === other.updatedAt &&
      row.ownerName === other.ownerName
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
    const nav = useRef<HTMLElement | null>(null);
    const chatList = useRef<HTMLDivElement | null>(null);
    // The control the confirmation opened from. Rows shift up under a pointer
    // that stays still while chats are removed, so the dialog has to remember
    // which control it came from to hand the keyboard back to.
    const deleteTrigger = useRef<HTMLButtonElement | null>(null);
    const closeDeleteConfirmation = () => {
      const trigger = deleteTrigger.current;
      deleteTrigger.current = null;
      setConfirmingId(null);
      trigger?.focus({ preventScroll: true });
    };
    const sidebarWidth = useQaSidebarWidth({
      active: !collapsed,
      root: nav,
      storage: window.localStorage,
      storageKey: `${props.stateKey}:sidebar-width`,
    });
    const toggleCollapsed = () => {
      const next = !collapsed;
      setCollapsed(next);
      writeCollapsed(props.stateKey, next);
    };
    if (collapsed) {
      return (
        <nav
          className="dsh-qa-sidebar dsh-qa-sidebar--collapsed"
          data-testid="qa-surface-sidebar-collapsed"
          aria-label="История чатов"
        >
          <button
            type="button"
            className="dsh-qa-sidebar__expand"
            data-testid="qa-surface-sidebar-expand"
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
    const chatNames = nameChats(props.rows);
    const visibleRows =
      normalizedQuery === ""
        ? props.rows
        : props.rows.filter((row) => rowMatches(row, normalizedQuery));
    const confirmingRow =
      confirmingId === null
        ? undefined
        : props.rows.find((row) => row.id === confirmingId);
    const sections: readonly QaSidebarSection[] =
      props.groupByOwner === true
        ? buildOwnerSections(visibleRows)
        : [{ name: "", rows: visibleRows }];
    const renderRow = (row: QaChatRow) => {
      const name = nameOfChat(chatNames, row);
      return (
        <div
          key={row.id}
          className={
            row.active
              ? "dsh-qa-sidebar__item dsh-qa-sidebar__item--active"
              : "dsh-qa-sidebar__item"
          }
          data-testid="qa-surface-sidebar-item"
        >
          <button
            type="button"
            className="dsh-qa-sidebar__item-main"
            data-testid="qa-surface-sidebar-item-open"
            aria-current={row.active ? "true" : undefined}
            onClick={() => props.onSwitch(row.id)}
          >
            <span
              className="dsh-qa-sidebar__item-title"
              data-testid="qa-surface-sidebar-item-title"
            >
              {row.title}
            </span>
            <span
              className="dsh-qa-sidebar__item-meta"
              data-testid="qa-surface-sidebar-item-meta"
            >
              {row.running ? (
                <span
                  className="dsh-qa-sidebar__dot"
                  data-testid="qa-surface-sidebar-item-running"
                  role="img"
                  aria-label="Выполняется"
                />
              ) : null}
              {row.meta}
            </span>
          </button>
          {props.onAudit === undefined
            ? null
            : (() => {
                const mark = auditMark(props.audits?.get(row.id));
                if (mark === null) return null;
                return (
                  <QaAuditRowBadge
                    mark={mark}
                    withDelete={props.onDelete !== undefined}
                    onOpen={() => props.onAudit?.(row.id)}
                  />
                );
              })()}
          {props.onDelete === undefined ? null : (
            <button
              type="button"
              className="dsh-qa-sidebar__item-delete"
              data-testid="qa-surface-sidebar-item-delete"
              aria-label={`Удалить чат ${name}`}
              title={`Удалить чат ${name}`}
              onClick={(event) => {
                deleteTrigger.current = event.currentTarget;
                setConfirmingId(row.id);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 4h11M6.5 4V2.5h3V4m-6.2 0 .6 9.5h7.2L12 4" />
              </svg>
            </button>
          )}
        </div>
      );
    };
    const brand: ReactNode =
      props.logoUrl === null ? (
        <DefaultMark />
      ) : (
        <img src={props.logoUrl} alt="" />
      );
    return (
      <nav
        ref={nav}
        className="dsh-qa-sidebar"
        data-testid="qa-surface-sidebar"
        aria-label="История чатов"
      >
        <div
          className="dsh-qa-sidebar__head"
          data-testid="qa-surface-sidebar-head"
        >
          <span
            className="dsh-qa-sidebar__brand"
            data-testid="qa-surface-sidebar-brand"
            title={props.title}
          >
            <span
              className="dsh-qa-sidebar__logo"
              data-testid="qa-surface-sidebar-logo"
            >
              {brand}
            </span>
            <span
              className="dsh-qa-sidebar__name"
              data-testid="qa-surface-sidebar-name"
            >
              {props.title}
            </span>
          </span>
          <button
            type="button"
            className="dsh-qa-sidebar__collapse"
            data-testid="qa-surface-sidebar-collapse"
            aria-label="Свернуть историю чатов"
            title="Свернуть историю чатов"
            onClick={toggleCollapsed}
          >
            <ChevronIcon />
          </button>
        </div>
        {props.showNewChat ? (
          <div
            className="dsh-qa-sidebar__newbar"
            data-testid="qa-surface-sidebar-newbar"
          >
            <button
              type="button"
              className="dsh-qa-sidebar__new"
              data-testid="qa-surface-sidebar-new"
              disabled={props.busy}
              onClick={props.onNewChat}
            >
              <PlusIcon />
              Новый чат
            </button>
          </div>
        ) : null}
        <div
          className="dsh-qa-sidebar__search"
          data-testid="qa-surface-sidebar-search"
        >
          <SearchIcon />
          <input
            type="search"
            value={query}
            data-testid="qa-surface-sidebar-search-input"
            placeholder="Поиск по чатам"
            aria-label="Поиск по чатам"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query === "" ? null : (
            <button
              type="button"
              className="dsh-qa-sidebar__search-clear"
              data-testid="qa-surface-sidebar-search-clear"
              aria-label="Очистить поиск"
              title="Очистить поиск"
              onClick={() => setQuery("")}
            >
              <ClearIcon />
            </button>
          )}
        </div>
        <div
          className="dsh-qa-sidebar__list"
          data-testid="qa-surface-sidebar-list"
          ref={chatList}
          // A confirmed deletion removes the focused control, so focus goes to
          // the list itself: the next Tab continues among the chats instead of
          // restarting from the top of the document.
          tabIndex={-1}
        >
          {props.rows.length === 0 ? (
            <p
              className="dsh-qa-sidebar__empty"
              data-testid="qa-surface-sidebar-empty"
            >
              Здесь пока пусто
            </p>
          ) : visibleRows.length === 0 ? (
            <p
              className="dsh-qa-sidebar__empty"
              data-testid="qa-surface-sidebar-empty"
            >
              Ничего не найдено
            </p>
          ) : (
            sections.map((section) => (
              <div
                key={section.name || "__all"}
                className="dsh-qa-sidebar__group"
                data-testid="qa-surface-sidebar-group"
              >
                {section.name === "" ? null : (
                  <div
                    className="dsh-qa-sidebar__group-name"
                    data-testid="qa-surface-sidebar-group-name"
                  >
                    {section.name} ({section.rows.length})
                  </div>
                )}
                {section.rows.map(renderRow)}
              </div>
            ))
          )}
        </div>
        <div
          className="dsh-qa-sidebar__footer"
          data-testid="qa-surface-sidebar-footer"
        >
          {props.account === undefined ? null : (
            <div
              className="dsh-qa-sidebar__account"
              data-testid="qa-surface-sidebar-account"
              title={`${props.account.email} (${props.account.role})`}
            >
              {props.account.settings === undefined ? (
                <span
                  className="dsh-qa-sidebar__account-name"
                  data-testid="qa-surface-sidebar-account-name"
                >
                  {props.account.email}
                </span>
              ) : (
                <button
                  type="button"
                  className="dsh-qa-sidebar__account-name"
                  data-testid="qa-surface-sidebar-account-name"
                  aria-haspopup="dialog"
                  title="Открыть настройки"
                  onClick={props.account.settings.onOpen}
                >
                  {props.account.settings.label}
                </button>
              )}
              {props.account.role === "admin" ? (
                <span
                  className="dsh-qa-sidebar__account-role"
                  data-testid="qa-surface-sidebar-account-role"
                >
                  admin
                </span>
              ) : null}
              <button
                type="button"
                className="dsh-qa-sidebar__account-exit"
                data-testid="qa-surface-sidebar-account-logout"
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
            data-testid="qa-surface-sidebar-version"
            aria-haspopup="dialog"
            title="История версий"
            onClick={() => setChangelogOpen(true)}
          >
            Версия {QA_VERSION}
          </button>
        </div>
        <QaSidebarHandle {...sidebarWidth} />
        <QaChangelogModal
          open={changelogOpen}
          onClose={() => setChangelogOpen(false)}
        />
        <QaModal
          open={confirmingRow !== undefined}
          // Not «Удалить чат»: that is the name of every row control, and a
          // dialog sharing it cannot be told apart from the button behind it.
          title="Подтвердите удаление чата"
          closeLabel="Закрыть подтверждение удаления чата"
          onClose={closeDeleteConfirmation}
          footer={
            <>
              <QaSettingsButton
                label="Отмена"
                onClick={closeDeleteConfirmation}
              />
              <QaSettingsButton
                tone="danger"
                label="Удалить из истории"
                onClick={() => {
                  if (confirmingRow === undefined) return;
                  const sessionId = confirmingRow.id;
                  // Its trigger is about to leave the list with the chat, so it
                  // cannot take the focus back; the list holds it instead.
                  deleteTrigger.current = null;
                  setConfirmingId(null);
                  chatList.current?.focus({ preventScroll: true });
                  props.onDelete?.(sessionId);
                }}
              />
            </>
          }
        >
          <p className="dsh-qa-settings__lead">
            Удалить чат {nameOfChat(chatNames, confirmingRow)} из истории в этом
            браузере? Сам разговор останется на стенде.
          </p>
        </QaModal>
      </nav>
    );
  },
  (prev, next) =>
    prev.title === next.title &&
    prev.logoUrl === next.logoUrl &&
    prev.stateKey === next.stateKey &&
    prev.showNewChat === next.showNewChat &&
    prev.busy === next.busy &&
    prev.groupByOwner === next.groupByOwner &&
    prev.onSwitch === next.onSwitch &&
    prev.onNewChat === next.onNewChat &&
    prev.onDelete === next.onDelete &&
    prev.onAudit === next.onAudit &&
    prev.audits === next.audits &&
    prev.account?.email === next.account?.email &&
    prev.account?.role === next.account?.role &&
    prev.account?.onLogout === next.account?.onLogout &&
    prev.account?.settings === next.account?.settings &&
    sameChatRows(prev.rows, next.rows),
);
