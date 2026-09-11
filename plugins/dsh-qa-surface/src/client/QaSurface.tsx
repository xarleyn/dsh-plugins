import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type { ConnectionGenerationState } from "@deepseek-ai/dsh-client-connection/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { QaImageDraft, QaSessionState, QaSource } from "../types.js";
import type { QaConfigController } from "./QaConfigController.js";
import type { QaRouteController } from "./QaRouteController.js";
import { QaSessionController } from "./QaSessionController.js";
import type {
  QaConversation,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
} from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import { QaComposer } from "./components/QaComposer.js";
import { QaMessage } from "./components/QaMessage.js";
import { buildChatRows, QaSidebar } from "./components/QaSidebar.js";
import {
  QaAgentsDrawer,
  collectSubagents,
} from "./components/QaAgentsDrawer.js";
import { QaSourcesDrawer } from "./components/QaSourcesDrawer.js";
import {
  collectVariantGroups,
  VariantSwitcher,
} from "./components/VariantSwitcher.js";

const noopSubscribe = () => () => undefined;

/** Stable empty stand-in so memoized children see one identity, not a fresh []. */
const NO_QUESTIONS: readonly string[] = Object.freeze([]);

export interface QaSurfaceFace {
  readonly route: QaRouteController;
  readonly config: QaConfigController;
  readonly sessions: QaSessions;
  readonly conversation: QaConversation;
  readonly api: QaSessionsApi;
  readonly connection: ConnectionGenerationState;
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
  const [drawerSources, setDrawerSources] = useState<
    readonly QaSource[] | null
  >(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<readonly QaImageDraft[]>(
    [],
  );

  useEffect(() => {
    if (!route.active) {
      setController(undefined);
      return;
    }
    const next = new QaSessionController({
      sessions: props.sessions,
      api: props.api,
      conversation: props.conversation,
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
    props.conversation,
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

  // Stable identities for the memoized render path: message rows, the sidebar
  // and the composer compare callbacks by reference, so per-frame closures
  // here would defeat the memoization downstream.
  const resolveImage = useMemo(
    () =>
      controller === undefined
        ? undefined
        : (attachmentId: string) => controller.readImage(attachmentId),
    [controller],
  );
  const handleRegenerate = useCallback(() => {
    void controller?.regenerate();
  }, [controller]);
  const handleSwitch = useCallback(
    (sessionId: string) => {
      void controller?.switchTo(sessionId);
    },
    [controller],
  );
  const handleNewChat = useCallback(() => {
    void controller?.startDraft();
  }, [controller]);
  const handleDelete = useCallback(
    (sessionId: string) => {
      void controller?.deleteChat(sessionId);
    },
    [controller],
  );
  const handleSend = useCallback(
    (text: string, images: readonly QaImageDraft[]) =>
      controller?.send(text, images) ?? Promise.resolve(false),
    [controller],
  );
  const handleStop = useCallback(
    () => controller?.stop() ?? Promise.resolve(),
    [controller],
  );
  const handleOpenSources = useCallback((sources: readonly QaSource[]) => {
    setDrawerSources(sources);
    setSourcesOpen(true);
    setAgentsOpen(false);
  }, []);

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
  const stateKey = `${config.session.storageKey}:v1:${config.route.path}`;
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
          stateKey={stateKey}
          showNewChat={allowNewChat}
          busy={state.phase === "creating"}
          onSwitch={handleSwitch}
          onNewChat={handleNewChat}
          onDelete={handleDelete}
        />
      ) : null}
      <div className="dsh-qa-body">
        {state.viewingSubagent !== null && !config.ui.showHeader ? (
          <div className="dsh-qa-agentview" role="status">
            <RobotBadge />
            <span>Просмотр субагента</span>
            <button
              type="button"
              onClick={() => void controller?.closeSubagent()}
            >
              ← В чат
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
                {state.viewingSubagent !== null ? (
                  <span className="dsh-qa-header__viewing">
                    <RobotBadge />
                    Просмотр субагента
                    <button
                      type="button"
                      className="dsh-qa-header__back"
                      onClick={() => void controller?.closeSubagent()}
                    >
                      ← В чат
                    </button>
                  </span>
                ) : (
                  <span className="dsh-qa-header__mode">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="3.25" r="1.5" />
                      <circle cx="4" cy="11.75" r="1.5" />
                      <circle cx="12" cy="11.75" r="1.5" />
                      <path d="M8 4.75v2.5m0 0H4v3m4-3h4v3" />
                    </svg>
                    {modeLabel(config.session.agentPreset)}
                  </span>
                )}
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
                      setDrawerSources(null);
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
                      stateKey={stateKey}
                      resolveImage={resolveImage}
                      onRegenerate={
                        isLast &&
                        message.role === "assistant" &&
                        message.status === "committed" &&
                        controller !== undefined
                          ? handleRegenerate
                          : undefined
                      }
                      onOpenSources={handleOpenSources}
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
              quickQuestions={empty ? config.suggestedQuestions : NO_QUESTIONS}
              canSend={state.canSend}
              canStop={state.canStop}
              running={state.phase === "running"}
              showStop={config.ui.showStop}
              status={status}
              images={pendingImages}
              onImagesChange={setPendingImages}
              onSend={handleSend}
              onStop={handleStop}
            />
            {config.branding.disclaimer === "" ? null : (
              <p className="dsh-qa-footer__disclaimer">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5.75" />
                  <path d="M8 7.25v3.5m0-5.25v.5" />
                </svg>
                {config.branding.disclaimer}
              </p>
            )}
          </div>
        </footer>
      </div>
      {agentsOpen && agentRows.length > 0 ? (
        <QaAgentsDrawer
          agents={agentRows}
          activeId={state.viewingSubagent?.id ?? null}
          onView={(id, title) => void controller?.viewSubagent(id, title)}
          onClose={() => setAgentsOpen(false)}
        />
      ) : null}
      {sourcesOpen && (drawerSources ?? state.sources).length > 0 ? (
        <QaSourcesDrawer
          sources={drawerSources ?? state.sources}
          onClose={() => {
            setSourcesOpen(false);
            setDrawerSources(null);
          }}
        />
      ) : null}
    </main>
  );
}
