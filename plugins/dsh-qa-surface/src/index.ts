import type {} from "@deepseek-ai/dsh-agent-presets";
import type {} from "@deepseek-ai/dsh-permission-presets";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-tools";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { ConfigSchema, resolveConfig } from "./config.js";
import { QaAttestationError } from "./attestation.js";
import { registerQaNavigationRoute } from "./host-route.js";
import { QaPolicyAdmission } from "./secure-session.js";
import type {
  QaLockdownProof,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
} from "./types.js";

export const name = "qa-surface";
export const inject = [
  "agents",
  "agentPresets",
  "permissionPresets",
  "tools",
  "workspaceRegistry",
];
export const QA_SURFACE_SETTINGS_NAMESPACE = "qa-surface";
export const Config = ConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaSurface: QaSurface;
  }
}

const CONFIGURATION_ERROR = "Assistant configuration is unavailable.";

/** Host companion: validates config, owns the admission boundary and the route. */
export class QaSurface extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  private source: () => QaSurfaceConfig;
  private readonly logger: PluginLogger;
  private readonly admission: QaPolicyAdmission;
  private webServer:
    Parameters<typeof registerQaNavigationRoute>[0] | undefined;
  private disposeRoute: (() => void) | undefined;
  private routeKey: string | undefined;

  constructor(ctx: Context, entry: QaSurfaceConfig = {}) {
    super(ctx, "qaSurface", { namespace: "qaSurface" });
    const resolvedEntry = resolveConfig(entry);
    this.source = () => resolvedEntry;
    this.logger = getPluginLogger({
      pluginId: "dsh-qa-surface",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    this.admission = new QaPolicyAdmission(
      ctx,
      () => this.getConfig(),
      this.logger,
    );
    ctx.effect(() => async () => this.logger.close(), "dsh-qa-surface.logger");
    ctx.effect(
      () => () => this.admission.dispose(),
      "dsh-qa-surface.lockdown-policies",
    );
    ctx.inject(["settings"], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        QA_SURFACE_SETTINGS_NAMESPACE,
        ConfigSchema,
        entry,
        {
          setSource: (source) => {
            this.source = source;
          },
          onChange: () => {
            const config = this.getConfig();
            this.refreshRoute();
            this.logger.info("config.updated", {
              enabled: config.enabled,
              route: config.route.path,
              sessionPolicy: config.session.policy,
            });
          },
          validate: (value) => {
            resolveConfig(value);
          },
        },
      );
    });
    ctx.inject(["webServer"], (webContext) => {
      this.webServer = webContext.webServer;
      this.refreshRoute();
      webContext.effect(
        () => () => {
          this.disposeRoute?.();
          this.disposeRoute = undefined;
          this.routeKey = undefined;
          this.webServer = undefined;
        },
        "dsh-qa-surface.navigation-route",
      );
    });
    this.logger.info("plugin.ready", {
      enabled: resolvedEntry.enabled,
      route: resolvedEntry.route.path,
      sessionPolicy: resolvedEntry.session.policy,
    });
  }

  getConfig(): ResolvedQaSurfaceConfig {
    return resolveConfig(this.source());
  }

  /**
   * Serve the effective QA configuration to the browser. The DSH gateway pins
   * settings RPCs to loopback, so a browser served over the LAN always sees
   * the settings namespace as unavailable; this method is the config channel
   * such a browser falls back to. It is read-only projection — the admission
   * boundary stays in {@link secureSession}.
   */
  @Remote("describe")
  describe(): ResolvedQaSurfaceConfig {
    return this.getConfig();
  }

  /** Pin and attest the effective policy. The browser supplies identity only. */
  @Remote("secureSession")
  secureSession(sessionId: string): QaLockdownProof {
    try {
      return this.admission.secureSession(sessionId);
    } catch (error) {
      // The carrier empties error.details, so the coarse reason rides the
      // wire message for the browser console; the specific mismatch facts
      // stay in this log only.
      const reason =
        error instanceof QaAttestationError
          ? error.reason
          : "attestation-failed";
      this.logger.error("lockdown.rejected", {
        sessionId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`${CONFIGURATION_ERROR} (reason: ${reason})`, {
        cause: error,
      });
    }
  }

  private refreshRoute(): void {
    const config = this.getConfig();
    const key = config.enabled
      ? `${config.route.path}:${config.route.matchChildren}`
      : undefined;
    if (key === this.routeKey) return;
    this.disposeRoute?.();
    this.disposeRoute = undefined;
    this.routeKey = undefined;
    if (key === undefined || this.webServer === undefined) return;
    this.disposeRoute = registerQaNavigationRoute(this.webServer, config);
    this.routeKey = key;
  }
}

export {
  ConfigSchema,
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "./config.js";
export { QaAttestationError } from "./attestation.js";
export type { QaAttestationReason } from "./attestation.js";
export { registerQaNavigationRoute } from "./host-route.js";
export { qaToolDenial, qaToolPolicyPlan } from "./lockdown-policy.js";
export { QaPolicyAdmission } from "./secure-session.js";
export * from "./provenance/index.js";
export type * from "./types.js";
export default QaSurface;
