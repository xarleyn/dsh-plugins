import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-agent-presets";
import type {} from "@deepseek-ai/dsh-permission-presets";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-tools";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { Context } from "@deepseek-ai/cordis";
import {
  installSettingsSection,
  settingsNamespace,
} from "@deepseek-ai/dsh-settings";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { ConfigSchema, resolveConfig } from "./config.js";
import { QaAttestationError } from "./attestation.js";
import { registerQaNavigationRoute } from "./host-route.js";
import { qaToolDenial, qaToolPolicyPlan } from "./lockdown-policy.js";
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
export const QA_SURFACE_SETTINGS_NAMESPACE = settingsNamespace("qa-surface");
export const Config = ConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaSurface: QaSurface;
  }
}

/** Small Host companion: validates config and exposes it through DSH settings. */
interface AppliedPolicy {
  readonly fingerprint: string;
  readonly disposeGuard: () => void;
  readonly disposeRestriction: () => void;
}

const CONFIGURATION_ERROR = "Assistant configuration is unavailable.";
const FRESH_SESSION_BOOTSTRAP_WINDOW_MS = 120_000;

/** Host companion and the only browser-callable QA policy admission boundary. */
export class QaSurface extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  private source: () => QaSurfaceConfig;
  private readonly logger: PluginLogger;
  private webServer:
    Parameters<typeof registerQaNavigationRoute>[0] | undefined;
  private disposeRoute: (() => void) | undefined;
  private routeKey: string | undefined;
  private readonly appliedPolicies = new Map<Agent, AppliedPolicy>();

  constructor(ctx: Context, entry: QaSurfaceConfig = {}) {
    super(ctx, "qaSurface", { namespace: "qaSurface" });
    const resolvedEntry = resolveConfig(entry);
    this.source = () => resolvedEntry;
    this.logger = getPluginLogger({
      pluginId: "dsh-qa-surface",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    ctx.effect(() => async () => this.logger.close(), "dsh-qa-surface.logger");
    ctx.effect(
      () => () => this.disposeAppliedPolicies(),
      "dsh-qa-surface.lockdown-policies",
    );
    ctx.on("agent/disposed", ({ agent }) => {
      this.appliedPolicies.delete(agent);
    });
    installSettingsSection(
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
      return this.secureSessionOrThrow(sessionId);
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

  private secureSessionOrThrow(sessionId: string): QaLockdownProof {
    const config = this.getConfig();
    const lockdown = config.lockdown;
    const agent = this.ctx.agents.get(SessionId(sessionId));
    if (agent === undefined) {
      throw new QaAttestationError("agent-unavailable", "agent is unavailable");
    }
    if (!lockdown.enabled) {
      return {
        sessionId,
        enabled: false,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxIsReadOnly: false,
        approvalIsNever: false,
        permissionPreset: "",
        toolPolicyLoaded: false,
        toolAllowList: [],
      };
    }

    const expectedPreset = config.session.agentPreset;
    const agentPresetMatches =
      !lockdown.enforceFixedAgentPreset ||
      expectedPreset === null ||
      this.ctx.agentPresets.composedPreset(agent.ctx) === expectedPreset;

    const expectedWorkspace = config.session.workspaceId;
    const workspace =
      expectedWorkspace === null
        ? undefined
        : this.ctx.workspaceRegistry.get(WorkspaceId(expectedWorkspace));
    const workspaceMatches =
      !lockdown.enforceFixedWorkspace ||
      expectedWorkspace === null ||
      (workspace !== undefined && agent.session.header.cwd === workspace.path);

    const options = agent.options as Agent["options"] & {
      readonly reasoningEffort?: string;
    };
    const modelMatches =
      !lockdown.enforceFixedModel ||
      config.session.provider === null ||
      (options.provider === config.session.provider &&
        options.model === config.session.model &&
        (config.session.reasoningEffort === null ||
          options.reasoningEffort === config.session.reasoningEffort));

    if (!agentPresetMatches || !workspaceMatches || !modelMatches) {
      throw new QaAttestationError(
        "composition-mismatch",
        `composition mismatch: agent=${agentPresetMatches} workspace=${workspaceMatches} model=${modelMatches}`,
      );
    }

    const permission = this.ctx.permissionPresets.resolve(
      lockdown.permissionPreset,
    );
    if (
      permission.sandbox !== lockdown.sandboxMode ||
      permission.approval !== lockdown.approvalPolicy
    ) {
      throw new QaAttestationError(
        "permission-preset",
        `permission preset ${lockdown.permissionPreset} does not resolve to read-only/never`,
      );
    }

    const currentPermission = this.ctx.permissionPresets.current(
      agent.session.events,
    );
    const hasUserHistory = agent.session.events.some(
      (event) => event.type === "user/message",
    );
    if (
      currentPermission !== lockdown.permissionPreset &&
      (hasUserHistory ||
        Date.now() - agent.session.header.createdAt >
          FRESH_SESSION_BOOTSTRAP_WINDOW_MS)
    ) {
      throw new QaAttestationError(
        "adoption-refused",
        "existing non-QA session cannot be adopted",
      );
    }

    const policy = qaToolPolicyPlan(
      lockdown.toolPolicy.allow,
      (toolName) => this.ctx.tools.get(toolName, agent) !== undefined,
    );
    if (policy.unknown.length > 0) {
      throw new QaAttestationError(
        "unknown-tools",
        `unknown QA tool(s): ${policy.unknown.join(", ")}`,
      );
    }
    const fingerprint = JSON.stringify(policy.allow);
    const prior = this.appliedPolicies.get(agent);
    if (prior?.fingerprint !== fingerprint) {
      const allowed = new Set(policy.allow);
      const disposeGuard = agent.ctx.tools.guard((execution) =>
        qaToolDenial(allowed, execution.name),
      );
      try {
        const disposeRestriction = agent.ctx.tools.restrict({
          allow: policy.allow,
        });
        this.appliedPolicies.set(agent, {
          fingerprint,
          disposeGuard,
          disposeRestriction,
        });
        prior?.disposeRestriction();
        prior?.disposeGuard();
      } catch (error) {
        disposeGuard();
        throw error;
      }
    }

    this.ctx.permissionPresets.set(agent.session, lockdown.permissionPreset);
    const effectivePermission = this.ctx.permissionPresets.current(
      agent.session.events,
    );
    const sandboxIsReadOnly = permission.sandbox === "read-only";
    const approvalIsNever = permission.approval === "never";
    if (
      effectivePermission !== lockdown.permissionPreset ||
      !sandboxIsReadOnly ||
      !approvalIsNever
    ) {
      throw new QaAttestationError(
        "attestation-failed",
        "permission attestation failed",
      );
    }

    this.logger.debug("lockdown.attested", {
      sessionId,
      permissionPreset: lockdown.permissionPreset,
      toolAllowList: policy.allow,
    });
    return {
      sessionId,
      enabled: true,
      agentPresetMatches,
      workspaceMatches,
      modelMatches,
      sandboxIsReadOnly,
      approvalIsNever,
      permissionPreset: lockdown.permissionPreset,
      toolPolicyLoaded: true,
      toolAllowList: policy.allow,
    };
  }

  private disposeAppliedPolicies(): void {
    for (const policy of this.appliedPolicies.values()) {
      policy.disposeRestriction();
      policy.disposeGuard();
    }
    this.appliedPolicies.clear();
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
export type * from "./types.js";
export default QaSurface;
