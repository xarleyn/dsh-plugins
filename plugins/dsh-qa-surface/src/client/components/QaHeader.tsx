/**
 * The surface's header chrome: brand row, the derived conversation title, the
 * phone opener of the chat history, the agents/sources/files controls and the
 * reset action. Plain (non-memoized) rendering — the badge counts move with the
 * session state anyway, so reference guards would never pay off here.
 */
import type { ReactNode } from "react";
import { QaHeaderPanelButton } from "./QaHeaderPanelButton.js";

function RobotBadge() {
  return (
    <svg
      className="dsh-qa-agentview__icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="10" height="7.5" rx="1.75" />
      <path d="M8 2.5V5m0-.25a.9.9 0 1 0-.01-1.8.9.9 0 0 0 .01 1.8ZM5.4 8.4h1.7M8.9 8.4h1.7M6 10.4h4" />
    </svg>
  );
}

/**
 * The subagent indication for headerless deployments: a slim status line
 * above the transcript with the way back to the parent chat. With a header,
 * the same indication lives in the title row instead.
 */
export function QaSubagentBanner({
  onClose,
}: {
  readonly onClose: () => void;
}) {
  return (
    <div
      className="dsh-qa-agentview"
      data-testid="qa-surface-subagent-banner"
      role="status"
    >
      <RobotBadge />
      <span>Просмотр субагента</span>
      <button
        type="button"
        data-testid="qa-surface-subagent-banner-back"
        onClick={onClose}
      >
        ← В чат
      </button>
    </div>
  );
}

export interface QaHeaderProps {
  readonly logoUrl: string | null;
  /** The derived conversation title; null hides the heading. */
  readonly title: string | null;
  /** A subagent view shows its return control in the title row. */
  readonly viewingSubagent: boolean;
  readonly onCloseSubagent: () => void;
  readonly roleSelector?: ReactNode;
  readonly administration?: { readonly onOpen: () => void };
  readonly agentCount: number;
  readonly agentsOpen: boolean;
  /** Toggles the agents drawer; also closes the right rail. */
  readonly onToggleAgents: () => void;
  /** Whether the deployment shows the sources control in the header at all. */
  readonly sourcesVisible: boolean;
  /** Sources of the chat so far; 0 prints no badge but never closes the panel. */
  readonly sourcesCount: number;
  /** Whether collection has settled: a running turn's 0 is not yet a none. */
  readonly sourcesComplete: boolean;
  readonly sourcesOpen: boolean;
  readonly onOpenSources: () => void;
  readonly fileCount: number;
  /**
   * Whether the files tab has anything to open: attachments, or the chat's own
   * workspace when the deployment lets the panel read files. The count stays
   * the attachment number, so an empty chat with a readable workspace shows no
   * badge but still opens.
   */
  readonly filesEnabled: boolean;
  readonly filesOpen: boolean;
  readonly onOpenFiles: () => void;
  /**
   * The signed-in user's settings entry. The sidebar carries it next to the
   * account name, so a deployment that hides the session list has to hand it
   * here instead: without either, a signed-in user cannot reach their own
   * profile, starter buttons, skills or integrations at all.
   */
  readonly settings?: {
    readonly label: string;
    readonly onOpen: () => void;
  };
  /**
   * The phone layout's way into the chat history. Below 600px the sheet switches
   * the sidebar subtree off, and the only control that opened it stood inside
   * that subtree — so the opener has to live here, outside it, and it is offered
   * only where a sidebar exists to open (`config.ui.showSessionList`). The sheet
   * shows the button at the phone widths alone: on a wide layout the sidebar is
   * already on screen and carries its own collapse control.
   */
  readonly history?: {
    readonly open: boolean;
    readonly onToggle: () => void;
  };
  readonly panelLauncher?: ReactNode;
  readonly showReset: boolean;
  readonly resetDisabled: boolean;
  readonly onReset: () => void;
  /** Return to the conversation while a panel is open. */
  readonly onBackToChat?: () => void;
}

