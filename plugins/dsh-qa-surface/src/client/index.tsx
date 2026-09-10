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
import { QaSurface } from "./QaSurface.js";
import type { QaSecureSession, QaSessions, QaSessionsApi } from "./types.js";
import { QA_SURFACE_STYLES } from "./styles.js";
import type {
  QaLockdownProof,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
} from "../types.js";

const SETTINGS_NAMESPACE = "qa-surface";

declare module "@deepseek-ai/cordis" {
  interface Context {
    connection: ConnectionHandle;
  }
}

interface QaPolicyRemote {
  secureSession(sessionId: string): Promise<RemoteResult<QaLockdownProof>>;
  describe(): Promise<RemoteResult<ResolvedQaSurfaceConfig>>;
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
  await ctx.inject(["remote.qaSurface"], (remoteContext) => {
    const policyRemote = (remoteContext.remote as QaClientRemote).qaSurface;
    const secureSession: QaSecureSession = (sessionId) =>
      policyRemote.secureSession(sessionId);
    const qaApi: QaSessionsApi = {
      selectModel: (request) => ctx.remote.session.selectModel(request),
      selectAgentPreset: (agentId, agentPreset) =>
        ctx.remote.agentPresets.select(agentId, agentPreset),
    };
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
          throw new Error(`qaSurface/describe failed: ${described.error.code}`);
        }
        return described.value;
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
      if (connected && !connectionUp) config.refreshFallback();
      connectionUp = connected;
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
          }),
        },
        QaSurface,
      ),
    );
  });
  return disposeRemote;
}

export { QaConfigController } from "./QaConfigController.js";
export { QaRouteController, matchesQaRoute } from "./QaRouteController.js";
export { QaSessionController } from "./QaSessionController.js";
export { projectTranscript } from "./QaTranscriptAdapter.js";
