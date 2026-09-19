/**
 * The surface's header chrome: brand row, the derived conversation title, the
 * agents/sources/files controls and the reset action. Plain (non-memoized)
 * rendering — the badge counts move with the session state anyway, so
 * reference guards would never pay off here.
 */
import type { ReactNode } from "react";

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
    <div className="dsh-qa-agentview" role="status">
      <RobotBadge />
      <span>Просмотр субагента</span>
      <button type="button" onClick={onClose}>
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
  readonly sourcesCount: number;
  readonly sourcesComplete: boolean;
  readonly sourcesOpen: boolean;
  readonly onOpenSources: () => void;
  readonly fileCount: number;
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
  readonly panelLauncher?: ReactNode;
  readonly showReset: boolean;
  readonly resetDisabled: boolean;
  readonly onReset: () => void;
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
  filesOpen,
  onOpenFiles,
  settings,
  panelLauncher,
  showReset,
  resetDisabled,
  onReset,
}: QaHeaderProps) {
  return (
    <header className="dsh-qa-header">
      <div className="dsh-qa-header__inner">
        <div className="dsh-qa-header__title-row">
          {logoUrl === null ? null : (
            <img className="dsh-qa-header__logo" src={logoUrl} alt="" />
          )}
          {title === null ? null : <h1 title={title}>{title}</h1>}
          {viewingSubagent ? (
            <span className="dsh-qa-header__viewing">
              <RobotBadge />
              Просмотр субагента
              <button
                type="button"
                className="dsh-qa-header__back"
                onClick={onCloseSubagent}
              >
                ← В чат
              </button>
            </span>
          ) : null}
          {roleSelector}
          <button
            type="button"
            className="dsh-qa-header__agents"
            disabled={agentCount === 0}
            aria-expanded={agentsOpen}
            onClick={onToggleAgents}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3" y="5.5" width="10" height="7" rx="1.75" />
              <path d="M8 3v2.5M6.2 9h.01M9.8 9h.01M6.2 11h3.6" />
            </svg>
            Агенты
            {agentCount === 0 ? null : ` (${agentCount})`}
          </button>
          {sourcesVisible ? (
            <button
              type="button"
              className="dsh-qa-header__sources"
              disabled={sourcesCount === 0 && sourcesComplete}
              aria-expanded={sourcesOpen}
              onClick={onOpenSources}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5.75" />
                <path d="M2.25 8h11.5M8 2.25c1.6 1.55 2.4 3.5 2.4 5.75S9.6 12.2 8 13.75C6.4 12.2 5.6 10.25 5.6 8S6.4 3.8 8 2.25Z" />
              </svg>
              Источники
              {sourcesCount === 0 && sourcesComplete
                ? null
                : ` (${sourcesCount})`}
            </button>
          ) : null}
          <button
            type="button"
            className="dsh-qa-header__files"
            disabled={fileCount === 0}
            aria-expanded={filesOpen}
            onClick={onOpenFiles}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M9.25 2.5H4.75A1.25 1.25 0 0 0 3.5 3.75v8.5a1.25 1.25 0 0 0 1.25 1.25h6.5a1.25 1.25 0 0 0 1.25-1.25V5.75L9.25 2.5Z" />
              <path d="M9.25 2.5v3.25h3.25M6 8.5h4M6 11h2.5" />
            </svg>
            Файлы
            {fileCount === 0 ? null : ` (${fileCount})`}
          </button>
          {/*
            The right-hand cluster is one flex group with a single auto margin.
            Pinning each button separately made the free space split between two
            gaps, which parked «Файлы» in the middle of the row, away from the
            tabs it belongs to.
          */}
          <div className="dsh-qa-header__actions">
            {showReset ? (
              <button
                type="button"
                className="dsh-qa-header__reset"
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
                onClick={administration.onOpen}
              >
                Администрирование
              </button>
            )}
            {panelLauncher}
            {settings === undefined ? null : (
              <button
                type="button"
                className="dsh-qa-header__settings"
                title={settings.label}
                onClick={settings.onOpen}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="2.2" />
                  <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" />
                </svg>
                Настройки
              </button>
            )}
          </div>
        </div>
        {/* Not a tablist yet: the tab bar is a single current page marker, and
        an aria-label without a widget role would never be announced. */}
        <div className="dsh-qa-header__tabs">
          <span aria-current="page">Чат</span>
        </div>
      </div>
    </header>
  );
}
