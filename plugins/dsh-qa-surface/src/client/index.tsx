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
import { QaConfigController } from "./QaConfigController.js";
import { QaRouteController } from "./QaRouteController.js";
import { QaAccountsController } from "./QaAccountsController.js";
import { QaChatIndex } from "./chat-index.js";
import { QaSurface } from "./QaSurface.js";
import type {
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaSourceApi,
} from "./types.js";
import { QA_SURFACE_STYLES } from "./styles.js";
import type {
  QaAccountSession,
  QaClaimResult,
  QaLockdownProof,
  QaOwnershipEntry,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
  QaWhoamiResult,
} from "../types.js";

const SETTINGS_NAMESPACE = "qa-surface";

declare module "@deepseek-ai/cordis" {
  interface Context {
    connection: ConnectionHandle;
  }
}

interface QaPolicyRemote {
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
  accountsWhoami(token: string): Promise<RemoteResult<QaWhoamiResult>>;
  accountsLogin(
    email: string,
    password: string,
  ): Promise<RemoteResult<QaAccountSession>>;
  accountsRegister(
    email: string,
    password: string,
    displayName?: string,
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
}

/** The assembled Client Remote plus this plugin's own qaSurface namespace. */
type QaClientRemote = ClientRemote & { readonly qaSurface: QaPolicyRemote };

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
        policyRemote.secureSession(token, sessionId);
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
            `${snapshot.session.storageKey}:v1:${snapshot.route.path}`,
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
            `${snapshot.session.storageKey}:v1:${snapshot.route.path}`,
          ).forgetChat(sessionId);
        },
      });
      const route = new QaRouteController();
      const config = new QaConfigController(
        (ctx.settingsScope as SettingsScopeBinder).bind<QaSurfaceConfig>({
          namespace: SETTINGS_NAMESPACE,
        }),
        async () => {
          // Settings RPCs are loopback-pinned by the gateway, so a browser the
          // Host serves over the LAN reads the effective configuration here.
          const described = await policyRemote.describe();
          if (!described.ok) {
            throw new Error(
              `qaSurface/describe failed: ${described.error.code}`,
            );
          }
          // The generated self-remote resolves through the previous build's
          // declarations during an incremental source typecheck.
          return described.value as unknown as ResolvedQaSurfaceConfig;
        },
      );
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
            inject: () => ({
              route,
              config,
              // The host dsh-session merge types ctx.sessions as SessionStore in
              // this program; the client assembly provides the ISessions face.
              sessions: ctx.sessions as unknown as QaSessions,
              conversation: ctx.uiConversation,
              api: qaApi,
              connection: ctx.connection.generation,
              secureSession,
              sourceApi,
              accounts,
            }),
          },
          QaSurface,
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
