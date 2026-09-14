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
  QaAccountProfileInput,
  QaApprovalDecision,
  QaAttachmentDraft,
  QaQuestionAnswerItem,
} from "../types.js";
import type { QaConfigController } from "./QaConfigController.js";
import type { QaRouteController } from "./QaRouteController.js";
import type {
  QaAccountsController,
  QaAccountsSnapshot,
} from "./QaAccountsController.js";
import { QaSessionController } from "./QaSessionController.js";
import { attachmentLimits } from "./attachments.js";
import type {
  QaApprovalApi,
  QaBoundSkillApi,
  QaConversation,
  QaCreateSession,
  QaFileUpload,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaQuestionApi,
  QaSkillApi,
  QaSourceApi,
} from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import { QaAuthGate } from "./components/QaAuthGate.js";
import { QaApproval } from "./components/QaApproval.js";
import { QaQuestions } from "./components/QaQuestions.js";
import { QaComposer } from "./components/QaComposer.js";
import { QaHeader, QaSubagentBanner } from "./components/QaHeader.js";
import { QaMessage } from "./components/QaMessage.js";
import { buildChatRows, QaSidebar } from "./components/QaSidebar.js";
import {
  QaAgentsDrawer,
  collectSubagents,
} from "./components/QaAgentsDrawer.js";
import { collectChatFiles, countChatAttachments } from "./chat-files.js";
import { QaFilesPanel } from "./components/QaFilesPanel.js";
import { QaRightRail, type QaRailTabModel } from "./components/QaRightRail.js";
import { QaSourcesPanel } from "./components/QaSourcesPanel.js";
import {
  QA_TURN_FOLLOW_PX,
  QaTurnRail,
  computeActiveTurn,
  scrollToTranscriptAnchor,
  type QaTurnRailItem,
} from "./components/QaTurnRail.js";
import {
  QaWidthHandle,
  useQaContentWidth,
} from "./components/QaWidthHandle.js";
import { VariantSwitcher } from "./components/VariantSwitcher.js";
import { QaWelcomeNotice } from "./components/QaWelcomeNotice.js";
import { statusText, titleFromMessages } from "./components/surface-utils.js";
import { useThinkingPhrase } from "./components/thinking-phrases.js";
import {
  QaUserSettingsDialog,
  type QaSettingsSectionId,
} from "./user-settings/UserSettingsDialog.js";
import { useTranscriptView } from "./use-transcript-view.js";
import { useSessionUiState } from "./use-session-ui-state.js";
import { useRightRail } from "./use-right-rail.js";
import { qaStorageNamespace } from "../shared/session-key.js";

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
  readonly createSession: QaCreateSession;
  readonly sourceApi: QaSourceApi;
  /**
   * Personal-skill half of the plugin's namespace. Absent on a page whose Host
   * build does not answer it; the settings dialog then has no skills section.
   */
  readonly skillApi?: QaSkillApi;
  /**
   * Approval half of the plugin's namespace. Absent on a page whose Host build
   * does not answer it; the surface then only blocks sends it cannot attest.
   */
  readonly approvalApi?: QaApprovalApi;
  /** Question half of the plugin's namespace, when the Host answers it. */
  readonly questionApi?: QaQuestionApi;
  /**
   * Browser file-upload service, when the page serves the upload plugin.
   * Resolved per send so a page that loads it later still gets file support.
   */
  readonly fileUpload?: () => QaFileUpload | undefined;
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

