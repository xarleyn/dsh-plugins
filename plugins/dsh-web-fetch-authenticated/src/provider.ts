/**
 * The authenticated fetch provider: a `WebFetchProvider` over `ctx.web` whose
 * internal rule router selects one configured rule per URL (SPEC §16). The
 * model-facing surface is exactly the upstream `web_fetch` tool — the provider
 * adds matching, policy, credentials, and audit invisibly.
 * @module provider
 */

import { WebError } from "@deepseek-ai/dsh-web";
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
} from "@deepseek-ai/dsh-web";
import { isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import {
  resolveConfig,
  DEFAULT_MAX_URL_LENGTH,
  DEFAULT_USER_AGENT,
} from "./config.js";
import type {
  WebFetchAuthConfig,
  ResolvedConfig,
  ResolvedRule,
} from "./types.js";
import { matchRules } from "./policy/match.js";
import { validateFetchUrl } from "./policy/url.js";
import * as errors from "./errors.js";
import {
  authenticatedFetch,
  authenticatedFetchBinary,
} from "./transport/fetch.js";
import type { TransportGlobals } from "./transport/fetch.js";
import {
  imageAcceptHeader,
  imageNameFromUrl,
  sniffImageMediaType,
  type ImageMediaType,
} from "./images.js";
import { applyAdapter } from "./adapters/index.js";
import type { AdapterRequestContext } from "./adapters/index.js";
import type { CredentialResolver } from "./credentials/resolver.js";
import type { ResolvedAuthSecrets } from "./auth/index.js";

/** Stable id this provider registers under (SPEC §4). */
export const AUTHENTICATED_FETCH_PROVIDER_ID = "authenticated";

/** One downloaded image, ready to be committed to attachment storage. */
export interface FetchedImage {
  /** Final URL after allowed redirects. */
  readonly url: string;
  readonly statusCode: number;
  /** Media type verified from the file signature, not the server header. */
  readonly mediaType: ImageMediaType;
  readonly bytes: Uint8Array;
  /** Display name derived from the URL path. */
  readonly name: string;
}

/** Collaborators the provider needs at construction time. */
export interface ProviderDeps {
  /** Live config source (the settings-resolved section or the entry config). */
  readonly configSource: () => WebFetchAuthConfig;
  readonly credentials: CredentialResolver;
  readonly logger: PluginLogger;
}

export class AuthenticatedFetchProvider implements WebFetchProvider {
  readonly id = AUTHENTICATED_FETCH_PROVIDER_ID;

  private readonly deps: ProviderDeps;

  constructor(deps: ProviderDeps) {
    this.deps = deps;
  }

  /** The operational check the seam asks for: the plugin itself is enabled. */
  available(): boolean {
    // SPEC §13: per-rule misconfiguration surfaces at request time, not here.
    return this.resolved().enabled;
  }

  async fetch(
    request: WebFetchRequest,
    signal?: AbortSignal,
  ): Promise<WebFetchResult> {
    const config = this.resolved();
    if (!config.enabled) throw errors.ruleDisabled("provider");
    const url = this.validatedUrl(request.url);
    const rule = this.ruleFor(url, request.url, config);

    const startedAt = Date.now();
    try {
      const adapterContext: AdapterRequestContext = {
        rule,
        rules: config.rules,
        globals: this.globals(),
        resolveSecrets: (candidate) => this.resolveSecrets(candidate),
        ...(signal === undefined ? {} : { signal }),
      };
      // A rule with a content adapter serves recognized URLs from the product
      // REST API and normalizes them; unrecognized URLs fall through to raw.
      const adapted = await applyAdapter(url, adapterContext);
      const result =
        adapted ??
        (await authenticatedFetch({
          url,
          ...adapterContext,
          documents: rule.documents,
        }));
      this.auditOk(rule, url, Date.now() - startedAt, result.statusCode);
      return result;
    } catch (error: unknown) {
      const code =
        error instanceof WebError && typeof error.code === "string"
          ? error.code
          : "AUTH_FETCH_PROVIDER_ERROR";
      this.audit(rule, url, code, Date.now() - startedAt, undefined);
      throw error;
    }
  }

  /**
   * Fetch one image over the same rule, credentials and network policy as
   * `fetch` and hand back its bytes. The harness body union carries text only,
   * so this path exists for the download tool: the bytes it returns become a
   * durable attachment, and the model sees the image itself.
   *
   * A response that is not a raster image the attachment store can hold — an
   * error page, a PDF, an HTML login redirect — is a `WebError` rather than
   * something to store, because there is no image to return.
   */
  async fetchImage(
    request: { readonly url: string },
    options: { readonly maxBytes: number; readonly signal?: AbortSignal },
  ): Promise<FetchedImage> {
    const config = this.resolved();
    if (!config.enabled) throw errors.ruleDisabled("provider");
    const url = this.validatedUrl(request.url);
    const rule = this.ruleFor(url, request.url, config);

    const startedAt = Date.now();
    try {
      const maxBytes = Math.min(options.maxBytes, rule.limits.maxResponseBytes);
      let fetched;
      try {
        fetched = await authenticatedFetchBinary(
          {
            url,
            rule,
            rules: config.rules,
            globals: this.globals(),
            resolveSecrets: (candidate) => this.resolveSecrets(candidate),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          },
          { accept: imageAcceptHeader(), maxBytes },
        );
      } catch (error: unknown) {
        // An over-cap response is one refusal whichever way the server
        // reported the size: the caller asked for an image within budget.
        if (
          error instanceof WebError &&
          error.code === "AUTH_FETCH_RESPONSE_TOO_LARGE"
        ) {
          throw errors.imageTooLarge(maxBytes);
        }
        throw error;
      }
      if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
        throw errors.notAnImage(fetched.contentType, fetched.statusCode);
      }
      if (fetched.truncated) throw errors.imageTooLarge(maxBytes);
      const mediaType = sniffImageMediaType(fetched.bytes);
      if (mediaType === undefined)
        throw errors.notAnImage(fetched.contentType, fetched.statusCode);
      const image: FetchedImage = {
        url: fetched.url,
        statusCode: fetched.statusCode,
        mediaType,
        bytes: fetched.bytes,
        name: imageNameFromUrl(fetched.url),
      };
      this.auditOk(rule, url, Date.now() - startedAt, fetched.statusCode);
      return image;
    } catch (error: unknown) {
      const code =
        error instanceof WebError && typeof error.code === "string"
          ? error.code
          : "AUTH_FETCH_PROVIDER_ERROR";
      this.audit(rule, url, code, Date.now() - startedAt, undefined);
      throw error;
    }
  }

  /** Validate a caller-supplied URL into the one shape the pipeline accepts. */
  private validatedUrl(raw: string): URL {
    try {
      return validateFetchUrl(raw, DEFAULT_MAX_URL_LENGTH);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "InvalidUrlError")
        throw errors.invalidUrl(error.message);
      throw error;
    }
  }

  /** The one enabled rule a URL resolves to, with the refusals audited. */
  private ruleFor(
    url: URL,
    requestUrl: string,
    config: ResolvedConfig,
  ): ResolvedRule {
    const matched = matchRules(config.rules, url);
    if (matched.length === 0) {
      this.auditDenied(url, "AUTH_FETCH_NO_MATCHING_RULE", config.rules.length);
      throw errors.noMatchingRule(requestUrl, config.rules.length);
    }
    if (matched.length > 1) {
      this.auditDenied(url, "AUTH_FETCH_AMBIGUOUS_MATCH", config.rules.length);
      throw errors.ambiguousMatch(
        requestUrl,
        matched.map((rule) => rule.source.id),
      );
    }
    const rule = matched[0];
    if (rule === undefined)
      throw errors.noMatchingRule(requestUrl, config.rules.length);
    return rule;
  }

  /** Resolve the credential VALUES for one rule's auth; never cached across fetches. */
  private async resolveSecrets(
    rule: ResolvedRule,
  ): Promise<ResolvedAuthSecrets> {
    const auth = rule.source.auth;
    if (auth.type === "none") return {};
    if (auth.type === "basic") {
      return {
        password: await this.resolveOne(
          auth.passwordCredential,
          rule.source.id,
        ),
      };
    }
    return {
      credential: await this.resolveOne(auth.credential, rule.source.id),
    };
  }

  private resolveOne(ref: string, ruleId: string): Promise<string> {
    if (!isCredentialRefName(ref))
      return Promise.reject(errors.credentialInvalid(ref, ruleId));
    return this.deps.credentials.resolve(ref).then((value) => {
      if (value === undefined) throw errors.credentialMissing(ref, ruleId);
      return value;
    });
  }

  private resolved(): ResolvedConfig {
    return resolveConfig(this.deps.configSource());
  }

  private globals(): TransportGlobals {
    return {
      maxUrlLength: DEFAULT_MAX_URL_LENGTH,
      userAgent: DEFAULT_USER_AGENT,
    };
  }

  private auditDenied(url: URL, outcome: string, ruleCount: number): void {
    if (!this.resolved().audit.enabled) return;
    this.deps.logger.info("auth_fetch.denied", {
      outcome,
      origin: url.origin,
      path: url.pathname,
      rules: ruleCount,
    });
  }

  private auditOk(
    rule: ResolvedRule,
    url: URL,
    durationMs: number,
    statusCode: number,
  ): void {
    this.audit(rule, url, "ok", durationMs, statusCode);
  }

  private audit(
    rule: ResolvedRule,
    url: URL,
    outcome: string,
    durationMs: number,
    statusCode: number | undefined,
  ): void {
    if (!this.resolved().audit.enabled) return;
    this.deps.logger.info("auth_fetch.request", {
      ruleId: rule.source.id,
      origin: url.origin,
      path: url.pathname,
      outcome,
      durationMs,
      ...(statusCode === undefined ? {} : { statusCode }),
    });
  }
}
