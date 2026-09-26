/**
 * `@yadsh/dsh-web-fetch-authenticated`: registers an authenticated,
 * policy-gated `WebFetchProvider` with `ctx.web` (SPEC §4). A service plugin:
 * it owns the live configuration source (the volatile fields of this entry's
 * profile), the provider
 * registration, credential resolution, and the sanitized browser Remote
 * (`status` / `testRule` / `diagnose`) backing the settings card.
 *
 * @module @yadsh/dsh-web-fetch-authenticated
 */

import { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-credentials";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type {} from "@deepseek-ai/dsh-web";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { createCredentialResolver } from "./credentials/resolver.js";
import type { CredentialResolver } from "./credentials/resolver.js";
import {
  resolveConfig,
  readVolatileConfig,
  ConfigSchema,
  type WebFetchAuthVolatileConfig,
} from "./config.js";
import { AuthenticatedFetchProvider } from "./provider.js";
import { createFetchImageTool } from "./tools/fetch-image.js";
import { createFetchFileTool } from "./tools/fetch-file.js";
import { diagnose as runDiagnose, testRule as runTest } from "./testing.js";
import { validateConfig } from "./rule-validation.js";
import { observedFetchProviderId } from "./dsh-compat/web-status.js";
import { primaryCredentialRef } from "./auth/index.js";
import type {
  WebFetchAuthConfig,
  CredentialStateView,
  DiagnoseReport,
  ProviderStatusReport,
  ResolvedConfig,
  RuleTestReport,
} from "./types.js";

export { AUTHENTICATED_FETCH_PROVIDER_ID } from "./provider.js";
export { AuthenticatedFetchProvider } from "./provider.js";
export type { FetchedFile, FetchedImage } from "./provider.js";
export {
  createFetchFileTool,
  FETCH_FILE_TOOL_NAME,
  type FetchFileToolOptions,
  type FileDownloader,
} from "./tools/fetch-file.js";
export {
  createFetchImageTool,
  FETCH_IMAGE_TOOL_NAME,
  type FetchImageToolOptions,
  type ImageDownloader,
} from "./tools/fetch-image.js";
export {
  IMAGE_MEDIA_TYPES,
  imageAcceptHeader,
  imageNameFromUrl,
  fileNameFromUrl,
  sniffImageMediaType,
  type ImageMediaType,
} from "./images.js";
export {
  ConfigSchema,
  readVolatileConfig,
  resolveConfig,
  DEFAULT_LIMITS,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_MAX_URL_LENGTH,
  DEFAULT_USER_AGENT,
} from "./config.js";
export type { WebFetchAuthVolatileConfig } from "./config.js";
export { createCredentialResolver } from "./credentials/resolver.js";
export { validateConfig } from "./rule-validation.js";
export { testRule, diagnose } from "./testing.js";
export * from "./types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Status, tester, and diagnostics for the authenticated fetch provider. */
    webFetchAuth: WebFetchAuthService;
  }
}

/** Cordis plugin ID. */
export const name = "web-fetch-authenticated";
export const inject = ["web"];

/**
 * The live profile, in reference form: the Host serves the fields the card edits
 * as `Volatile` refs and replaces their values without remounting this entry, so
 * `Config` is what `apply()` receives rather than the plain document.
 */
export type Config = WebFetchAuthVolatileConfig;
export const Config = ConfigSchema;

/** The host-side Remote face the browser card calls. */
export interface WebFetchAuthService {
  status(): Promise<ProviderStatusReport>;
  testRule(ruleId: string, url?: string): Promise<RuleTestReport>;
  diagnose(url: string): Promise<DiagnoseReport>;
}