/** Same follow threshold the rail uses: this close to the floor is "at bottom". */
function isNearBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <
    QA_TURN_FOLLOW_PX
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
  const stateKey = qaStorageNamespace(config);
  const widthHandlers = useQaContentWidth({
    active: route.active,
    root: chat,
    storage: window.localStorage,
    storageKey: `${stateKey}:content-width`,
    minContentWidth: config.ui.minContentWidth,
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
      createSession: props.createSession,
      sourceApi: props.sourceApi,
      ...(props.approvalApi === undefined
        ? {}
        : { approvalApi: props.approvalApi }),
      ...(props.questionApi === undefined
        ? {}
        : { questionApi: props.questionApi }),
      config,
      storage: window.localStorage,
      accounts: facade,
      ...(props.fileUpload === undefined
        ? {}
        : { fileUpload: props.fileUpload }),
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
    props.createSession,
    props.fileUpload,
    props.approvalApi,
    props.questionApi,
    props.secureSession,
    props.sourceApi,
    props.sessions,
    route.active,
  ]);

  // The drawer receives a token-bound view; its props keep the simple shape.
  // The settings dialog speaks to the skills namespace with the account token
  // already bound, so its pages never see an identity.
  const boundSkillApi = useMemo((): QaBoundSkillApi | undefined => {
    if (props.skillApi === undefined) return undefined;
    const skillApi = props.skillApi;
    const token = () => accounts?.token() ?? "";
    return {
      list: async () => {
        const result = await skillApi.skillsList(token());
        return result.ok
          ? { ok: true, value: result.value.skills }
          : { ok: false, error: result.error };
      },
      get: (name) => skillApi.skillsGet(token(), name),
      create: (input) => skillApi.skillsCreate(token(), input),
      update: (name, input) => skillApi.skillsUpdate(token(), name, input),
      remove: (name, revision) =>
        skillApi.skillsRemove(token(), name, revision),
      tools: async () => {
        const result = await skillApi.skillsTools(token());
        return result.ok
          ? { ok: true, value: result.value.tools }
          : { ok: false, error: result.error };
      },
      validate: (name, input) => skillApi.skillsValidate(token(), name, input),
    };
  }, [props.skillApi, accounts]);
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
  // The settings dialog is owned here, not by the sidebar: its pages read the
  // deployment config, the account and the skill namespace, while the sidebar
  // only offers the button that opens it.
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  // hook clears them whenever the bound session changes. The rail controller
  // takes the drawer slice; the surface keeps the composer and marks state.
  const ui = useSessionUiState(state.sessionId);
  const rail = useRightRail(ui);
  const {
    activeTurn,
    setActiveTurn,
    variantOffsets,
    setVariantOffsets,
    agentsOpen,
    setAgentsOpen,
    pendingAttachments,
    setPendingAttachments,
  } = ui;

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
  // One identity per configuration: the composer is memoized on shallow
  // comparison, so a fresh limits object would re-render it every frame.
  const limits = useMemo(() => attachmentLimits(config), [config]);
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
    (text: string, attachments: readonly QaAttachmentDraft[]) =>
      controller?.send(text, attachments) ?? Promise.resolve(false),
    [controller],
  );
  const handleStop = useCallback(
    () => controller?.stop() ?? Promise.resolve(),
    [controller],
  );
  const handleAnswerApproval = useCallback(
    (requestId: string, decision: QaApprovalDecision) =>
      controller?.answerApproval(requestId, decision) ?? Promise.resolve(),
    [controller],
  );
  const handleAnswerQuestion = useCallback(
    (requestId: string, answers: readonly QaQuestionAnswerItem[]) =>
      controller?.answerQuestion(requestId, answers) ?? Promise.resolve(),
    [controller],
  );
  const handleCancelQuestion = useCallback(
    (requestId: string) =>
      controller?.cancelQuestion(requestId) ?? Promise.resolve(),
    [controller],
  );
  const handleCloseSubagent = useCallback(() => {
    void controller?.closeSubagent();
  }, [controller]);
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
    if (element === null || !scrollToTranscriptAnchor(element, item.id)) return;
    nearBottom.current = isNearBottom(element);
    setActiveTurn(item.turn);
  }, []);
  /** The files tab's jump control: land the transcript on the sender. */
  const handleJumpToMessage = useCallback((messageId: string) => {
    const element = transcript.current;
    if (element === null || !scrollToTranscriptAnchor(element, messageId)) {
      return;
    }
    nearBottom.current = isNearBottom(element);
  }, []);

  const view = useTranscriptView(state.messages, variantOffsets);
  const railItems = view.railItems;
  // Publish the visible turn marks before the follow/reading-line effects
  // read them: layout effects flush in declaration order, and the sync below
  // reads exactly this ref.
  useLayoutEffect(() => {
    railItemsRef.current = railItems;
  }, [railItems]);

  useLayoutEffect(() => {
    const element = transcript.current;
    if (element !== null && nearBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
    scheduleActiveTurnSync();
  }, [state.messages, state.pendingMessage, scheduleActiveTurnSync]);

  // The composer hint repeats the work list's phrase, so both advance in step
  // off the same turn start.
  const runningStartedAt = useMemo(() => {
    if (state.phase !== "running") return undefined;
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role === "work" && message.status === "running") {
        return message.startedAt;
      }
    }
    return undefined;
  }, [state.messages, state.phase]);
  const runningPhrase = useThinkingPhrase(
    state.phase === "running",
    runningStartedAt,
    config.thinkingPhrases,
  );
  const status = statusText(state, runningPhrase);
  const empty = state.messages.length === 0 && state.pendingMessage === null;
  const conversationTitle = titleFromMessages(state);
  const showSidebar = config.ui.showSessionList && controller !== undefined;
  const allowNewChat =
    config.session.policy !== "fixed" &&
    (!config.lockdown.enabled || config.lockdown.allowSessionReset);
  const visibleMessages = view.visibleMessages;
  const activeSessionId = controller?.activeSessionId() ?? null;
  const agentRows = useMemo(
    () => collectSubagents(listState.byId, activeSessionId),
    [listState, activeSessionId],
  );
  // The files tab projects the chat's durable attachments; the header badge
  // and the panel read the same memoized roster.
  const fileGroups = useMemo(
    () => collectChatFiles(state.messages),
    [state.messages],
  );
  const attachmentCount = useMemo(
    () => countChatAttachments(fileGroups),
    [fileGroups],
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
  // The sidebar compares this by reference, so the entry point is stable
  // until the label or the callback identity actually changes.
  const settingsEntry = useMemo(
    () =>
      accountsSnapshot.stage === "authed"
        ? {
            label:
              accountsSnapshot.user.profile.fullName === ""
                ? accountsSnapshot.user.email
                : accountsSnapshot.user.profile.fullName,
            onOpen: () => setSettingsOpen(true),
          }
        : undefined,
    [accountsSnapshot],
  );
  // Everything the dialog needs, assembled once per change. Each face is
  // absent where the deployment withheld the feature, and the dialog simply
  // renders the sections it was given.
  const settingsDialog = useMemo(() => {
    if (accounts === undefined || accountsSnapshot.stage !== "authed") {
      return undefined;
    }
    const profile = config.accounts.profile.enabled
      ? {
          profile: accountsSnapshot.user.profile,
          fields: config.accounts.profile.identities,
          instructionsMaxLength: config.accounts.profile.instructionsMaxLength,
          onSave: (input: QaAccountProfileInput) =>
            accounts.updateProfile(input),
        }
      : undefined;
    const skills =
      config.accounts.skills.enabled && boundSkillApi !== undefined
        ? boundSkillApi
        : undefined;
    if (profile === undefined && skills === undefined) return undefined;
    return { profile, skills };
  }, [accounts, accountsSnapshot, config, boundSkillApi]);
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

  const showResetButton = config.ui.showReset && allowNewChat;
  // Rebuilt per frame, but reconciliation keeps each panel mounted in place,
  // so the sources detail and the files roster carry their state across.
  const railTabs: readonly QaRailTabModel[] = [
    ...(config.sources.enabled
      ? [
          {
            id: "sources" as const,
            title: "Источники",
            count: (rail.drawerSources ?? state.sources).length,
            body: (
              <QaSourcesPanel
                // Remount on a new detail request: the panel is internal-state
                // driven, so an already-mounted panel would ignore a changed
                // initialDetail otherwise.
                key={rail.drawerDetail?.id ?? "list"}
                sources={rail.drawerSources ?? state.sources}
                complete={
                  rail.drawerCompleteness?.complete ?? state.sourcesComplete
                }
                incompleteOrigins={
                  rail.drawerCompleteness?.incompleteOrigins ??
                  state.incompleteSourceOrigins
                }
                sessionId={state.sessionId}
                sourceApi={boundSourceApi}
                display={config.sources.display}
                filePreview={config.sources.filePreview}
                initialDetail={rail.drawerDetail}
                pinned={rail.drawerSources !== null}
                onShowAll={rail.showAllSources}
              />
            ),
          },
        ]
      : []),
    {
      id: "files" as const,
      title: "Файлы",
      count: attachmentCount,
      body: (
        <QaFilesPanel
          groups={fileGroups}
          resolveImage={resolveImage}
          onJumpToMessage={handleJumpToMessage}
        />
      ),
    },
  ];

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
      {settingsDialog === undefined ? null : (
        <QaUserSettingsDialog
          open={settingsOpen}
          initialSection={
            (config.accounts.profile.enabled
              ? "profile"
              : "general") satisfies QaSettingsSectionId
          }
          email={
            accountsSnapshot.stage === "authed"
              ? accountsSnapshot.user.email
              : ""
          }
          role={
            accountsSnapshot.stage === "authed"
              ? accountsSnapshot.user.role
              : ""
          }
          chatCount={controller?.chatIds().length ?? 0}
          onClose={() => setSettingsOpen(false)}
          {...(settingsDialog.profile === undefined
            ? {}
            : { profile: settingsDialog.profile })}
          {...(settingsDialog.skills === undefined
            ? {}
            : { skills: settingsDialog.skills })}
        />
      )}
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
                    ...(settingsEntry === undefined
                      ? {}
                      : { settings: settingsEntry }),
                  }
                : undefined
            }
          />
        ) : null}
        <div className="dsh-qa-body">
          {state.viewingSubagent !== null && !config.ui.showHeader ? (
            <QaSubagentBanner onClose={handleCloseSubagent} />
          ) : null}
          {config.ui.showHeader ? (
            <QaHeader
              logoUrl={config.branding.logoUrl}
              title={conversationTitle}
              viewingSubagent={state.viewingSubagent !== null}
              onCloseSubagent={handleCloseSubagent}
              agentPreset={config.session.agentPreset}
              agentCount={agentRows.length}
              agentsOpen={agentsOpen}
              onToggleAgents={rail.toggleAgents}
              sourcesVisible={
                config.sources.enabled && config.sources.display.sidebar
              }
              sourcesCount={state.sources.length}
              sourcesComplete={state.sourcesComplete}
              sourcesOpen={rail.railOpen && rail.railTab === "sources"}
              onOpenSources={() => rail.openTab("sources")}
              fileCount={attachmentCount}
              filesOpen={rail.railOpen && rail.railTab === "files"}
              onOpenFiles={() => rail.openTab("files")}
              showReset={showResetButton}
              resetDisabled={
                controller === undefined || state.phase === "creating"
              }
              onReset={handleNewChat}
            />
          ) : null}

          <div
            ref={chat}
            className="dsh-qa-chat"
            style={
              {
                "--dsh-qa-content-width": `${config.ui.minContentWidth}px`,
              } as CSSProperties
            }
          >
            <div
              ref={transcript}
              className="dsh-qa-transcript"
              onScroll={(event) => {
                const element = event.currentTarget;
                nearBottom.current = isNearBottom(element);
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
                          thinkingPhrases={config.thinkingPhrases}
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
                              ? rail.openSources
                              : undefined
                          }
                          onSourceDetail={
                            config.sources.enabled
                              ? rail.openSourceDetail
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
                {state.pendingMessage === null ? null : (
                  <div className="dsh-qa-message-slot">
                    <QaMessage
                      message={state.pendingMessage}
                      renderMarkdown={false}
                      showTimestamp={false}
                      thinkingPhrases={config.thinkingPhrases}
                    />
                  </div>
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
                <QaApproval
                  approvals={state.approvals}
                  onAnswer={handleAnswerApproval}
                />
                <QaQuestions
                  questions={state.questions}
                  onAnswer={handleAnswerQuestion}
                  onCancel={handleCancelQuestion}
                />
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
                  attachments={pendingAttachments}
                  limits={limits}
                  onAttachmentsChange={setPendingAttachments}
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
        {rail.railOpen ? (
          <QaRightRail
            tabs={railTabs}
            activeTab={rail.railTab}
            onTabSelect={rail.selectTab}
            onClose={rail.close}
          />
        ) : null}
      </main>
    </>
  );
}
