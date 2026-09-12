import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { ConnectionGenerationState } from "@deepseek-ai/dsh-client-connection/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {
  QaImageDraft,
  QaSessionState,
  QaSource,
  QaTurnSources,
} from "../types.js";
import type { QaConfigController } from "./QaConfigController.js";
import type { QaRouteController } from "./QaRouteController.js";
import type {
  QaAccountsController,
  QaAccountsSnapshot,
} from "./QaAccountsController.js";
import { QaSessionController } from "./QaSessionController.js";
import type {
  QaConversation,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaSourceApi,
} from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import { QaAuthGate } from "./components/QaAuthGate.js";
import { QaComposer } from "./components/QaComposer.js";
import { QaMessage } from "./components/QaMessage.js";
import { buildChatRows, QaSidebar } from "./components/QaSidebar.js";
import {
  QaAgentsDrawer,
  collectSubagents,
} from "./components/QaAgentsDrawer.js";
import { QaSourcesDrawer } from "./components/QaSourcesDrawer.js";
import {
  QA_TURN_ANCHOR_ATTRIBUTE,
  QaTurnRail,
  computeActiveTurn,
  turnScrollTarget,
  type QaTurnRailItem,
} from "./components/QaTurnRail.js";
import {
  QaWidthHandle,
  useQaContentWidth,
} from "./components/QaWidthHandle.js";
import { VariantSwitcher } from "./components/VariantSwitcher.js";
import { QaWelcomeNotice } from "./components/QaWelcomeNotice.js";
import { useTranscriptView } from "./use-transcript-view.js";
import { useSessionUiState } from "./use-session-ui-state.js";

const noopSubscribe = () => () => undefined;

/** Stable empty stand-in so memoized children see one identity, not a fresh []. */
const NO_QUESTIONS: readonly string[] = Object.freeze([]);

const ACCOUNTS_CHECKING_SNAPSHOT: QaAccountsSnapshot = { stage: "checking" };
const noopAccountsSnapshot = (): QaAccountsSnapshot =>
  ACCOUNTS_CHECKING_SNAPSHOT;

export interface QaSurfaceFace {
  readonly route: QaRouteController;
  readonly config: QaConfigController;
  readonly sessions: QaSessions;
  readonly conversation: QaConversation;
  readonly api: QaSessionsApi;
  readonly connection: ConnectionGenerationState;
  readonly secureSession: QaSecureSession;
  readonly sourceApi: QaSourceApi;
  /** Present when the deployment mounts the QA account gate. */
  readonly accounts?: QaAccountsController;
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
  const accounts = props.accounts;
  const accountsSnapshot = useSyncExternalStore(
    accounts?.subscribe ?? noopSubscribe,
    accounts?.getSnapshot ?? noopAccountsSnapshot,
    accounts?.getSnapshot ?? noopAccountsSnapshot,
  );
  const accountsStage = accountsSnapshot.stage;
  const [controller, setController] = useState<QaSessionController>();
  const transcript = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  /** Turn marks of the visible transcript, kept in a ref for stable callbacks. */
  const railItemsRef = useRef<readonly QaTurnRailItem[]>([]);
  const activeTurnFrame = useRef<number | null>(null);
  const stateKey = `${config.session.storageKey}:v1:${config.route.path}`;
  const widthHandlers = useQaContentWidth({
    active: route.active,
    root: chat,
    storage: window.localStorage,
    storageKey: `${stateKey}:content-width`,
    maxContentWidth: config.ui.maxContentWidth,
  });

