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
  PropsRenderSlots,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {
  QaAccountNotificationsInput,
  QaAccountProfileInput,
  QaAccountStartersInput,
  QaApprovalDecision,
  QaArtifactView,
  QaAttachmentDraft,
  QaQuestionAnswerItem,
  QaCurrentAccess,
  QaSubrole,
  QaFeedbackReason,
} from "../types.js";
import { effectiveQuickQuestions } from "../starters.js";
import { qaKioskMode } from "./kiosk.js";
import type { QaQuickQuestion } from "./types.js";
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
  QaAccessApi,
  QaAdminApi,
  QaBoundSkillApi,
  QaIntegrationTokenApi,
  QaConversation,
  QaCreateSession,
  QaFileUpload,
  QaQueueStatusRemote,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaQuestionApi,
  QaSkillApi,
  QaSlashApi,
  QaSourceApi,
} from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import { QaAuthGate } from "./components/QaAuthGate.js";
import { QaApproval } from "./components/QaApproval.js";
import { QaQuestions } from "./components/QaQuestions.js";
import { QaRequestQueue } from "./components/QaRequestQueue.js";
import { QaComposer } from "./components/QaComposer.js";
import { QaQueueDock } from "./components/QaQueueDock.js";
import { QaHeader, QaSubagentBanner } from "./components/QaHeader.js";
import { QaThemeSwitcher } from "./components/QaThemeSwitcher.js";
import { useQaThemePreference } from "./theme-preference.js";
import { QaMessage } from "./components/QaMessage.js";
import { buildChatRows, QaSidebar } from "./components/QaSidebar.js";
import {
  QaAgentsDrawer,
  collectSubagents,
} from "./components/QaAgentsDrawer.js";
import { collectChatFiles, countChatAttachments } from "./chat-files.js";
import { downloadWorkspaceFile } from "./workspace-download.js";
import { QaFilesPanel } from "./components/QaFilesPanel.js";
import { isQaModalOpen } from "./components/QaModal.js";
import { QaRightRail, type QaRailTabModel } from "./components/QaRightRail.js";
import { QaSourcesPanel } from "./components/QaSourcesPanel.js";
import {
  QA_TURN_NOTICE_LINE_SELECTOR,
  QA_TURN_NOTICE_OFFER_SELECTOR,
  QaTurnNotice,
} from "./components/QaTurnNotice.js";
import { useQaTurnNotifications } from "./notifications/use-turn-notifications.js";
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
  focusFirst,
  focusRing,
  focusable,
  isInert,
  trapKeys,
} from "./focus-ring.js";
import {
  QaUserSettingsDialog,
  type QaSettingsSectionId,
} from "./user-settings/UserSettingsDialog.js";
import { useTranscriptView } from "./use-transcript-view.js";
import { useSessionUiState } from "./use-session-ui-state.js";
import { useRightRail } from "./use-right-rail.js";
import { qaStorageNamespace } from "../shared/session-key.js";
import { QaPanelHost } from "./panels/PanelHost.js";
import { QaPanelLauncher } from "./panels/PanelLauncher.js";
import type { QaSurfacePanelRegistry } from "./panels/registry.js";
import type { QaUserSettingsSections } from "./settings-extensions/index.js";
import type { QaAuditController } from "./audit/controller.js";
import { QaAuditDialog } from "./audit/QaAuditDialog.js";
import { useChatAudits } from "./audit/use-chat-audits.js";
import { QaAdmin } from "./admin/QaAdmin.js";
import { isAdminPath } from "./admin/routes.js";
import { QaAdminPreviewBanner, QaRoleSelector } from "./role/RoleSelector.js";
import { useQaAdminPreview } from "./role/preview.js";

const noopSubscribe = () => () => undefined;

/**
 * The surface element's class. In the kiosk composition the element is the
 * runtime's root occupant, so it carries the root-presentation modifier and
 * owns the viewport in normal flow; in the overlay composition it covers the
 * native shell as before. The mode is fixed for the page — the prelude runs
 * before any application script — so the class is computed once, here.
 */
const QA_SURFACE_CLASS = qaKioskMode()
  ? "dsh-qa-surface dsh-qa-surface--root"
  : "dsh-qa-surface";

/** Stable empty stand-in so memoized children see one identity, not a fresh []. */
const NO_QUESTIONS: readonly QaQuickQuestion[] = Object.freeze([]);

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
  readonly accessApi: QaAccessApi;
  /**
   * The administrative console's surface. Optional so an older Host that does
   * not answer it still renders the capability editors.
   */
  readonly adminApi?: QaAdminApi;
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
   * Slash half of the plugin's namespace. Absent on a Host build that predates
   * it: the composer then never opens a palette and ordinary prompts are
   * untouched.
   */
  readonly slashApi?: QaSlashApi;
  /**
   * The Host's live read of the request ceiling. Absent on a Host build that
   * predates it: a deployment with no ceiling never asks, so nothing changes.
   */
  readonly queueStatus?: QaQueueStatusRemote;
  /**
   * Browser file-upload service, when the page serves the upload plugin.
   * Resolved per send so a page that loads it later still gets file support.
   */
  readonly fileUpload?: () => QaFileUpload | undefined;
  /** Present when the deployment mounts the QA account gate. */
  readonly accounts?: QaAccountsController;
  /** Global client-only panel metadata and presentation navigation. */
  readonly panels: QaSurfacePanelRegistry;
  /** First-class settings pages registered by additive QA plugins. */
  readonly settingsSections: QaUserSettingsSections;
  /**
   * Whether the session-audit provider is installed. Its snapshot carries the
   * audit API, or `null` — the badge and the dialog exist only while it is
   * present.
   */
  readonly audit: QaAuditController;
}

