import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type { HostDescriptionSource } from "@deepseek-ai/dsh-client-connection/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { QaMessage as QaMessageModel, QaSessionState } from "../types.js";
import type { SessionSummary } from "@deepseek-ai/dsh-client-runtime/client";
import type { QaConfigController } from "./QaConfigController.js";
import type { QaRouteController } from "./QaRouteController.js";
import { QaSessionController } from "./QaSessionController.js";
import type { QaSecureSession, QaSessions, QaSessionsApi } from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import { QaComposer } from "./components/QaComposer.js";
import { QaMessage } from "./components/QaMessage.js";
import { buildChatRows, QaSidebar } from "./components/QaSidebar.js";

const noopSubscribe = () => () => undefined;

export interface QaSurfaceFace {
  readonly route: QaRouteController;
  readonly config: QaConfigController;
  readonly sessions: QaSessions;
  readonly api: QaSessionsApi;
  readonly connection: HostDescriptionSource;
  readonly secureSession: QaSecureSession;
}

type QaSurfaceProps = PropsRuntime<"shell.overlay"> & InjectFace<QaSurfaceFace>;

function focusable(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    ),
  ].filter((element) => !element.hidden);
}

function trapKeys(event: KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
  if (event.key !== "Tab") return;
  const items = focusable(event.currentTarget);
  if (items.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function statusText(state: QaSessionState): string | null {
  if (state.phase === "creating") return "Подключаюсь…";
  if (state.phase === "reconnecting")
    return "Связь потерялась. Подключаюсь снова…";
  if (state.phase === "running") return "Скребу по сусекам…";
  return null;
}

function titleFromMessages(state: QaSessionState): string | null {
  const firstUser = state.messages.find((message) => message.role === "user");
  if (firstUser === undefined) return null;
  const title = firstUser.text.replace(/\s+/gu, " ").trim();
  if (title === "") return null;
  if (title.length <= 52) return title;
  return `${title.slice(0, 51).trimEnd()}…`;
}

function modeLabel(agentPreset: string | null): string {
  if (agentPreset === null) return "Режим вопросов";
  const name = agentPreset
    .replace(/[-_]+/gu, " ")
    .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
  return `Режим «${name}»`;
}

export interface QaVariantGroup {
  /** The user message that anchors the group. */
  readonly groupId: string;
  /** Answer turns triggered by that message, in order. */
  readonly turns: readonly number[];
}

function VariantSwitcher({
  count,
  offset,
  onStep,
}: {
  readonly count: number;
  readonly offset: number;
  readonly onStep: (offset: number) => void;
}) {
  return (
    <div className="dsh-qa-variants" aria-label="Варианты ответа">
      <button
        type="button"
        aria-label="Предыдущий вариант"
        disabled={offset >= count - 1}
        onClick={() => onStep(offset + 1)}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m8.75 3.5-3.5 3.5 3.5 3.5" />
        </svg>
      </button>
      <span>
        {count - offset}/{count}
      </span>
      <button
        type="button"
        aria-label="Следующий вариант"
        disabled={offset <= 0}
        onClick={() => onStep(offset - 1)}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="m5.25 3.5 3.5 3.5-3.5 3.5" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Group answer turns under the user message that triggered them. The session
 * has no truncation seam, so a regenerated answer is a real follow-up turn;
 * consecutive turns after one user message read as its variants.
 */
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

function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(1, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "только что";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return new Date(timestamp).toLocaleDateString("ru-RU");
}

export function collectVariantGroups(
  messages: readonly QaMessageModel[],
): readonly QaVariantGroup[] {
  const groups: { groupId: string; turns: number[] }[] = [];
  let current: { groupId: string; turns: number[] } | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      current = { groupId: message.id, turns: [] };
      groups.push(current);
      continue;
    }
    if (
      current === undefined ||
      (message.role !== "assistant" && message.role !== "work")
    ) {
      continue;
    }
    if (message.turn !== undefined && !current.turns.includes(message.turn)) {
      current.turns.push(message.turn);
    }
  }
  return groups;
}

function SourceIcon({ kind }: { readonly kind: "web" | "search" | "file" }) {
  if (kind === "web") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.75" />
        <path d="M2.25 8h11.5M8 2.25c1.6 1.55 2.4 3.5 2.4 5.75S9.6 12.2 8 13.75C6.4 12.2 5.6 10.25 5.6 8S6.4 3.8 8 2.25Z" />
      </svg>
    );
  }
  if (kind === "search") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7.1" cy="7.1" r="4.3" />
        <path d="m10.3 10.3 2.9 2.9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.25 2.5H4.75A1.25 1.25 0 0 0 3.5 3.75v8.5a1.25 1.25 0 0 0 1.25 1.25h6.5a1.25 1.25 0 0 0 1.25-1.25V5.75L9.25 2.5Z" />
      <path d="M9.25 2.5v3.25h3.25" />
    </svg>
  );
}