  useEffect(() => {
    if (!route.active) {
      setController(undefined);
      return;
    }
    const accountsEnabled = config.accounts.enabled && accounts !== undefined;
    // The gate owns the frame until the browser holds a valid identity; the
    // session controller (and every attestation it triggers) waits for it.
    if (accountsEnabled && accountsStage !== "authed") {
      setController(undefined);
      return;
    }
    const facade =
      accountsEnabled && accounts
        ? {
            token: () => accounts.token(),
            ownedIds: () => accounts.ownedIds(),
            messageAuthorOf: (sessionId: string) =>
              accounts.messageAuthorOf(sessionId),
            onSessionCreated: (sessionId: string) => {
              void accounts.claimNewSession(sessionId);
            },
            onAuthRequired: () => accounts.signOut(),
          }
        : undefined;
    const next = new QaSessionController({
      sessions: props.sessions,
      api: props.api,
      conversation: props.conversation,
      connection: props.connection,
      secureSession: props.secureSession,
      sourceApi: props.sourceApi,
      config,
      storage: window.localStorage,
      accounts: facade,
    });
    setController(next);
    void next.ensureSession();
    return () => next.dispose();
  }, [
    accounts,
    accountsStage,
    config,
    props.api,
    props.conversation,
    props.connection,
    props.secureSession,
    props.sourceApi,
    props.sessions,
    route.active,
  ]);

  // The drawer receives a token-bound view; its props keep the simple shape.
  const boundSourceApi = useMemo(
    () => ({
      sources: (sessionId: string) =>
        props.sourceApi.sources(accounts?.token() ?? "", sessionId),
      readSourceFile: (sessionId: string, sourcePath: string) =>
        props.sourceApi.readSourceFile(
          accounts?.token() ?? "",
          sessionId,
          sourcePath,
        ),
    }),
    [accounts, props.sourceApi],
  );
  const handleLogout = useCallback(() => {
    accounts?.signOut();
  }, [accounts]);

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
  // Draft text, attachments, variant offsets and drawers are chat-local; the
  // hook clears them whenever the bound session changes.
  const {
    activeTurn,
    setActiveTurn,
    variantOffsets,
    setVariantOffsets,
    pendingImages,
    setPendingImages,
    agentsOpen,
    setAgentsOpen,
    sourcesOpen,
    setSourcesOpen,
    drawerSources,
    setDrawerSources,
    drawerCompleteness,
    setDrawerCompleteness,
    drawerDetail,
    setDrawerDetail,
  } = useSessionUiState(state.sessionId);

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
  /** Turn the transcript's reading line currently owns; rAF-throttled. */
  const syncActiveTurn = useCallback(() => {
    const element = transcript.current;
    const items = railItemsRef.current;
    if (element === null || items.length === 0) {
      setActiveTurn((current) => (current === null ? current : null));
      return;
    }
    const next = computeActiveTurn(element, items);
    setActiveTurn((current) => (current === next ? current : next));
  }, []);
  const scheduleActiveTurnSync = useCallback(() => {
    if (activeTurnFrame.current !== null) return;
    if (typeof requestAnimationFrame === "undefined") {
      syncActiveTurn();
      return;
    }
    activeTurnFrame.current = requestAnimationFrame(() => {
      activeTurnFrame.current = null;
      syncActiveTurn();
    });
  }, [syncActiveTurn]);
  useEffect(
    () => () => {
      if (
        activeTurnFrame.current !== null &&
        typeof cancelAnimationFrame !== "undefined"
      ) {
        cancelAnimationFrame(activeTurnFrame.current);
      }
    },
    [],
  );
  const handleTurnNavigate = useCallback((item: QaTurnRailItem) => {
    const element = transcript.current;
    if (element === null) return;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(item.id)
        : item.id;
    const row = element.querySelector<HTMLElement>(
      `[${QA_TURN_ANCHOR_ATTRIBUTE}="${escaped}"]`,
    );
    if (row === null) return;
    element.scrollTop = turnScrollTarget(element, row);
    nearBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    setActiveTurn(item.turn);
  }, []);
  const handleOpenSources = useCallback(
    (
      sources: readonly QaSource[],
      complete: boolean,
      incompleteOrigins: QaTurnSources["incompleteOrigins"],
    ) => {
      setDrawerSources(sources);
      setDrawerCompleteness({
        complete,
        ...(incompleteOrigins === undefined ? {} : { incompleteOrigins }),
      });
      setDrawerDetail(null);
      setSourcesOpen(true);
      setAgentsOpen(false);
    },
    [],
  );
  const handleSourceDetail = useCallback((source: QaSource) => {
    setDrawerSources(null);
    setDrawerCompleteness(null);
    setDrawerDetail(source);
    setSourcesOpen(true);
    setAgentsOpen(false);
  }, []);