export type QaSurfaceProps = PropsRuntime<"shell.overlay"> &
  PropsRenderSlots<"qa.surface.panel"> &
  InjectFace<QaSurfaceFace>;

/** Same follow threshold the rail uses: this close to the floor is "at bottom". */
function isNearBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <
    QA_TURN_FOLLOW_PX
  );
}

/**
 * The stack line the reader's control stands on, or null when the ring has no
 * place to keep for it. The desktop opt-in is not a line: it is what the stack
 * ends with, so losing it is losing the last control of the last line, and that
 * line is taken as its place. The opt-in is read by its own block rather than as
 * whatever the stack holds that is not a line — the next block the stack grows
 * (a heading, a «скрыть все») is neither, and handing the reader to a line they
 * never stood on is worse than handing them nowhere.
 */
function noticeLineOf(
  target: HTMLElement,
  stack: HTMLElement,
): HTMLElement | null {
  const line = target.closest<HTMLElement>(QA_TURN_NOTICE_LINE_SELECTOR);
  if (line !== null) return line;
  if (target.closest<HTMLElement>(QA_TURN_NOTICE_OFFER_SELECTOR) === null) {
    return null;
  }
  const lines = stack.querySelectorAll<HTMLElement>(
    QA_TURN_NOTICE_LINE_SELECTOR,
  );
  return lines.item(lines.length - 1);
}

/**
 * The line the stack lists on this side of `line`, or null when there is none:
 * the opt-in block shares the stack with the lines but is not one of them, so it
 * is not a place a reader can be handed back to.
 */
