import type { Context } from "@deepseek-ai/cordis";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type { SettingsScopeBinder } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import qaSurfaceRemote from "@yadsh/dsh-qa-surface/remote";
import type { ClientRemote } from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote";
import type {} from "@deepseek-ai/dsh-agent-presets/remote";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";
import { QaConfigController } from "./QaConfigController.js";
import { matchesQaRoute, QaRouteController } from "./QaRouteController.js";
import { QaAccountsController } from "./QaAccountsController.js";
import { QaChatIndex } from "./chat-index.js";
import type { QaSurfaceFace } from "./QaSurface.js";
import { QaSurfaceGuard } from "./QaSurfaceGuard.js";
import { QaWelcomeNoticeStep } from "./components/QaWelcomeNotice.js";
import type {
  QaAccountsApi,
  QaApprovalApi,
  QaFileUpload,
  QaQuestionApi,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaSkillApi,
  QaSourceApi,
} from "./types.js";
import { QA_SURFACE_STYLES } from "./styles.js";
import type {
  QaAccountSession,
  QaApprovalDecision,
  QaQuestionAnswerItem,
  QaClaimResult,
  QaLockdownProof,
  QaOwnershipEntry,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillRemoval,
  QaSkillSummary,
  QaSkillToolDescriptor,
  QaSkillValidation,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
  QaWhoamiResult,
} from "../types.js";
import { QA_SURFACE_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { qaStorageNamespace } from "../shared/session-key.js";
import { QaSettingsCard, type QaSettingsCardFace } from "./settings/card.js";
import { QA_SETTINGS_STYLES } from "./settings/styles.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    connection: ConnectionHandle;
  }
}