function QaSourceCard({
  source,
}: {
  readonly source: QaSessionState["sources"][number];
}) {
  const href =
    source.kind === "web" && /^https?:\/\//iu.test(source.target)
      ? source.target
      : undefined;
  return (
    <article className="dsh-qa-sources__item">
      <span className="dsh-qa-sources__kind" data-kind={source.kind}>
        <SourceIcon kind={source.kind} />
      </span>
      <div className="dsh-qa-sources__text">
        {href === undefined ? (
          <span className="dsh-qa-sources__title">{source.title}</span>
        ) : (
          <a
            className="dsh-qa-sources__title"
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            {source.title}
          </a>
        )}
        <span className="dsh-qa-sources__target">{source.target}</span>
        {source.snippet === "" ? null : <p>{source.snippet}</p>}
      </div>
    </article>
  );
}

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

export function QaSurface(props: QaSurfaceProps) {
  const route = useSyncExternalStore(
    props.route.subscribe,
    props.route.getSnapshot,
    props.route.getSnapshot,
  );
  const configState = useSyncExternalStore(
    props.config.subscribe,
    props.config.getSnapshot,
    props.config.getSnapshot,
  );
  const config = configState.config;
  const [controller, setController] = useState<QaSessionController>();
  const transcript = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  /** Per group: how many answers back from the newest is shown (0 = newest). */
  const [variantOffsets, setVariantOffsets] = useState<Record<string, number>>(
    {},
  );
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);

  useEffect(() => {
    if (!route.active) {
      setController(undefined);
      return;
    }
    const next = new QaSessionController({
      sessions: props.sessions,
      api: props.api,
      connection: props.connection,
      secureSession: props.secureSession,
      config,
      storage: window.localStorage,
    });
    setController(next);
    void next.ensureSession();
    return () => next.dispose();
  }, [
    config,
    props.api,
    props.connection,
    props.secureSession,
    props.sessions,
    route.active,
  ]);

  const state = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? (() => QA_SESSION_IDLE_STATE),
    controller?.getSnapshot ?? (() => QA_SESSION_IDLE_STATE),
  );
  const listState = useSyncExternalStore(
    props.sessions.list.subscribe,
    props.sessions.list.getSnapshot,
    props.sessions.list.getSnapshot,
  );

  useEffect(() => {
    if (!route.active) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.dataset.dshQaSurface = "active";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("#dsh-qa-prompt")?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      delete document.body.dataset.dshQaSurface;
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [route.active]);

  useLayoutEffect(() => {
    const element = transcript.current;
    if (element !== null && nearBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [state.messages]);

  if (!route.active) return null;

  const status = statusText(state);
  const empty = state.messages.length === 0;
  const conversationTitle = titleFromMessages(state);
  const showSidebar = config.ui.showSessionList && controller !== undefined;
  const allowNewChat =
    config.session.policy !== "fixed" &&
    (!config.lockdown.enabled || config.lockdown.allowSessionReset);
  const groups = collectVariantGroups(state.messages);
  const turnToGroup = new Map<number, string>();
  const selectedTurn = new Map<string, number>();
  for (const group of groups) {
    const offset = variantOffsets[group.groupId] ?? 0;
    const turn =
      group.turns[Math.max(0, group.turns.length - 1 - offset)] ??
      group.turns.at(-1);
    if (turn !== undefined) {
      selectedTurn.set(group.groupId, turn);
      for (const groupTurn of group.turns)
        turnToGroup.set(groupTurn, group.groupId);
    }
  }
  const visibleMessages = state.messages.filter((message) => {
    if (
      (message.role === "assistant" || message.role === "work") &&
      message.turn !== undefined
    ) {
      const groupId = turnToGroup.get(message.turn);
      return (
        groupId === undefined || selectedTurn.get(groupId) === message.turn
      );
    }
    return true;
  });
  const agentRows = collectSubagents(
    listState.byId,
    controller?.activeSessionId() ?? null,
  );
  const chatRows = showSidebar
    ? buildChatRows(
        controller?.chatIds() ?? [],
        listState.byId,
        controller?.activeSessionId() ?? null,
      )
    : [];
  return (
    <main
      className="dsh-qa-surface"
      data-phase={state.phase}
      aria-label={config.branding.title}
      tabIndex={-1}
      onKeyDown={trapKeys}
    >
      {showSidebar ? (
        <QaSidebar
          rows={chatRows}
          title={config.branding.title}
          logoUrl={config.branding.logoUrl}
          stateKey={`${config.session.storageKey}:v1:${config.route.path}`}
          showNewChat={allowNewChat}
          busy={state.phase === "creating"}
          onSwitch={(sessionId) => void controller?.switchTo(sessionId)}
          onNewChat={() => void controller?.startDraft()}
          onDelete={(sessionId) => void controller?.deleteChat(sessionId)}
        />
      ) : null}
      <div className="dsh-qa-body">
        {state.viewingSubagent !== null ? (
          <div className="dsh-qa-agentview" role="status">
            <RobotBadge />
            <span>
              Смотрю субагента <strong>«{state.viewingSubagent.title}»</strong>.
              Ответы недоступны, чат работает дальше.
            </span>
            <button
              type="button"
              onClick={() => void controller?.closeSubagent()}
            >
              ← Вернуться к чату
            </button>
          </div>
        ) : null}
        {config.ui.showHeader ? (
          <header className="dsh-qa-header">
            <div className="dsh-qa-header__inner">
              <div className="dsh-qa-header__title-row">
                {config.branding.logoUrl === null ? null : (
                  <img
                    className="dsh-qa-header__logo"
                    src={config.branding.logoUrl}
                    alt=""
                  />
                )}
                {conversationTitle === null ? null : (
                  <h1 title={conversationTitle}>{conversationTitle}</h1>
                )}
                <span className="dsh-qa-header__mode">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="3.25" r="1.5" />
                    <circle cx="4" cy="11.75" r="1.5" />
                    <circle cx="12" cy="11.75" r="1.5" />
                    <path d="M8 4.75v2.5m0 0H4v3m4-3h4v3" />
                  </svg>
                  {modeLabel(config.session.agentPreset)}
                </span>
                <button
                  type="button"
                  className={
                    config.ui.showToolActivity
                      ? "dsh-qa-header__agents"
                      : "dsh-qa-header__agents dsh-qa-header__agents--end"
                  }
                  disabled={agentRows.length === 0}
                  aria-expanded={agentsOpen}
                  onClick={() => {
                    setAgentsOpen((open) => !open);
                    setSourcesOpen(false);
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="3" y="5.5" width="10" height="7" rx="1.75" />
                    <path d="M8 3v2.5M6.2 9h.01M9.8 9h.01M6.2 11h3.6" />
                  </svg>
                  Агенты
                  {agentRows.length === 0 ? null : ` (${agentRows.length})`}
                </button>
                {config.ui.showToolActivity ? (
                  <button
                    type="button"
                    className={
                      config.ui.showReset &&
                      config.session.policy !== "fixed" &&
                      (!config.lockdown.enabled ||
                        config.lockdown.allowSessionReset)
                        ? "dsh-qa-header__sources"
                        : "dsh-qa-header__sources dsh-qa-header__sources--end"
                    }
                    disabled={state.sources.length === 0}
                    aria-expanded={sourcesOpen}
                    onClick={() => {
                      setSourcesOpen((open) => !open);
                      setAgentsOpen(false);
                    }}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="5.75" />
                      <path d="M2.25 8h11.5M8 2.25c1.6 1.55 2.4 3.5 2.4 5.75S9.6 12.2 8 13.75C6.4 12.2 5.6 10.25 5.6 8S6.4 3.8 8 2.25Z" />
                    </svg>
                    Источники
                    {state.sources.length === 0
                      ? null
                      : ` (${state.sources.length})`}
                  </button>
                ) : null}
                {config.ui.showReset &&
                config.session.policy !== "fixed" &&
                (!config.lockdown.enabled ||
                  config.lockdown.allowSessionReset) ? (
                  <button
                    type="button"
                    className="dsh-qa-header__reset"
                    disabled={
                      controller === undefined || state.phase === "creating"
                    }
                    onClick={() => void controller?.startDraft()}
                  >
                    Новый чат
                  </button>
                ) : null}
              </div>
              <div className="dsh-qa-header__tabs" aria-label="Вид беседы">
                <span aria-current="page">Чат</span>
              </div>
            </div>
          </header>
        ) : null}

        <div
          ref={transcript}
          className="dsh-qa-transcript"
          onScroll={(event) => {
            const element = event.currentTarget;
            nearBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              96;
          }}
        >
          <div
            className="dsh-qa-transcript__inner"
            style={{ maxWidth: config.ui.maxContentWidth }}
          >
            {empty ? (
              <section
                className="dsh-qa-welcome"
                aria-labelledby="dsh-qa-welcome-title"
              >
                <h2 id="dsh-qa-welcome-title">
                  {config.branding.welcomeMessage}
                </h2>
                {config.branding.subtitle === "" ? null : (
                  <p>{config.branding.subtitle}</p>
                )}
              </section>
            ) : (
              visibleMessages.map((message, index) => {
                const group =
                  message.role === "user"
                    ? groups.find(
                        (candidate) => candidate.groupId === message.id,
                      )
                    : undefined;
                const isLast = index === visibleMessages.length - 1;
                return (
                  <div key={message.id} className="dsh-qa-message-slot">
                    <QaMessage
                      message={message}
                      renderMarkdown={config.ui.renderMarkdown}
                      showTimestamp={config.ui.showTimestamps}
                      stateKey={`${config.session.storageKey}:v1:${config.route.path}`}
                      onRegenerate={
                        isLast &&
                        message.role === "assistant" &&
                        message.status === "committed" &&
                        controller !== undefined
                          ? () => void controller.regenerate()
                          : undefined
                      }
                    />
                    {group !== undefined && group.turns.length > 1 ? (
                      <VariantSwitcher
                        count={group.turns.length}
                        offset={variantOffsets[group.groupId] ?? 0}
                        onStep={(step) =>
                          setVariantOffsets((offsets) => ({
                            ...offsets,
                            [group.groupId]: step,
                          }))
                        }
                      />
                    ) : null}
                  </div>
                );
              })
            )}
            {state.error === null ? null : (
              <div className="dsh-qa-error" role="alert">
                <span>{state.error}</span>
                {state.phase === "error" ? (
                  <button
                    type="button"
                    onClick={() => void controller?.ensureSession()}
                  >
                    Повторить
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <footer className="dsh-qa-footer">
          <div
            className="dsh-qa-footer__inner"
            style={{ maxWidth: config.ui.maxContentWidth }}
          >
            <QaComposer
              placeholder={config.branding.placeholder}
              quickQuestions={empty ? config.suggestedQuestions : []}
              canSend={state.canSend}
              canStop={state.canStop}
              running={state.phase === "running"}
              showStop={config.ui.showStop}
              status={status}
              onSend={(text) =>
                controller?.send(text) ?? Promise.resolve(false)
              }
              onStop={() => controller?.stop() ?? Promise.resolve()}
            />
          </div>
        </footer>
      </div>
      {agentsOpen && agentRows.length > 0 ? (
        <aside className="dsh-qa-agents" aria-label="Субагенты чата">
          <div className="dsh-qa-agents__head">
            <span>Субагенты ({agentRows.length})</span>
            <button
              type="button"
              aria-label="Закрыть список субагентов"
              title="Закрыть"
              onClick={() => setAgentsOpen(false)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8m0-8-8 8" />
              </svg>
            </button>
          </div>
          <div className="dsh-qa-agents__list">
            {agentRows.map((agent) => {
              const active =
                state.viewingSubagent !== null &&
                state.viewingSubagent.id === agent.id;
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={
                    active
                      ? "dsh-qa-agents__item dsh-qa-agents__item--active"
                      : "dsh-qa-agents__item"
                  }
                  onClick={() =>
                    void controller?.viewSubagent(agent.id, agent.title)
                  }
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
      ) : null}
      {sourcesOpen && state.sources.length > 0 ? (
        <aside className="dsh-qa-sources" aria-label="Источники">
          <div className="dsh-qa-sources__head">
            <span>Источники ({state.sources.length})</span>
            <button
              type="button"
              aria-label="Закрыть источники"
              title="Закрыть"
              onClick={() => setSourcesOpen(false)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8m0-8-8 8" />
              </svg>
            </button>
          </div>
          <div className="dsh-qa-sources__list">
            {state.sources.map((source) => (
              <QaSourceCard key={source.id} source={source} />
            ))}
          </div>
        </aside>
      ) : null}
    </main>
  );
}