function adjacentNoticeLine(
  line: HTMLElement,
  side: "previous" | "next",
): HTMLElement | null {
  const sibling =
    side === "previous" ? line.previousElementSibling : line.nextElementSibling;
  return sibling instanceof HTMLElement &&
    sibling.matches(QA_TURN_NOTICE_LINE_SELECTOR)
    ? sibling
    : null;
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
  // Access depends on the authenticated principal, not on the account store's
  // chat-ownership revision. Claiming a freshly created chat updates ownedIds;
  // treating that publication as a new principal tears down the session
  // controller in the middle of its first send.
  const accessPrincipal =
    accountsSnapshot.stage === "authed"
      ? `${accountsSnapshot.user.id}:${accountsSnapshot.user.role}`
      : null;
  const adminRoute = isAdminPath(route.pathname, config.route.path);
  const [access, setAccess] = useState<QaCurrentAccess>();
  const [selectedSubrole, setSelectedSubrole] = useState<string | null>(null);
  const [sessionRole, setSessionRole] = useState<QaSubrole>();
  /** Whether the chat on screen was itself created as an administrator preview. */
  const [sessionPreview, setSessionPreview] = useState(false);
  const [controller, setController] = useState<QaSessionController>();
  const transcript = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const surface = useRef<HTMLElement>(null);
  /** The notice stack: after `<main>` in the page, inside the ring with it. */
  const noticeStack = useRef<HTMLDivElement>(null);
  /**
   * Whether a dialog, rather than this ring, owns the keyboard: the onboarding
   * gate holds the page inert, and a `QaModal` stands over it with the Escape of
   * its own. Neither paints the notice stack away — a dialog is a neighbour of
   * it, not an ancestor — so the ring has to step back of its own accord, and
   * step back to the subtree it counted before the stack was ever part of it.
   */
  const dialogOwnsKeyboard = useCallback((): boolean => {
    const root = surface.current;
    return isQaModalOpen() || (root !== null && isInert(root));
  }, []);
  /** The roots the Tab ring is drawn around, in the order the ring walks them. */
  const ringRoots = useCallback(
    (): readonly (HTMLElement | null)[] =>
      dialogOwnsKeyboard()
        ? [surface.current]
        : [surface.current, noticeStack.current],
    [dialogOwnsKeyboard],
  );
  /**
   * Where the keyboard last stood in the notice stack: the control, the line it
   * stood on, the lines the stack listed beside it, and the control's step
   * within the line. The stack alone is remembered: a control of `<main>` that
   * leaves the page with its row — a queue dock entry, a transcript action, a
   * rebuilt chat — is the surface's own business, and this ring hands nothing
   * back there. Read as focus moves, so it names where the reader stands rather
   * than where they once stood: a focus landing anywhere else lets the place go.
   *
   * The place is held as lines, not as a number counted along the ring, because
   * a counted place is not a stable coordinate here. A finished turn is put in
   * front of the lines the reader already sees (`use-turn-notifications.ts`), so
   * a step counted from the front of the stack slides by as many controls as the
   * batch brought, and `<main>`, which the ring counts first, grows and shrinks
   * for reasons of its own. The line the reader stood on and its neighbours keep
   * the one claim the restore has to make — hand the keyboard to the line that
   * took their place — whatever else arrived or left in the same moment.
   */
  const ringAnchor = useRef<{
    /** The control itself: its loss is read from the page, not counted. */
    element: HTMLElement;
    line: HTMLElement | null;
    /** The control's step among the tabbables of that line. */
    step: number;
    before: HTMLElement | null;
    after: HTMLElement | null;
  } | null>(null);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const stack = noticeStack.current;
      if (
        !(target instanceof HTMLElement) ||
        stack === null ||
        !stack.contains(target)
      ) {
        ringAnchor.current = null;
        return;
      }
      const line = noticeLineOf(target, stack);
      if (line === null) {
        ringAnchor.current = null;
        return;
      }
      const controls = focusable(line);
      const step = controls.indexOf(target);
      ringAnchor.current = {
        element: target,
        line,
        // A control outside every line is the desktop opt-in, and the place it
        // stands for is the front of the line the stack keeps last. Not its end:
        // the last control is the cross, which answers the Enter the reader gave
        // the offer by waving a notification they never aimed at.
        step: step < 0 ? 0 : step,
        before: adjacentNoticeLine(line, "previous"),
        after: adjacentNoticeLine(line, "next"),
      };
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  /**
   * Keys typed in the surface: Tab stays in the ring, and nothing else of the
   * key reaches the harness the overlay is built on.
   */
  const trapSurfaceKeys = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      trapKeys(event, ringRoots());
    },
    [ringRoots],
  );
  /**
   * Keys typed in the notice stack, where no ancestor `<main>` can hear them.
   *
   * Only the Tab this ring answers is taken; every other key is left to bubble
   * as the browser would carry it, so a dialog that listens on the window —
   * `QaModal`, and the settings dialog built on it — still hears the Escape the
   * reader gives it. A dialog is also why that Tab is left alone: the stack is
   * the dialog's neighbour rather than its content, so a ring closed around both
   * would take the reader out of the dialog they are working in and put them
   * back on a page held under the scrim.
   */
  const trapNoticeKeys = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Tab" || dialogOwnsKeyboard()) return;
      trapKeys(event, ringRoots());
    },
    [dialogOwnsKeyboard, ringRoots],
  );
  /** Turn marks of the visible transcript, kept in a ref for stable callbacks. */
  const railItemsRef = useRef<readonly QaTurnRailItem[]>([]);
  const activeTurnFrame = useRef<number | null>(null);
  const stateKey = qaStorageNamespace(config);
  // The palette belongs to the surface, so it is only painted while the
  // surface is what the visitor is looking at: outside its own route the
  // overlay is mounted and invisible, and flipping the Host document's
  // attributes from there would be the QA stand restyling the harness. What the
  // surface borrowed for the visit it hands back on the way out, for the same
  // reason — see `useQaThemePreference`.
  const theme = useQaThemePreference({
    active: route.active,
    storage: window.localStorage,
    storageKey: `${stateKey}:theme`,
  });
  const isAdmin =
    accountsSnapshot.stage === "authed" &&
    accountsSnapshot.user.role === "admin";
  // The preview belongs to the history entry that asked for it, so the
  // browser's own navigation is what enters and leaves it. Reading the marker
  // once, on mount, latched the mode for the whole tab: the entry's state
  // outlives the visit, the role selector — the one control that names the
  // profile in force — is hidden while previewing, and every later new chat in
  // that tab was therefore created as a preview of the previewed profile
  // instead of the account's default one, with nothing on screen saying so.
  const onPreviewRole = useCallback((roleId: string | null) => {
    if (roleId === null) return;
    setSessionPreview(false);
    setSelectedSubrole(roleId);
  }, []);
  const { preview, enter, clear, leave } = useQaAdminPreview({
    isAdmin,
    fallbackSubrole: access?.defaultSubrole ?? null,
    previewUrl: config.route.path,
    routeKey: route.pathname,
    onSelect: onPreviewRole,
  });
  const previewing = preview !== null;
  const widthHandlers = useQaContentWidth({
    active: route.active && !adminRoute,
    root: chat,
    storage: window.localStorage,
    storageKey: `${stateKey}:content-width`,
    minContentWidth: config.ui.minContentWidth,
  });

  useEffect(() => {
    if (accessPrincipal === null) {
      setAccess(undefined);
      setSelectedSubrole(null);
      clear();
      return;
    }
    let live = true;
    void props.accessApi.current(accounts?.token() ?? "").then((result) => {
      if (!live || !result.ok) return;
      setAccess(result.value);
      setSelectedSubrole(result.value.defaultSubrole);
    });
    return () => {
      live = false;
    };
  }, [accessPrincipal, accounts, props.accessApi, clear]);

  /**
   * Leave the preview for the account's own default profile.
   *
   * The previewed chat is not deleted — it stays in the history — but the role
   * cannot change inside a running conversation, so the way out is a new chat,
   * exactly as switching roles from the header is.
   */
  const exitPreview = useCallback(() => {
    leave();
    setSessionPreview(false);
    const fallback = access?.defaultSubrole ?? null;
    if (fallback !== null) void controller?.selectSubrole(fallback, false);
  }, [access, controller, leave]);

  useEffect(() => {
    if (!route.active || adminRoute) {
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
    if (accountsEnabled && access === undefined) {
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
      ...(props.slashApi === undefined ? {} : { slashApi: props.slashApi }),
      ...(props.queueStatus === undefined
        ? {}
        : { queueStatus: props.queueStatus }),
      config,
      initialSubrole: selectedSubrole,
      adminPreview: previewing,
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
    access,
    previewing,
    adminRoute,
    config,
    props.api,
    props.conversation,
    props.connection,
    props.createSession,
    props.fileUpload,
    props.approvalApi,
    props.questionApi,
    props.queueStatus,
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
      listWorkspaceFiles: (sessionId: string, path: string) =>
        props.sourceApi.listWorkspaceFiles(
          accounts?.token() ?? "",
          sessionId,
          path,
        ),
      readWorkspaceFile: (sessionId: string, path: string) =>
        props.sourceApi.readWorkspaceFile(
          accounts?.token() ?? "",
          sessionId,
          path,
        ),
      previewWorkspaceDocument: (sessionId: string, path: string) =>
        props.sourceApi.previewWorkspaceDocument(
          accounts?.token() ?? "",
          sessionId,
          path,
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
  useEffect(() => {
    if (
      state.sessionId === null ||
      accountsSnapshot.stage !== "authed" ||
      adminRoute
    ) {
      setSessionRole(undefined);
      return;
    }
    let live = true;
    void props.accessApi
      .session(accounts?.token() ?? "", state.sessionId)
      .then((result) => {
        if (!live || !result.ok) return;
        setSessionRole(result.value.subrole);
        setSessionPreview(result.value.adminPreview);
        if (result.value.adminPreview) return;
        // An ordinary chat is not a preview. Opening one leaves the mode the
        // history entry may still carry, so the next new chat starts under the
        // account's default profile rather than the previewed one.
        clear();
        if (access?.subroles.some(({ id }) => id === result.value.subrole.id)) {
          setSelectedSubrole(result.value.subrole.id);
        }
      });
    return () => {
      live = false;
    };
  }, [
    access,
    accounts,
    accountsSnapshot.stage,
    adminRoute,
    clear,
    props.accessApi,
    state.sessionId,
  ]);
  const listState = useSyncExternalStore(
    props.sessions.list.subscribe,
    props.sessions.list.getSnapshot,
    props.sessions.list.getSnapshot,
  );
  // Draft text, attachments, variant offsets and drawers are chat-local; the
  // hook clears them whenever the chat changes. The rail controller takes the
  // drawer slice; the surface keeps the composer and marks state.
  const ui = useSessionUiState(state.chatKey);
  const rail = useRightRail(ui);
  const {
    activeTurn,
    setActiveTurn,
    variantOffsets,
    setVariantOffsets,
    agentsOpen,
    setAgentsOpen,
    setRailOpen,
    setRailTab,
    pendingAttachments,
    setPendingAttachments,
  } = ui;

  /**
   * The file a card asked to open, with the chat it was asked in and the stamp
   * of the request. The chat is part of the arrival because the rail survives
   * switching chats: an arrival from the previous chat must not open its file
   * in this one. The stamp makes a second click on the same card a fresh
   * arrival rather than a path that never changed.
   */
  const [artifactArrival, setArtifactArrival] = useState<{
    readonly path: string;
    readonly chatKey: number;
    readonly stamp: number;
  } | null>(null);
  /** Counts the open requests, so the same file twice is two arrivals. */
  const artifactStamp = useRef(0);

  useEffect(() => {
    if (!route.active) return;
    // Body ownership (the shell-mask attribute, scroll locking) lives in the
    // guard above this surface: it must survive a crash that unmounts this
    // subtree.
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("#dsh-qa-prompt")?.focus();
    });
    return () => cancelAnimationFrame(frame);
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

  // The phone layout's history drawer. Its state is the surface's, not the
  // sidebar's, because the control that opens it stands in the header: the narrow
  // sheet switches the whole sidebar subtree off, and an opener inside it is no
  // opener at all. The sidebar keeps its own collapsed rail, which is a
  // wide-layout choice and a different thing — a phone that opens the drawer gets
  // the list whatever that rail remembers.
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = useCallback(() => setHistoryOpen((open) => !open), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  // The audit dialog's target, not its state: opening it is a view choice, and
  // closing it must not disturb the chat underneath.
  const [auditTarget, setAuditTarget] = useState<string | null>(null);
  const openAudit = useCallback((sessionId: string) => {
    setAuditTarget(sessionId);
  }, []);
  const closeAudit = useCallback(() => setAuditTarget(null), []);
  const handleDelete = useCallback(
    (sessionId: string) => {
      void controller?.deleteChat(sessionId);
    },
    [controller],
  );
  const handleSend = useCallback(
    (
      text: string,
      attachments: readonly QaAttachmentDraft[],
      pick: string | null,
    ) => controller?.send(text, attachments, pick) ?? Promise.resolve(false),
    [controller],
  );
  // Closing the queue notice only uncovers the composer: the question the stand
  // had no room for is still the text in there, and asking it again is a
  // keystroke the visitor takes when a place frees up.
  const dismissRequestQueue = useCallback(
    () => controller?.dismissRequestQueueNotice(),
    [controller],
  );
  // Cheap refresh on every palette opening: the skill registry has no browser
  // change event, and the controller skips the round-trip while its answer is
  // still fresh.
  const handleSlashOpen = useCallback(() => {
    void controller?.refreshSlashCatalog();
  }, [controller]);
  const handleStop = useCallback(
    () => controller?.stop() ?? Promise.resolve(),
    [controller],
  );
  const handleQueueEdit = useCallback(
    (id: string, text: string) =>
      controller?.queueAction(id, "edit", text) ?? Promise.resolve(null),
    [controller],
  );
  const handleQueueSendNow = useCallback(
    (id: string) =>
      controller?.queueAction(id, "steer") ?? Promise.resolve(null),
    [controller],
  );
  const handleQueueRemove = useCallback(
    (id: string) =>
      controller?.queueAction(id, "remove") ?? Promise.resolve(null),
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
  /**
   * A produced file the reader wants to see: open the rail on its workspace
   * viewer at exactly that file. The viewer is the panel's own — it reads under
   * the chat's fence and converts a Word document into a preview — so a card
   * under an answer points at that work instead of carrying a second viewer
   * that could disagree with it.
   */
  const handleArtifactOpen = useCallback(
    (artifact: QaArtifactView) => {
      artifactStamp.current += 1;
      setArtifactArrival({
        path: artifact.path,
        chatKey: state.chatKey,
        stamp: artifactStamp.current,
      });
      setAgentsOpen(false);
      setRailOpen(true);
      setRailTab("files");
    },
    // The three setters never change identity, and the chat key is the only
    // value the arrival carries: the callback stays stable across the frames of
    // one chat, which is what keeps the memoized transcript rows from
    // re-rendering on every published state.
    [setAgentsOpen, setRailOpen, setRailTab, state.chatKey],
  );
  /**
   * A produced file the reader wants to keep: the same fenced read the panel
   * uses, handed to the browser's download machinery. A read that fails opens
   * the viewer instead, which reports the refusal rather than swallowing the
   * click.
   */
  const handleArtifactDownload = useCallback(
    (artifact: QaArtifactView) => {
      const sessionId = state.sessionId;
      if (sessionId === null) return;
      boundSourceApi.readWorkspaceFile(sessionId, artifact.path).then(
        (result) => {
          if (result.ok) {
            downloadWorkspaceFile(result.value);
            return;
          }
          handleArtifactOpen(artifact);
        },
        () => handleArtifactOpen(artifact),
      );
    },
    [boundSourceApi, handleArtifactOpen, state.sessionId],
  );

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
  // The files tab opens on either half of its content: the chat's attachments
  // or the chat's own workspace, which only the file-reading switch can permit.
  const filesEnabled =
    attachmentCount > 0 ||
    (state.sessionId !== null && config.sources.filePreview.enabled);
  // A card may promise an action only when the Host will answer it: the same
  // switch the workspace reads are refused under. Where it is off, a produced
  // file still shows as a name and a size, which is the half the reader needs
  // to know the answer produced something.
  const workspaceReadable =
    state.sessionId !== null && config.sources.filePreview.enabled;
  // Buttons above an empty composer: the account's own starters, then the
  // deployment's suggestions unless the account hid them. Anonymous visitors
  // (and deployments with the feature off) see the deployment list alone.
  const quickQuestions = useMemo(
    () =>
      effectiveQuickQuestions(
        config.accounts.starters.enabled && accountsSnapshot.stage === "authed"
          ? accountsSnapshot.user.starters
          : undefined,
        config.suggestedQuestions,
      ),
    [config, accountsSnapshot],
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
  // The integration-token section is memoized on its own: the page loads the
  // list when it mounts, and a new object on every account snapshot change
  // would make it reload the list under the reader.
  const integrationTokens = useMemo(
    (): QaIntegrationTokenApi | undefined =>
      accounts === undefined
        ? undefined
        : {
            // The API the credential is for is what makes minting meaningful;
            // listing and revoking stay available either way, because a
            // credential that already exists has to remain revocable.
            canCreate: config.integration.enabled,
            list: () => accounts.serviceTokens(),
            create: (input) => accounts.createServiceToken(input),
            revoke: (tokenId) => accounts.revokeServiceToken(tokenId),
          },
    [accounts, config.integration.enabled],
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
    // Not gated by a config key: changing your own password is the one
    // account action that must never be switched off, since a deployment
    // without it has no way back in short of an operator.
    const password = {
      onChange: (currentPassword: string, nextPassword: string) =>
        accounts.changePassword(currentPassword, nextPassword),
    };
    const starters = config.accounts.starters.enabled
      ? {
          starters: accountsSnapshot.user.starters,
          onSave: (input: QaAccountStartersInput) =>
            accounts.updateStarters(input),
        }
      : undefined;
    // One object serves both halves of the same decision: the form that edits
    // it and the notices that obey it. A reader cannot be looking at one and
    // waiting on the other, and a memo keeps the identity stable for the
    // watcher that reads the channels out of it.
    const notifications = {
      notifications: accountsSnapshot.user.notifications,
      switches: config.notifications,
      onSave: (input: QaAccountNotificationsInput) =>
        accounts.updateNotifications(input),
    };
    const skills =
      config.accounts.skills.enabled && boundSkillApi !== undefined
        ? boundSkillApi
        : undefined;
    return {
      profile,
      password,
      starters,
      notifications,
      skills,
      integrationTokens,
    };
  }, [accounts, accountsSnapshot, config, boundSkillApi, integrationTokens]);
  const busyTurn =
    state.phase === "running" ? (railItems.at(-1)?.turn ?? null) : null;
  // Projected even while the sidebar is hidden: the account settings report
  // the same chat count, and one projection cannot disagree with itself.
  const chatRows = useMemo(
    () =>
      buildChatRows(
        controller?.chatIds() ?? [],
        listState.byId,
        activeSessionId,
        (id) => ownerNames?.get(id),
      ),
    [controller, listState, activeSessionId, ownerNames, state.chatsRevision],
  );
  // A turn that ends in one of this browser's own chats gets a notice: the
  // sidebar dot going out is otherwise the only sign, and it is easy to miss
  // from behind another window. The account's own list, not the sidebar's, is
  // what bounds it: an admin's shared history is a wider read than ownership,
  // and another account's turn is not this reader's news.
  const turnNotices = useQaTurnNotifications({
    chats: chatRows,
    ownChatIds:
      accountsSnapshot.stage === "authed" ? accountsSnapshot.ownIds : undefined,
    notifications: config.notifications,
    storage: window.localStorage,
    storageKey: `${stateKey}:notifications`,
    // Signed in, the account's own channels decide and the settings form is
    // what writes them; anonymously, the hook falls back to this browser.
    account: settingsDialog?.notifications,
    paused: state.phase === "reconnecting",
    activeSessionId,
    onSwitch: handleSwitch,
  });
  /**
   * A line leaving the stack takes the control the reader was working out of the
   * page, and a page with nothing focused answers Tab with the browser's own
   * order — which leaves the QA interface. Most of the ways a line goes leave
   * the stack standing and its count of lines where it was: waving one of the
   * three off, a fourth turn pushing the oldest out of a full stack, the opt-in
   * going away once the browser has answered the permission question. So the
   * loss is read where it happens — the control the ring held is out of the page
   * and nothing of the ring holds the focus — and the reader is handed to the
   * line that took the lost one's place, on the same control of it: a cross
   * given back as a cross. The anchor goes only with the focus it hands back: a
   * page takes the focus out of a removed control on its own moment, not in step
   * with this render. A dialog that holds the keyboard is not the ring's
   * business, and is left to put the focus wherever it thinks the reader
   * belongs.
   *
   * A page the reader is not looking at keeps its keyboard where it is: while
   * `document.hasFocus()` is false nothing here is moved. The hand-off is owed
   * rather than skipped — the anchor stands until the window comes back, and the
   * `focus` event of this page is what pays it — because the reader who returns
   * to a stack that dropped a line under them is exactly the reader this place
   * was remembered for, while a control of a page no one is looking at has no
   * claim on the keyboard of the page they are working in.
   *
   * Opening a chat from a line is the one path where a line goes and the chat
   * changes in the same moment. The keyboard stays on the stack — on a
   * neighbouring line, or back inside `<main>` once none is left — rather than
   * following the switch: the composer the switch remounts is disabled while the
   * chat is still being bound, so it can take no focus, and the surface moves
   * the keyboard on a switch no further than it does anywhere else.
   */
  const restoreRingFocus = useCallback(() => {
    const anchor = ringAnchor.current;
    if (anchor === null || anchor.element.isConnected) return;
    if (dialogOwnsKeyboard()) {
      ringAnchor.current = null;
      return;
    }
    if (!document.hasFocus()) return;
    const ring = focusRing(ringRoots());
    const active = document.activeElement;
    if (active !== null && ring.includes(active as HTMLElement)) return;
    ringAnchor.current = null;
    // The line itself first, for a control that left while its line stayed:
    // then whichever neighbour is still on screen, the one after the reader
    // taking the place the stack still lists in that order.
    const candidates: (HTMLElement | undefined)[] = [];
    for (const line of [anchor.line, anchor.after, anchor.before]) {
      if (line === null || !line.isConnected) continue;
      const controls = focusable(line);
      candidates.push(controls[Math.min(anchor.step, controls.length - 1)]);
    }
    // The stack has no line left to stand on: back into the interface, onto the
    // control the ring reaches last, and past the first candidate of it that
    // refuses the keyboard.
    candidates.push(...[...ring].reverse(), surface.current ?? undefined);
    focusFirst(candidates);
  }, [dialogOwnsKeyboard, ringRoots]);
  useEffect(() => {
    restoreRingFocus();
  });
  useEffect(() => {
    // The hand-off a blurred page owed, read again at the moment the reader
    // comes back: whoever holds the keyboard then keeps it, and a control of the
    // ring they reached on their own is not taken away from them.
    const onWindowFocus = (): void => restoreRingFocus();
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [restoreRingFocus]);

  // The audit provider is optional: `auditSnapshot.api` is null until the
  // audit plugin's client bundle is loaded, and the badge is absent until
  // then. Chat ids rather than rows feed the poll, so a re-render does not
  // restart it.
  const auditSnapshot = useSyncExternalStore(
    props.audit.subscribe,
    props.audit.getSnapshot,
  );
  const chatAudits = useChatAudits(
    auditSnapshot.api,
    useMemo(() => chatRows.map((row) => row.id), [chatRows]),
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
          onArtifactOpen={workspaceReadable ? handleArtifactOpen : undefined}
          onArtifactDownload={
            workspaceReadable ? handleArtifactDownload : undefined
          }
          openArtifact={
            artifactArrival !== null &&
            artifactArrival.chatKey === state.chatKey
              ? { path: artifactArrival.path, stamp: artifactArrival.stamp }
              : undefined
          }
          sessionId={state.sessionId ?? undefined}
          api={boundSourceApi}
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
            className={QA_SURFACE_CLASS}
            data-testid="qa-surface-loading"
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

  // The console admits administrators and reviewers: a reviewer answers
  // conversations, and the Host re-checks every permission it serves.
  const consoleRole =
    accountsSnapshot.stage === "authed" &&
    (accountsSnapshot.user.role === "admin" ||
      accountsSnapshot.user.role === "reviewer")
      ? accountsSnapshot.user.role
      : undefined;
  /**
   * Persist a rating of one answer. The control is offered only where the
   * rating can be stored: an accounts-enabled deployment, an authenticated
   * owner, and an answer whose log position the Host knows.
   */
  const rateFeedback =
    props.adminApi === undefined ||
    accounts === undefined ||
    accountsStage !== "authed" ||
    state.sessionId === null
      ? undefined
      : (input: {
          readonly messageId?: number;
          readonly rating: "positive" | "negative";
          readonly reasons?: readonly QaFeedbackReason[];
          readonly comment?: string;
        }) => {
          if (input.messageId === undefined) return;
          const conversationId = state.sessionId;
          const token = accounts.token();
          if (conversationId === null || token === null) return;
          void props
            .adminApi!.rateMessage(
              token,
              conversationId,
              String(input.messageId),
              {
                rating: input.rating,
                ...(input.reasons === undefined
                  ? {}
                  : { reasons: input.reasons }),
                ...(input.comment === undefined
                  ? {}
                  : { comment: input.comment }),
              },
            )
            .then((result) => {
              if (!result.ok) {
                // The rating stays local when the Host refuses it; the console
                // still shows the user's own choice for this browser.
                console.warn(
                  "QA feedback was not stored:",
                  result.error ?? "unknown",
                );
              }
            });
        };

  if (adminRoute && consoleRole !== undefined) {
    return (
      <QaAdmin
        api={props.accessApi}
        {...(props.adminApi === undefined ? {} : { adminApi: props.adminApi })}
        role={consoleRole}
        token={accounts?.token() ?? ""}
        routePath={config.route.path}
        onPreview={(role) => {
          // The entry carries the preview, so the browser's Back button leaves
          // it and the mode cannot outlive the entry that asked for it.
          enter(role);
        }}
      />
    );
  }
  if (adminRoute) {
    return (
      <main
        className="dsh-qa-admin"
        data-testid="qa-surface-admin-denied"
        aria-label="Администрирование QA"
      >
        <div className="dsh-qa-admin__loading">
          <p>Этот раздел доступен только администратору.</p>
          <button
            type="button"
            data-testid="qa-surface-admin-return"
            onClick={() =>
              window.history.pushState(null, "", config.route.path)
            }
          >
            Вернуться в чат
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      {welcomeNotice}
      <QaTurnNotice
        items={turnNotices.items}
        onOpen={turnNotices.onOpen}
        onDismiss={turnNotices.onDismiss}
        rootRef={noticeStack}
        onKeyDown={trapNoticeKeys}
        {...(turnNotices.onEnableDesktop === undefined
          ? {}
          : { onEnableDesktop: turnNotices.onEnableDesktop })}
      />
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
          chatCount={chatRows.length}
          onClose={() => setSettingsOpen(false)}
          extensions={props.settingsSections}
          token={accounts?.token() ?? ""}
          {...(settingsDialog.profile === undefined
            ? {}
            : { profile: settingsDialog.profile })}
          {...(settingsDialog.password === undefined
            ? {}
            : { password: settingsDialog.password })}
          {...(settingsDialog.starters === undefined
            ? {}
            : { starters: settingsDialog.starters })}
          notifications={settingsDialog.notifications}
          {...(settingsDialog.integrationTokens === undefined
            ? {}
            : { integrationTokens: settingsDialog.integrationTokens })}
          {...(settingsDialog.skills === undefined
            ? {}
            : { skills: settingsDialog.skills })}
        />
      )}
      <main
        ref={surface}
        className={QA_SURFACE_CLASS}
        data-testid="qa-surface-root"
        data-phase={state.phase}
        aria-label={config.branding.title}
        tabIndex={-1}
        onKeyDown={trapSurfaceKeys}
      >
        {previewing || sessionPreview ? (
          <QaAdminPreviewBanner
            role={
              preview?.name ??
              sessionRole?.name ??
              sessionRole?.id ??
              selectedSubrole ??
              ""
            }
            {...(previewing ? { onExit: exitPreview } : {})}
            disabled={state.phase === "creating"}
          />
        ) : null}
        {showSidebar && historyOpen ? (
          // The tap-outside half of the drawer, painted beside it rather than
          // inside it: the sheet switches the sidebar subtree off when the drawer
          // is closed, and a dismiss layer under that switch could not be clicked
          // in the one state where it is on screen.
          <div
            className="dsh-qa-sidebar__scrim"
            data-testid="qa-surface-sidebar-scrim"
            aria-hidden="true"
            onClick={closeHistory}
          />
        ) : null}
        {showSidebar ? (
          <QaSidebar
            rows={chatRows}
            groupByOwner={ownerNames !== undefined}
            title={config.branding.title}
            logoUrl={config.branding.logoUrl}
            stateKey={stateKey}
            showNewChat={allowNewChat}
            busy={state.phase === "creating"}
            drawerOpen={historyOpen}
            onDrawerClose={closeHistory}
            onSwitch={handleSwitch}
            onNewChat={handleNewChat}
            onDelete={handleDelete}
            audits={chatAudits}
            {...(auditSnapshot.api === null ? {} : { onAudit: openAudit })}
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
        <QaAuditDialog
          open={auditTarget !== null}
          sessionId={auditTarget}
          title="Аудит чата"
          api={auditSnapshot.api}
          summary={
            auditTarget === null ? undefined : chatAudits.get(auditTarget)
          }
          onClose={closeAudit}
        />
        <div className="dsh-qa-body" data-testid="qa-surface-body">
          {state.viewingSubagent !== null && !config.ui.showHeader ? (
            <QaSubagentBanner onClose={handleCloseSubagent} />
          ) : null}
          {config.ui.showHeader ? (
            <QaHeader
              logoUrl={config.branding.logoUrl}
              title={conversationTitle}
              onBackToChat={
                rail.railOpen || agentsOpen
                  ? () => {
                      rail.close();
                      setAgentsOpen(false);
                    }
                  : undefined
              }
              viewingSubagent={state.viewingSubagent !== null}
              onCloseSubagent={handleCloseSubagent}
              roleSelector={
                access === undefined ||
                selectedSubrole === null ||
                previewing ? undefined : (
                  <QaRoleSelector
                    roles={access.subroles}
                    selected={selectedSubrole}
                    conversationStarted={!empty}
                    disabled={
                      config.session.policy === "fixed" ||
                      state.phase === "creating" ||
                      state.phase === "running"
                    }
                    onSelect={(id) => {
                      window.history.replaceState(
                        null,
                        "",
                        window.location.pathname,
                      );
                      clear();
                      setSessionPreview(false);
                      setSelectedSubrole(id);
                      setSessionRole(
                        access.subroles.find((role) => role.id === id),
                      );
                      void controller?.selectSubrole(id, false);
                    }}
                  />
                )
              }
              themeSwitcher={
                <QaThemeSwitcher
                  preference={theme.preference}
                  onSelect={theme.select}
                />
              }
              administration={
                accountsSnapshot.stage === "authed" &&
                accountsSnapshot.user.role === "admin"
                  ? {
                      onOpen: () =>
                        window.history.pushState(
                          null,
                          "",
                          `${config.route.path === "/" ? "" : config.route.path}/admin`,
                        ),
                    }
                  : undefined
              }
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
              filesEnabled={filesEnabled}
              filesOpen={rail.railOpen && rail.railTab === "files"}
              onOpenFiles={() => rail.openTab("files")}
              panelLauncher={<QaPanelLauncher panels={props.panels} />}
              // The narrow layout switches the sidebar off, so the history is
              // opened from here — and only where there is a sidebar to open.
              history={
                showSidebar
                  ? { open: historyOpen, onToggle: toggleHistory }
                  : undefined
              }
              // The sidebar carries this entry next to the account name, so
              // the header takes it over exactly when there is no sidebar.
              settings={showSidebar ? undefined : settingsEntry}
              showReset={showResetButton}
              resetDisabled={
                controller === undefined || state.phase === "creating"
              }
              onReset={handleNewChat}
            />
          ) : null}

          <div
            className="dsh-qa-workspace"
            data-testid="qa-surface-workspace-split"
          >
            <div
              ref={chat}
              className="dsh-qa-chat"
              data-testid="qa-surface-chat"
              style={
                {
                  "--dsh-qa-content-width": `${config.ui.minContentWidth}px`,
                } as CSSProperties
              }
            >
              <div
                ref={transcript}
                className="dsh-qa-transcript"
                data-testid="qa-surface-transcript"
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
                      data-testid="qa-surface-transcript-welcome"
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
                            onArtifactOpen={
                              workspaceReadable ? handleArtifactOpen : undefined
                            }
                            onArtifactDownload={
                              workspaceReadable
                                ? handleArtifactDownload
                                : undefined
                            }
                            onRateFeedback={rateFeedback}
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
                  {state.compatibilityReadOnly === true ? (
                    <div
                      className="dsh-qa-compatibility"
                      data-testid="qa-surface-compatibility"
                      role="status"
                    >
                      Этот чат создан при другой конфигурации стенда и открыт
                      только для чтения. История сохранена; чтобы продолжить
                      работу с текущими настройками, создайте новый чат.
                    </div>
                  ) : null}
                  {state.error === null ? null : (
                    <div
                      className="dsh-qa-error"
                      data-testid="qa-surface-error"
                      role="alert"
                    >
                      <span>{state.error}</span>
                      {state.phase === "error" ? (
                        <button
                          type="button"
                          data-testid="qa-surface-error-retry"
                          onClick={() => void controller?.ensureSession()}
                        >
                          Повторить
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <footer className="dsh-qa-footer" data-testid="qa-surface-footer">
                <div className="dsh-qa-footer__inner">
                  <QaApproval
                    approvals={state.approvals}
                    onAnswer={handleAnswerApproval}
                  />
                  <QaQuestions
                    questions={state.questions}
                    onAnswer={handleAnswerQuestion}
                    onCancel={handleCancelQuestion}
                    onStop={handleStop}
                    canStop={state.canStop}
                  />
                  {/* A parked question takes the composer's place: the operator
                  answers the tool call that is already waiting, and cannot open
                  a new turn beside it. The composer stays mounted behind the
                  takeover — its draft is chat-local component state — so it is
                  hidden rather than unmounted. */}
                  <div
                    className="dsh-qa-composer-slot"
                    data-testid="qa-surface-composer-slot"
                    hidden={state.questions.length > 0}
                  >
                    {/* Queued messages are not in the transcript yet, so this is
                    the only place they are on the screen at all. */}
                    <QaQueueDock
                      rows={state.queue}
                      running={state.phase === "running"}
                      canEdit={state.canEditQueue}
                      onEdit={handleQueueEdit}
                      onSendNow={handleQueueSendNow}
                      onRemove={handleQueueRemove}
                    />
                    {/* Keyed by chat: the composer's draft text is chat-local, so a
                    switch remounts it empty instead of carrying text across. The
                    identity is never reused — a controller rebuilt for another chat
                    hands out a new one — and a draft keeps its own identity while it
                    creates its session on the first prompt: that is the same chat, and
                    remounting here would drop the question the Host has not admitted
                    yet. */}
                    <QaComposer
                      key={state.chatKey}
                      placeholder={config.branding.placeholder}
                      quickQuestions={empty ? quickQuestions : NO_QUESTIONS}
                      canSend={state.canSend}
                      canStop={state.canStop}
                      running={state.phase === "running"}
                      showStop={config.ui.showStop}
                      status={status}
                      attachments={pendingAttachments}
                      limits={limits}
                      slash={state.slash}
                      slashPolicy={config.slashCommands.palette}
                      onAttachmentsChange={setPendingAttachments}
                      onSend={handleSend}
                      onSlashOpen={handleSlashOpen}
                      onStop={handleStop}
                    />
                  </div>
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
            <QaPanelHost
              panels={props.panels}
              sessionId={state.sessionId}
              qaToken={accounts?.token() ?? ""}
              renderSlot={props.renderSlot}
            />
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
        <QaRequestQueue
          status={state.requestQueue}
          onClose={dismissRequestQueue}
        />
      </main>
    </>
  );
}