  useLayoutEffect(() => {
    const element = transcript.current;
    if (element !== null && nearBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
    scheduleActiveTurnSync();
  }, [state.messages, scheduleActiveTurnSync]);

  const status = statusText(state);
  const empty = state.messages.length === 0;
  const conversationTitle = titleFromMessages(state);
  const showSidebar = config.ui.showSessionList && controller !== undefined;
  const allowNewChat =
    config.session.policy !== "fixed" &&
    (!config.lockdown.enabled || config.lockdown.allowSessionReset);
  const view = useTranscriptView(state.messages, variantOffsets);
  const visibleMessages = view.visibleMessages;
  const activeSessionId = controller?.activeSessionId() ?? null;
  const agentRows = useMemo(
    () => collectSubagents(listState.byId, activeSessionId),
    [listState, activeSessionId],
  );
  // Admins group the sidebar by chat owner; everyone else sees the flat list.
  const ownerNames = useMemo(
    () =>
      config.accounts.enabled &&
      config.accounts.showOtherUsersChats &&
      accounts !== undefined &&
      accountsSnapshot.stage === "authed" &&
      accountsSnapshot.user.role === "admin"
        ? accounts.ownerNames()
        : undefined,
    [config, accounts, accountsSnapshot],
  );
  const railItems = view.railItems;
  railItemsRef.current = railItems;
  const busyTurn =
    state.phase === "running" ? (railItems.at(-1)?.turn ?? null) : null;
  const chatRows = useMemo(
    () =>
      showSidebar
        ? buildChatRows(
            controller?.chatIds() ?? [],
            listState.byId,
            activeSessionId,
            (id) => ownerNames?.get(id),
          )
        : [],
    [
      showSidebar,
      controller,
      listState,
      activeSessionId,
      ownerNames,
      state.chatsRevision,
    ],
  );
  // Message ids repeat across chats (`assistant:<seq>`), so the persisted
  // ratings key is chat-scoped; the sidebar keeps the deployment-wide key.
  const messageStateKey =
    state.sessionId === null
      ? undefined
      : `${stateKey}:chat:${state.sessionId}`;
  if (!route.active) return null;

  // DSH only seats onboarding while the active Session is blank. Keep the QA
  // disclosure in this route-owned overlay so sending a prompt cannot dismiss
  // it; the shadow step registered in index.tsx only suppresses the stock copy.
  const welcomeNotice = (
    <QaWelcomeNotice
      key={stateKey}
      storage={window.localStorage}
      storageKey={`${stateKey}:welcome-notice`}
    />
  );

  if (config.accounts.enabled && accounts !== undefined) {
    if (accountsStage === "checking") {
      return (
        <>
          {welcomeNotice}
          <main
            className="dsh-qa-surface"
            aria-busy="true"
            aria-label={config.branding.title}
            tabIndex={-1}
          />
        </>
      );
    }
    if (accountsStage === "gate") {
      return (
        <>
          {welcomeNotice}
          <QaAuthGate
            accounts={accounts}
            snapshot={accountsSnapshot}
            title={config.branding.title}
            logoUrl={config.branding.logoUrl}
            allowRegistration={config.accounts.allowRegistration}
          />
        </>
      );
    }
  }

  return (
    <>
      {welcomeNotice}
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
            groupByOwner={ownerNames !== undefined}
            title={config.branding.title}
            logoUrl={config.branding.logoUrl}
            stateKey={stateKey}
            showNewChat={allowNewChat}
            busy={state.phase === "creating"}
            onSwitch={handleSwitch}
            onNewChat={handleNewChat}
            onDelete={handleDelete}
            account={
              config.accounts.enabled &&
              accounts !== undefined &&
              accountsStage === "authed"
                ? {
                    email: accountsSnapshot.user.email,
                    role: accountsSnapshot.user.role,
                    onLogout: handleLogout,
                  }
                : undefined
            }
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
                      config.sources.enabled && config.sources.display.sidebar
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
                  {config.sources.enabled && config.sources.display.sidebar ? (
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
                      disabled={
                        state.sources.length === 0 && state.sourcesComplete
                      }
                      aria-expanded={sourcesOpen}
                      onClick={() => {
                        setSourcesOpen((open) => !open);
                        setDrawerSources(null);
                        setDrawerCompleteness(null);
                        setAgentsOpen(false);
                      }}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <circle cx="8" cy="8" r="5.75" />
                        <path d="M2.25 8h11.5M8 2.25c1.6 1.55 2.4 3.5 2.4 5.75S9.6 12.2 8 13.75C6.4 12.2 5.6 10.25 5.6 8S6.4 3.8 8 2.25Z" />
                      </svg>
                      Источники
                      {state.sources.length === 0 && state.sourcesComplete
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
            ref={chat}
            className="dsh-qa-chat"
            style={
              {
                "--dsh-qa-content-width": `${config.ui.maxContentWidth}px`,
              } as CSSProperties
            }
          >
            <div
              ref={transcript}
              className="dsh-qa-transcript"
              onScroll={(event) => {
                const element = event.currentTarget;
                nearBottom.current =
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight <
                  96;
                scheduleActiveTurnSync();
              }}
            >
              {empty ? null : (
                <QaTurnRail
                  items={railItems}
                  activeTurn={activeTurn}
                  busyTurn={busyTurn}
                  scrollerRef={transcript}
                  onNavigate={handleTurnNavigate}
                />
              )}
              <div className="dsh-qa-transcript__inner">
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
                        ? view.groupByPromptId.get(message.id)
                        : undefined;
                    const isLast = index === visibleMessages.length - 1;
                    return (
                      <div
                        key={message.id}
                        className="dsh-qa-message-slot"
                        data-dsh-qa-turn-anchor={
                          message.role === "user" ? message.id : undefined
                        }
                      >
                        <QaMessage
                          message={message}
                          renderMarkdown={config.ui.renderMarkdown}
                          showTimestamp={config.ui.showTimestamps}
                          stateKey={messageStateKey}
                          resolveImage={resolveImage}
                          onRegenerate={
                            isLast &&
                            message.role === "assistant" &&
                            message.status === "committed" &&
                            controller !== undefined
                              ? handleRegenerate
                              : undefined
                          }
                          onOpenSources={
                            config.sources.enabled &&
                            config.sources.display.footer
                              ? handleOpenSources
                              : undefined
                          }
                          onSourceDetail={
                            config.sources.enabled
                              ? handleSourceDetail
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
              <div className="dsh-qa-footer__inner">
                {/* Keyed by chat: the composer's draft text is chat-local, so a
                  switch remounts it empty instead of carrying text across. */}
                <QaComposer
                  key={state.sessionId ?? "draft"}
                  placeholder={config.branding.placeholder}
                  quickQuestions={
                    empty ? config.suggestedQuestions : NO_QUESTIONS
                  }
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
            {!empty
              ? (["left", "right"] as const).map((side) => (
                  <QaWidthHandle key={side} side={side} {...widthHandlers} />
                ))
              : null}
          </div>
        </div>
        {agentsOpen && agentRows.length > 0 ? (
          <QaAgentsDrawer
            agents={agentRows}
            activeId={state.viewingSubagent?.id ?? null}
            onView={(id, title) => void controller?.viewSubagent(id, title)}
            onClose={() => setAgentsOpen(false)}
          />
        ) : null}
        {sourcesOpen &&
        ((drawerSources ?? state.sources).length > 0 ||
          !(drawerCompleteness?.complete ?? state.sourcesComplete)) ? (
          <QaSourcesDrawer
            sources={drawerSources ?? state.sources}
            complete={drawerCompleteness?.complete ?? state.sourcesComplete}
            incompleteOrigins={
              drawerCompleteness?.incompleteOrigins ??
              state.incompleteSourceOrigins
            }
            sessionId={state.sessionId}
            sourceApi={boundSourceApi}
            display={config.sources.display}
            filePreview={config.sources.filePreview}
            initialDetail={drawerDetail}
            onClose={() => {
              setSourcesOpen(false);
              setDrawerSources(null);
              setDrawerCompleteness(null);
              setDrawerDetail(null);
            }}
          />
        ) : null}
      </main>
    </>
  );
}