// The namespace the Host registers under `qaSurface`: the session policy
// remotes this file calls directly, plus the account remotes the account
// controller drives. It mirrors what the typert declaration generates, so the
// client also type-checks from a checkout whose `lib/` has not been built yet.
interface QaPolicyRemote extends QaAccountsApi {
  createSession(token: string): Promise<RemoteResult<string>>;
  secureSession(
    token: string,
    sessionId: string,
  ): Promise<RemoteResult<QaLockdownProof>>;
  describe(): Promise<RemoteResult<ResolvedQaSurfaceConfig>>;
  sources(
    token: string,
    sessionId: string,
  ): QaSourceApi extends {
    sources(token: string, sessionId: string): infer Result;
  }
    ? Result
    : never;
  readSourceFile(
    token: string,
    sessionId: string,
    sourcePath: string,
  ): QaSourceApi extends {
    readSourceFile(
      token: string,
      sessionId: string,
      sourcePath: string,
    ): infer Result;
  }
    ? Result
    : never;
  pendingApprovals(
    token: string,
    sessionId: string,
  ): QaApprovalApi extends {
    pendingApprovals(token: string, sessionId: string): infer Result;
  }
    ? Result
    : never;
  pendingQuestions(
    token: string,
    sessionId: string,
  ): QaQuestionApi extends {
    pendingQuestions(token: string, sessionId: string): infer Result;
  }
    ? Result
    : never;
  answerQuestion(
    token: string,
    sessionId: string,
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ): QaQuestionApi extends {
    answerQuestion(
      token: string,
      sessionId: string,
      requestId: string,
      answers: readonly QaQuestionAnswerItem[],
    ): infer Result;
  }
    ? Result
    : never;
  cancelQuestion(
    token: string,
    sessionId: string,
    requestId: string,
  ): QaQuestionApi extends {
    cancelQuestion(
      token: string,
      sessionId: string,
      requestId: string,
    ): infer Result;
  }
    ? Result
    : never;
  answerApproval(
    token: string,
    sessionId: string,
    requestId: string,
    decision: QaApprovalDecision,
  ): QaApprovalApi extends {
    answerApproval(
      token: string,
      sessionId: string,
      requestId: string,
      decision: QaApprovalDecision,
    ): infer Result;
  }
    ? Result
    : never;
  accountsWhoami(token: string): Promise<RemoteResult<QaWhoamiResult>>;
  accountsLogin(
    email: string,
    password: string,
  ): Promise<RemoteResult<QaAccountSession>>;
  accountsRegister(
    email: string,
    password: string,
  ): Promise<RemoteResult<QaAccountSession>>;
  accountsClaimSessions(
    token: string,
    sessionIds: readonly string[],
  ): Promise<RemoteResult<QaClaimResult>>;
  accountsOwnedSessions(
    token: string,
  ): Promise<RemoteResult<{ readonly ids: readonly string[] }>>;
  accountsListOwnership(
    token: string,
  ): Promise<RemoteResult<{ readonly entries: readonly QaOwnershipEntry[] }>>;
  skillsList(
    token: string,
  ): Promise<RemoteResult<{ readonly skills: readonly QaSkillSummary[] }>>;
  skillsGet(
    token: string,
    name: string,
  ): Promise<RemoteResult<QaSkillDocument>>;
  skillsCreate(
    token: string,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillDocument>>;
  skillsUpdate(
    token: string,
    name: string,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillDocument>>;
  skillsRemove(
    token: string,
    name: string,
    expectedRevision: string | null,
  ): Promise<RemoteResult<QaSkillRemoval>>;
  skillsTools(
    token: string,
  ): Promise<
    RemoteResult<{ readonly tools: readonly QaSkillToolDescriptor[] }>
  >;
  skillsValidate(
    token: string,
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<RemoteResult<QaSkillValidation>>;
}

/** The assembled Client Remote plus this plugin's own qaSurface namespace. */
type QaClientRemote = ClientRemote & { readonly qaSurface: QaPolicyRemote };

const QA_WELCOME_SLOT_ID = "welcome-notice";

function qaWelcomeStorageKey(config: ResolvedQaSurfaceConfig): string {
  return `${qaStorageNamespace(config)}:welcome-notice`;
}

export const inject = [
  "slots",
  "sessions",
  "uiConversation",
  "connection",
  "settingsScope",
  "remote",
];

/** Register the route-aware, full-frame QA entry in the additive overlay slot. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as QaClientRemote;
  const disposeRemote = await remote.$mount(qaSurfaceRemote);
  await ctx.inject(
    ["remote.qaSurface", "remote.session", "remote.agentPresets"],
    (remoteContext) => {
      const injectedRemote = remoteContext.remote as QaClientRemote;
      const policyRemote = injectedRemote.qaSurface;
      const secureSession: QaSecureSession = (token, sessionId) =>
        policyRemote.secureSession(
          token,
          sessionId,
        ) as unknown as ReturnType<QaSecureSession>;
      const qaApi: QaSessionsApi = {
        selectModel: (request) => injectedRemote.session.selectModel(request),
        selectAgentPreset: (agentId, agentPreset) =>
          injectedRemote.agentPresets.select(agentId, agentPreset),
      };
      const sourceApi: QaSourceApi = {
        sources: (token, sessionId) =>
          policyRemote.sources(token, sessionId) as unknown as ReturnType<
            QaSourceApi["sources"]
          >,
        readSourceFile: (token, sessionId, sourcePath) =>
          policyRemote.readSourceFile(
            token,
            sessionId,
            sourcePath,
          ) as unknown as ReturnType<QaSourceApi["readSourceFile"]>,
      };
      const questionApi: QaQuestionApi = {
        pendingQuestions: (token, sessionId) =>
          policyRemote.pendingQuestions(
            token,
            sessionId,
          ) as unknown as ReturnType<QaQuestionApi["pendingQuestions"]>,
        answerQuestion: (token, sessionId, requestId, answers) =>
          policyRemote.answerQuestion(
            token,
            sessionId,
            requestId,
            answers,
          ) as unknown as ReturnType<QaQuestionApi["answerQuestion"]>,
        cancelQuestion: (token, sessionId, requestId) =>
          policyRemote.cancelQuestion(
            token,
            sessionId,
            requestId,
          ) as unknown as ReturnType<QaQuestionApi["cancelQuestion"]>,
      };
      // Personal skills: the token rides every call, and the Host answers with
      // the caller's own storage. The section simply does not exist on a page
      // whose deployment cannot host one.
      const skillApi: QaSkillApi = {
        skillsList: (token) => policyRemote.skillsList(token),
        skillsGet: (token, name) => policyRemote.skillsGet(token, name),
        skillsCreate: (token, input) => policyRemote.skillsCreate(token, input),
        skillsUpdate: (token, name, input) =>
          policyRemote.skillsUpdate(token, name, input),
        skillsRemove: (token, name, expectedRevision) =>
          policyRemote.skillsRemove(token, name, expectedRevision),
        skillsTools: (token) => policyRemote.skillsTools(token),
        skillsValidate: (token, name, input) =>
          policyRemote.skillsValidate(token, name, input),
      };
      const approvalApi: QaApprovalApi = {
        pendingApprovals: (token, sessionId) =>
          policyRemote.pendingApprovals(
            token,
            sessionId,
          ) as unknown as ReturnType<QaApprovalApi["pendingApprovals"]>,
        answerApproval: (token, sessionId, requestId, decision) =>
          policyRemote.answerApproval(
            token,
            sessionId,
            requestId,
            decision,
          ) as unknown as ReturnType<QaApprovalApi["answerApproval"]>,
      };
      // The account gate rides its own remote; a stale token simply answers
      // "not authenticated" and the browser shows the login card.
      const accounts = new QaAccountsController({
        remote: policyRemote,
        storage: window.localStorage,
        config: () => config.getSnapshot().config,
        legacyChatIds: () => {
          // A standalone index view over the same prefix: reads the chat ids
          // this browser accumulated before accounts existed.
          const snapshot = config.getSnapshot().config;
          const index = new QaChatIndex(
            window.localStorage,
            qaStorageNamespace(snapshot),
          );
          const ids = [...index.chatIds()];
          const active = index.activeId();
          if (active !== null && !ids.includes(active)) ids.push(active);
          return ids;
        },
        forgetChat: (sessionId) => {
          const snapshot = config.getSnapshot().config;
          new QaChatIndex(
            window.localStorage,
            qaStorageNamespace(snapshot),
          ).forgetChat(sessionId);
        },
      });
      const route = new QaRouteController();
      // One binding for both readers: the surface projects it into the page's
      // configuration, the settings card edits the same namespace through it.
      const settingsScope = (
        ctx.settingsScope as SettingsScopeBinder
      ).bind<QaSurfaceConfig>({
        namespace: QA_SURFACE_SETTINGS_NAMESPACE,
      });
      const config = new QaConfigController(settingsScope, async () => {
        // Settings RPCs are loopback-pinned by the gateway, so a browser the
        // Host serves over the LAN reads the effective configuration here.
        const described = await policyRemote.describe();
        if (!described.ok) {
          throw new Error(`qaSurface/describe failed: ${described.error.code}`);
        }
        // The generated self-remote resolves through the previous build's
        // declarations during an incremental source typecheck.
        return described.value as unknown as ResolvedQaSurfaceConfig;
      });
      // The operator edits this deployment through the shared plugin-cards
      // tab: the same namespace the page reads, plus the Host's own answer
      // about what it resolved. Its stylesheet is the card shell, not the QA
      // page's palette.
      ctx.effect(() => {
        const cardFace: QaSettingsCardFace = {
          scope: settingsScope,
          describe: () => policyRemote.describe(),
        };
        return registerSettingsCard(remoteContext, {
          key: QA_SURFACE_SETTINGS_NAMESPACE,
          pluginName: "@yadsh/dsh-qa-surface",
          styles: QA_SETTINGS_STYLES,
          component: QaSettingsCard,
          inject: () => cardFace,
        });
      }, "dsh-qa-surface: settings-card");
      const syncRoute = () => {
        const snapshot = config.getSnapshot();
        route.configure(
          snapshot.config,
          snapshot.status === "ready" || snapshot.status === "unavailable",
        );
      };
      syncRoute();
      const unsubscribeConfig = config.subscribe(syncRoute);
      // After a Host restart an open page must re-read the deployment config,
      // or the next attestation compares its proof against a stale copy and
      // refuses. Loopback pages follow the settings mirror; this covers the
      // describe fallback (LAN browsers). Fires on every lost→restored
      // connection transition; while connected, ticks are ignored.
      let connectionUp = ctx.connection.generation.getSnapshot() !== undefined;
      const unsubscribeConnection = ctx.connection.generation.subscribe(() => {
        const connected = ctx.connection.generation.getSnapshot() !== undefined;
        if (connected && !connectionUp) {
          config.refreshFallback();
          // A boot-time whoami may have raced the lost connection; the
          // controller no-ops unless it is still in the checking stage.
          void accounts.start();
        }
        connectionUp = connected;
      });
      void accounts.start();

      // The stock DSH welcome notice cannot persist its acknowledgement for
      // non-loopback browsers. Shadow only its list-slot cell while the QA
      // route is selected; leaving /qa immediately restores the host entry.
      ctx.slots.inject("settings.onboarding", () => {
        let removeEntry: (() => void) | undefined;
        let mountedKey: string | undefined;
        const reconcile = () => {
          const configSnapshot = config.getSnapshot().config;
          const routeSnapshot = route.getSnapshot();
          const active =
            configSnapshot.enabled &&
            matchesQaRoute(routeSnapshot.pathname, configSnapshot.route);
          const nextKey = active
            ? qaWelcomeStorageKey(configSnapshot)
            : undefined;
          if (nextKey === mountedKey) return;
          removeEntry?.();
          removeEntry = undefined;
          mountedKey = nextKey;
          if (nextKey === undefined) return;
          removeEntry = ctx.slots.register(
            {
              name: "settings.onboarding",
              id: QA_WELCOME_SLOT_ID,
              order: -100,
              priority: -1_000,
              inject: () => ({
                storage: window.localStorage,
                storageKey: nextKey,
              }),
            },
            QaWelcomeNoticeStep,
          );
        };
        reconcile();
        const unsubscribeRoute = route.subscribe(reconcile);
        const unsubscribeConfig = config.subscribe(reconcile);
        return () => {
          unsubscribeRoute();
          unsubscribeConfig();
          removeEntry?.();
        };
      });

      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.dshQaSurface = "styles";
        style.textContent = QA_SURFACE_STYLES;
        document.head.append(style);
        return () => style.remove();
      }, "dsh-qa-surface: styles");

      ctx.effect(
        () => () => {
          unsubscribeConfig();
          unsubscribeConnection();
          config.dispose();
          route.dispose();
        },
        "dsh-qa-surface: controllers",
      );

      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "dsh-qa-surface",
            order: -10_000,
            inject: (): QaSurfaceFace => {
              try {
                return {
                  route,
                  config,
                  // The host dsh-session merge types ctx.sessions as SessionStore in
                  // this program; the client assembly provides the ISessions face.
                  sessions: ctx.sessions as unknown as QaSessions,
                  conversation: ctx.uiConversation,
                  api: qaApi,
                  connection: ctx.connection.generation,
                  secureSession,
                  createSession: (token: string) =>
                    policyRemote.createSession(token),
                  sourceApi,
                  skillApi,
                  approvalApi,
                  questionApi,
                  accounts,
                  // The upload service is optional on the page: a deployment that
                  // does not serve it keeps images, and a staged file refuses the
                  // send with a message instead of losing the draft. Read through
                  // the untyped service lookup on purpose — the QA bundle does not
                  // link the upload package.
                  fileUpload: () =>
                    (
                      ctx as unknown as {
                        get(service: string): unknown;
                      }
                    ).get("fileUpload") as QaFileUpload | undefined,
                };
              } catch {
                // The face reads host services lazily (cordis service
                // visibility), so assembly can fail here. Hand the guard an
                // empty face: it renders the fullscreen failure card instead
                // of the entry crashing, which would retire the overlay and
                // uncover the host shell beneath it.
                return {} as QaSurfaceFace;
              }
            },
          },
          QaSurfaceGuard,
        ),
      );
    },
  );
  return disposeRemote;
}

export { QaConfigController } from "./QaConfigController.js";
export { QaAccountsController } from "./QaAccountsController.js";
export { QaRouteController, matchesQaRoute } from "./QaRouteController.js";
export { QaSessionController } from "./QaSessionController.js";
export { projectTranscript } from "./QaTranscriptAdapter.js";