/** DSH Host plugin, provider owner, and browser Remote service. */
export class WebFetchAuthenticated
  extends TypertRemoteService
  implements WebFetchAuthService
{
  static inject = inject;
  static Config = ConfigSchema;

  private readonly liveConfig: WebFetchAuthVolatileConfig;
  private readonly logger: PluginLogger;
  private readonly credentials: CredentialResolver;

  constructor(ctx: Context, config: WebFetchAuthVolatileConfig) {
    super(ctx, "webFetchAuth", { namespace: "webFetchAuth" });
    this.logger = getPluginLogger({
      pluginId: "dsh-web-fetch-authenticated",
      console: "trace",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    ctx.effect(
      () => async () => this.logger.close(),
      "dsh-web-fetch-authenticated.logger",
    );
    // The references are stable and their values are not: one read per
    // operation, so an edit made in the card is seen by the next request.
    this.liveConfig = config;
    // Read per operation, never captured: this bundle applies while the
    // credentials provider's fiber is still loading, and cordis' strict
    // `ctx.get` reports a not-yet-active service as absent.
    this.credentials = createCredentialResolver(
      () => this.ctx.get("credentials") ?? undefined,
    );

    const provider = new AuthenticatedFetchProvider({
      configSource: () => this.currentConfig(),
      credentials: this.credentials,
      logger: this.logger,
    });

    ctx.web.registerFetchProvider(provider);

    // The download tool exists only where its result can land: a deployment
    // without a durable attachment store has nowhere to keep the image and
    // nothing that could render it back to the model.
    ctx.inject(["tools", "attachments"], (toolCtx) => {
      const removeImage = toolCtx.tools.register(
        createFetchImageTool({
          ctx,
          downloader: provider,
          attachments: toolCtx.attachments,
        }),
      );
      const removeFile = toolCtx.tools.register(
        createFetchFileTool({
          downloader: provider,
          attachments: toolCtx.attachments,
        }),
      );
      ctx.effect(
        () => () => {
          removeFile();
          removeImage();
        },
        "dsh-web-fetch-authenticated.download-tools",
      );
    });

    const ready = this.resolved();
    this.logger.info("plugin.ready", {
      enabled: ready.enabled,
      rules: ready.rules.length,
    });
    // Used to ride the settings installation's change callback; the live path
    // now runs through the card, which shows the same reasons in its own status.
    this.logConfigIssues();
  }

  /** Sanitized provider status for the settings card (SPEC §6.1). */
  @Remote("status")
  async status(): Promise<ProviderStatusReport> {
    const config = this.resolved();
    const validation = validateConfig(this.currentConfig());
    const credentialStates = await this.credentialStates();
    const fetchProviderId = observedFetchProviderId(this.ctx.web);
    return {
      enabled: config.enabled,
      registered: true,
      available: config.enabled,
      ...(fetchProviderId === undefined ? {} : { fetchProviderId }),
      ruleCount: config.rules.length,
      enabledRuleCount: config.rules.filter((rule) => rule.source.enabled)
        .length,
      credentialStates,
      configErrors: [...validation.errors, ...config.configErrors],
      lastTests: this.recentTests(),
      unmatchedPolicy: config.unmatchedPolicy,
    };
  }

  /** Run the rule connection tester (SPEC §6.3); the report is sanitized. */
  @Remote("testRule")
  async testRule(ruleId: string, url?: string): Promise<RuleTestReport> {
    if (typeof ruleId !== "string" || ruleId.length === 0)
      throw new TypeError("ruleId must be a non-empty string");
    if (url !== undefined && typeof url !== "string")
      throw new TypeError("url must be a string when present");
    const report = await runTest(
      {
        configSource: () => this.currentConfig(),
        credentials: this.credentials,
      },
      ruleId,
      url,
    );
    this.rememberTest(report);
    return report;
  }

  /** Run the match/policy diagnostics (SPEC §6.4); the report is sanitized. */
  @Remote("diagnose")
  async diagnose(url: string): Promise<DiagnoseReport> {
    if (typeof url !== "string" || url.length === 0)
      throw new TypeError("url must be a non-empty string");
    return await runDiagnose(
      {
        configSource: () => this.currentConfig(),
        credentials: this.credentials,
      },
      url,
    );
  }

  // ---- per-process last-test memory (SPEC §6.1 "last test status") ----

  private readonly testHistory = new Map<string, RuleTestReport>();

  private rememberTest(report: RuleTestReport): void {
    this.testHistory.set(report.ruleId, report);
    if (this.testHistory.size > 200) {
      const oldest = this.testHistory.keys().next().value;
      if (oldest !== undefined) this.testHistory.delete(oldest);
    }
  }

  private recentTests(): RuleTestReport[] {
    return [...this.testHistory.values()];
  }

  /** One credential state per distinct auth reference across rules (values excluded). */
  private async credentialStates(): Promise<CredentialStateView[]> {
    const config = this.resolved();
    const seen = new Map<string, CredentialStateView>();
    for (const rule of config.rules) {
      const ref = primaryCredentialRef(rule.source.auth);
      if (ref === undefined || seen.has(ref)) continue;
      const validName = /^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref);
      const described = await this.credentials
        .describe(ref)
        .catch(() => undefined);
      seen.set(ref, {
        ref,
        configured: described?.configured ?? false,
        writable: described?.writable ?? true,
        validName,
      });
    }
    return [...seen.values()];
  }

  private logConfigIssues(): void {
    const config = this.resolved();
    if (config.configErrors.length > 0) {
      this.logger.warn("auth_fetch.config_errors", {
        errors: config.configErrors,
      });
    }
  }

  /**
   * The profile as one plain snapshot: every live reference read exactly once,
   * so nothing downstream can observe a value change halfway through an
   * operation.
   */
  private currentConfig(): WebFetchAuthConfig {
    return readVolatileConfig(this.liveConfig);
  }

  private resolved(): ResolvedConfig {
    return resolveConfig(this.currentConfig());
  }
}

export default WebFetchAuthenticated;