export function QaHeader({
  logoUrl,
  title,
  viewingSubagent,
  onCloseSubagent,
  roleSelector,
  administration,
  agentCount,
  agentsOpen,
  onToggleAgents,
  sourcesVisible,
  sourcesCount,
  sourcesComplete,
  sourcesOpen,
  onOpenSources,
  fileCount,
  filesEnabled,
  filesOpen,
  onOpenFiles,
  settings,
  history,
  panelLauncher,
  showReset,
  resetDisabled,
  onReset,
  onBackToChat,
}: QaHeaderProps) {
  return (
    <header className="dsh-qa-header" data-testid="qa-surface-header">
      <div
        className="dsh-qa-header__inner"
        data-testid="qa-surface-header-inner"
      >
        <div
          className="dsh-qa-header__title-row"
          data-testid="qa-surface-header-title-row"
        >
          {history === undefined ? null : (
            <button
              type="button"
              className="dsh-qa-header__history"
              data-testid="qa-surface-header-history"
              aria-label="История чатов"
              title="История чатов"
              aria-expanded={history.open}
              onClick={history.onToggle}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5.75 4h8M5.75 8h8M5.75 12h8M2.75 4h.01M2.75 8h.01M2.75 12h.01" />
              </svg>
            </button>
          )}
          {onBackToChat && (
            <button
              type="button"
              className="dsh-qa-header__return"
              data-testid="qa-surface-header-chat-tab"
              aria-label="Вернуться к чату"
              title="Вернуться к чату"
              onClick={onBackToChat}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m8 3-5 5 5 5M3 8h10" />
              </svg>
            </button>
          )}
          {logoUrl === null ? null : (
            <img
              className="dsh-qa-header__logo"
              data-testid="qa-surface-header-logo"
              src={logoUrl}
              alt=""
            />
          )}
          {title === null ? null : (
            <h1 title={title} data-testid="qa-surface-header-title">
              {title}
            </h1>
          )}
          {viewingSubagent ? (
            <span
              className="dsh-qa-header__viewing"
              data-testid="qa-surface-header-viewing"
            >
              <RobotBadge />
              Просмотр субагента
              <button
                type="button"
                className="dsh-qa-header__back"
                data-testid="qa-surface-header-back"
                onClick={onCloseSubagent}
              >
                ← В чат
              </button>
            </span>
          ) : null}
          {roleSelector}
          <div
            className="dsh-qa-header__panels"
            role="group"
            aria-label="Панели чата"
          >
            <QaHeaderPanelButton
              panel="agents"
              count={agentCount || undefined}
              open={agentsOpen}
              disabled={agentCount === 0}
              hint={
                agentCount === 0 ? "Субагентов в этом чате пока нет" : undefined
              }
              onClick={onToggleAgents}
            />
            {sourcesVisible && (
              <QaHeaderPanelButton
                panel="sources"
                count={
                  sourcesCount === 0 && sourcesComplete
                    ? undefined
                    : sourcesCount
                }
                open={sourcesOpen}
                hint={
                  sourcesCount === 0 && sourcesComplete
                    ? "В этом чате пока нет источников"
                    : undefined
                }
                onClick={onOpenSources}
              />
            )}
            <QaHeaderPanelButton
              panel="files"
              count={fileCount || undefined}
              open={filesOpen}
              disabled={!filesEnabled}
              hint={
                !filesEnabled
                  ? "В этом чате нет ни вложений, ни читаемого рабочего каталога"
                  : undefined
              }
              onClick={onOpenFiles}
            />
          </div>
          {/*
            The right-hand cluster is one flex group with a single auto margin.
            Pinning each button separately made the free space split between two
            gaps, which parked «Файлы» in the middle of the row, away from the
            tabs it belongs to.
          */}
          <div
            className="dsh-qa-header__actions"
            data-testid="qa-surface-header-actions"
          >
            {showReset ? (
              <button
                type="button"
                className="dsh-qa-header__reset"
                data-testid="qa-surface-header-reset"
                disabled={resetDisabled}
                onClick={onReset}
              >
                Новый чат
              </button>
            ) : null}
            {administration === undefined ? null : (
              <button
                type="button"
                className="dsh-qa-header__admin"
                data-testid="qa-surface-header-admin"
                aria-label="Администрирование"
                title="Администрирование"
                onClick={administration.onOpen}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 2 2.8 4v3.7c0 3 2.3 5.2 5.2 6.3 2.9-1.1 5.2-3.3 5.2-6.3V4L8 2Z" />
                  <path d="m5.7 8 1.5 1.5 3.2-3.2" />
                </svg>
                <span>Администрирование</span>
              </button>
            )}
            {panelLauncher}
            {settings === undefined ? null : (
              <button
                type="button"
                className="dsh-qa-header__settings"
                data-testid="qa-surface-header-settings"
                aria-label="Настройки"
                aria-haspopup="dialog"
                title={settings.label}
                onClick={settings.onOpen}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="2.2" />
                  <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" />
                </svg>
                <span>Настройки</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
