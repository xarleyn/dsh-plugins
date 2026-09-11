import type {} from "@deepseek-ai/dsh-agent-presets";
import type {} from "@deepseek-ai/dsh-permission-presets";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { ConfigSchema, resolveConfig } from "./config.js";
import {
  QaAccounts,
  QaAccountsError,
  defaultAccountsFilePath,
} from "./accounts/store.js";
import { QaAttestationError } from "./attestation.js";
import { entryRedirectRow } from "./entry-redirect.js";
import { registerQaNavigationRoute } from "./host-route.js";
import { QaPolicyAdmission } from "./secure-session.js";
import { QaProvenanceHost } from "./provenance/host-store.js";
import { readSourceFilePreview } from "./provenance/file-preview.js";
import type { QaTurnSources } from "./provenance/types.js";
import type {
  QaAccountSession,
  QaClaimResult,
  QaLockdownProof,
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
  QaSourceFilePreview,
  QaWhoamiResult,
} from "./types.js";

export const name = "qa-surface";
export const inject = [
  "agents",
  "sessions",
  "agentPresets",
  "permissionPresets",
  "tools",
  "systemPrompt",
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
const ACCOUNTS_DISABLED_ERROR =
  "QA accounts are not enabled on this deployment.";

/** The `(reason: <code>)` marker contract shared with the attestation path. */
const ACCOUNTS_REASON_MARKER = /\(reason: ([a-z-]+)\)/u;

/** Host companion: validates config, owns the admission boundary and the route. */
export class QaSurface extends TypertRemoteService {
  static inject = inject;
  static Config = ConfigSchema;

  private source: () => QaSurfaceConfig;
  private readonly logger: PluginLogger;
  private readonly admission: QaPolicyAdmission;
  private readonly provenance: QaProvenanceHost;
  private accounts: QaAccounts | undefined;
  private accountsOptions: string | undefined;
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
      // Identity half of admission; no-ops while accounts stay disabled.
      {
        enforceSessionAccess: (token, sessionId) => {
          this.accountsFor(this.getConfig())?.ensureSessionAccess(
            token,
            sessionId,
          );
        },
      },
    );
    this.provenance = new QaProvenanceHost(ctx, () => this.getConfig());
    ctx.effect(() => async () => this.logger.close(), "dsh-qa-surface.logger");
    ctx.effect(
      () => () => this.admission.dispose(),
      "dsh-qa-surface.lockdown-policies",
    );
    ctx.effect(
      () => () => this.provenance.dispose(),
      "dsh-qa-surface.provenance",
    );
    // The root index gains one head script: non-loopback hostnames continue
    // into /qa, the loopback operator keeps the full harness UI.
    ctx.on("webserver/index-inject", (table) => {
      const row = entryRedirectRow(this.getConfig());
      if (row !== undefined) table.push(row);
    });
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
   * The accounts store behind the runtime toggle. Rebuilt only when the
   * account-affecting options change; the file is shared across rebuilds.
   */
  private accountsFor(config: ResolvedQaSurfaceConfig): QaAccounts | undefined {
    if (!config.accounts.enabled) return undefined;
    const options = JSON.stringify([
      config.accounts.sessionTtlDays,
      config.accounts.allowRegistration,
    ]);
    if (this.accounts === undefined || this.accountsOptions !== options) {
      this.accounts = new QaAccounts(defaultAccountsFilePath(), {
        sessionTtlDays: config.accounts.sessionTtlDays,
        allowRegistration: config.accounts.allowRegistration,
      });
      this.accountsOptions = options;
    }
    return this.accounts;
  }

  /** The accounts store, or the disabled refusal the browser maps to copy. */
  private requireAccounts(): QaAccounts {
    const accounts = this.accountsFor(this.getConfig());
    if (accounts === undefined) {
      throw new Error(ACCOUNTS_DISABLED_ERROR);
    }
    return accounts;
  }

  /** Account failures ride the shared `(reason: <code>)` wire marker. */
  private accountsRemote<T>(operation: () => T, sessionIdForLog?: string): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof QaAccountsError) {
        this.logger.warn("accounts.rejected", {
          reason: error.reason,
          sessionId: sessionIdForLog,
        });
        throw new Error(
          `QA accounts refused the request (reason: ${error.reason})`,
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }

  /** Self-service signup; the first account ever created becomes admin. */
  @Remote("accountsRegister")
  accountsRegister(
    email: string,
    password: string,
    displayName?: string,
  ): QaAccountSession {
    const accounts = this.requireAccounts();
    return this.accountsRemote(() =>
      accounts.register(email, password, displayName),
    );
  }

  @Remote("accountsLogin")
  accountsLogin(email: string, password: string): QaAccountSession {
    const accounts = this.requireAccounts();
    return this.accountsRemote(() => accounts.login(email, password));
  }

  /** Identity probe; safe to call with an empty or expired token. */
  @Remote("accountsWhoami")
  accountsWhoami(token: string): QaWhoamiResult {
    if (!this.getConfig().accounts.enabled) return { authenticated: false };
    const accounts = this.requireAccounts();
    return this.accountsRemote(() => accounts.whoami(token));
  }

  /** Migrate a browser's local chat index into server-side ownership. */
  @Remote("accountsClaimSessions")
  accountsClaimSessions(
    token: string,
    sessionIds: readonly string[],
  ): QaClaimResult {
    const accounts = this.requireAccounts();
    return this.accountsRemote(() => accounts.claimSessions(token, sessionIds));
  }

  /** The token user's owned session ids; the sidebar list authority. */
  @Remote("accountsOwnedSessions")
  accountsOwnedSessions(token: string): { readonly ids: readonly string[] } {
    if (!this.getConfig().accounts.enabled) return { ids: [] };
    const accounts = this.requireAccounts();
    return this.accountsRemote(() => ({
      ids: accounts.ownedSessionIds(token),
    }));
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
  secureSession(token: string, sessionId: string): QaLockdownProof {
    try {
      return this.admission.secureSession(token, sessionId);
    } catch (error) {
      // The carrier empties error.details, so the coarse reason rides the
      // wire message for the browser console; the specific mismatch facts
      // stay in this log only.
      const reason =
        error instanceof QaAttestationError
          ? error.reason
          : (ACCOUNTS_REASON_MARKER.exec(
              error instanceof Error ? error.message : "",
            )?.at(1) ?? "attestation-failed");
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

  /** Return canonical Host snapshots; replay is rebuilt from qa/sources events. */
  @Remote("sources")
  sources(token: string, sessionId: string): readonly QaTurnSources[] {
    this.admission.secureSession(token, sessionId);
    return this.provenance.bundles(sessionId);
  }

  /** Narrow read-only preview capability for files already present as sources. */
  @Remote("readSourceFile")
  async readSourceFile(
    token: string,
    sessionId: string,
    sourcePath: string,
  ): Promise<QaSourceFilePreview> {
    this.admission.secureSession(token, sessionId);
    const config = this.getConfig().sources.filePreview;
    if (
      !config.enabled ||
      !this.provenance.sourceAllowed(sessionId, sourcePath)
    ) {
      throw new Error("Source preview is unavailable.");
    }
    const agent = this.ctx.agents.get(
      (await import("@deepseek-ai/dsh-session/types")).SessionId(sessionId),
    );
    const root = agent?.session.header.cwd;
    if (root === undefined) throw new Error("Source preview is unavailable.");
    try {
      return await readSourceFilePreview({
        root,
        sourcePath,
        maxBytes: config.maxBytes,
        maxMarkdownRenderBytes: config.maxMarkdownRenderBytes,
      });
    } catch {
      throw new Error("Source preview is unavailable.");
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
export { QaAccounts, QaAccountsError } from "./accounts/store.js";
export { entryRedirectRow, entryRedirectScript } from "./entry-redirect.js";
export { registerQaNavigationRoute } from "./host-route.js";
export { qaToolDenial, qaToolPolicyPlan } from "./lockdown-policy.js";
export { QaPolicyAdmission } from "./secure-session.js";
export * from "./provenance/index.js";
export type * from "./types.js";
export default QaSurface;
