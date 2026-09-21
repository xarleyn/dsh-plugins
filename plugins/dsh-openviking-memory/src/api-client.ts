/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

import type { ResolvedConfig } from "./config.js";

/** The error envelope OpenViking returns, or the one the client synthesizes. */
export interface OpenVikingError {
  readonly message: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/**
 * The envelope every client request resolves to. `traceId` admits an explicit
 * `undefined` because the transport forwards whatever the server sent without
 * narrowing it first.
 */
export interface OpenVikingResult<T = unknown> {
  readonly ok: boolean;
  readonly result: T | null;
  readonly status: number;
  readonly error?: OpenVikingError;
  readonly traceId?: string | undefined;
  readonly [key: string]: unknown;
}

/**
 * The session metadata the runtime reads back after capture: the commit
 * threshold is compared against `pending_tokens`. Every other field the server
 * sends stays opaque.
 */
export interface OpenVikingSessionMetadata {
  readonly pending_tokens?: number;
  readonly [key: string]: unknown;
}

/**
 * The `trace_id` OpenViking reported for one result, when it sent one. The
 * server nests it differently per endpoint, so the runtime reads it back off
 * the opaque `result` payload through this single narrowing step.
 */
export function traceIdOf(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const trace = (result as { readonly trace_id?: unknown }).trace_id;
  return typeof trace === "string" && trace ? trace : undefined;
}

/** One flattened `find()` hit. */
export interface OpenVikingFindEntry {
  readonly uri: string;
  readonly contextType: string;
  readonly score: number;
  readonly abstract: string;
  readonly overview: string | null;
}

/**
 * Per-call overrides accepted by `fetchJSON` and every method above it. Both
 * fields admit an explicit `undefined`: a caller forwards an optional value it
 * read off its own options, and here an absent key and an undefined one mean
 * the same thing — no override.
 */
export interface FetchJSONOptions {
  readonly actorPeerId?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/** The `fetchJSON` closure shape the recall and pending modules call. */
export type FetchJSON = (
  path: string,
  init?: {
    readonly method?: string;
    readonly body?: string;
    readonly headers?: Record<string, string>;
  },
  options?: FetchJSONOptions,
) => Promise<OpenVikingResult>;

/**
 * The fields `fetchJSON` reads off a parsed response body. The wire envelope is
 * untyped, so every read below is a property probe whose result is narrowed (or
 * stringified) at the use site.
 */
interface Envelope {
  readonly result?: { readonly trace_id?: unknown } | null;
  readonly error?: { readonly trace_id?: unknown } | null;
  readonly status?: unknown;
  readonly trace_id?: unknown;
}

/** Per-call options for `find()`. */
interface FindOptions {
  readonly targetUri?: string;
  readonly limit?: number;
  readonly scoreThreshold?: number;
  readonly actorPeerId?: string;
}

/** Per-call options for `commitSession()`. */
interface CommitOptions {
  readonly timeoutMs?: number;
}

/**
 * Thin OpenViking HTTP client: one method per endpoint the plugin uses, plus
 * the `fetchJSON` closure the ported recall/pending modules are injected with.
 */
export class OpenVikingClient {
  readonly config: ResolvedConfig;

  connected: boolean;

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.connected = false;
  }

  headers(options: FetchJSONOptions = {}): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey)
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    if (this.config.account)
      headers["X-OpenViking-Account"] = this.config.account;
    if (this.config.user) headers["X-OpenViking-User"] = this.config.user;
    const actorPeerId = options.actorPeerId ?? this.config.peerId;
    if (actorPeerId) headers["X-OpenViking-Actor-Peer"] = actorPeerId;
    if (this.config.userAgent) headers["User-Agent"] = this.config.userAgent;
    return headers;
  }

  async fetchJSON(
    path: string,
    init: {
      readonly method?: string;
      readonly body?: string;
      readonly headers?: Record<string, string>;
    } = {},
    options: FetchJSONOptions = {},
  ): Promise<OpenVikingResult> {
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.config.endpoint}${path}`, {
        ...init,
        headers: {
          ...this.headers(options),
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as
        Envelope | null | undefined;
      const traceId = (body?.result?.trace_id ||
        body?.error?.trace_id ||
        body?.trace_id ||
        undefined) as string | undefined;
      if (!response.ok || body?.status === "error") {
        return {
          ok: false,
          result: null,
          status: response.status,
          error: (body?.error || {
            message: `HTTP ${response.status}`,
          }) as OpenVikingError,
          traceId,
        };
      }
      return {
        ok: true,
        result: body?.result ?? body,
        status: response.status,
        traceId,
      };
    } catch (error) {
      return {
        ok: false,
        result: null,
        status: 0,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    return (await this.healthResult()).ok;
  }

  async healthResult(): Promise<OpenVikingResult> {
    const response = await this.fetchJSON("/health", {}, { timeoutMs: 5000 });
    this.connected = response.ok;
    return response;
  }

  async ensureSession(
    sessionId: string,
    actorPeerId?: string,
  ): Promise<boolean> {
    const response = await this.ensureSessionResult(sessionId, actorPeerId);
    return (
      response.ok ||
      (response.status === 409 && response.error?.code === "ALREADY_EXISTS")
    );
  }

  async ensureSessionResult(
    sessionId: string,
    actorPeerId?: string,
  ): Promise<OpenVikingResult> {
    const response = await this.fetchJSON(
      "/api/v1/sessions",
      {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      },
      { actorPeerId },
    );
    return response;
  }

  async getSession(
    sessionId: string,
    actorPeerId?: string,
  ): Promise<OpenVikingSessionMetadata | null> {
    const response = await this.fetchJSON(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      {},
      { timeoutMs: 5000, actorPeerId },
    );
    return response.ok
      ? (response.result as OpenVikingSessionMetadata | null)
      : null;
  }

  async getSessionArchive(
    sessionId: string,
    archiveId: string,
    actorPeerId?: string,
  ): Promise<unknown> {
    const response = await this.fetchJSON(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/archives/${encodeURIComponent(archiveId)}`,
      {},
      { actorPeerId },
    );
    return response.ok ? response.result : null;
  }

  async addMessage(
    sessionId: string,
    payload: unknown,
    actorPeerId?: string,
  ): Promise<OpenVikingResult> {
    return this.fetchJSON(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      { actorPeerId },
    );
  }

  async commitSession(
    sessionId: string,
    actorPeerId?: string,
    options: CommitOptions = {},
  ): Promise<OpenVikingResult> {
    return this.fetchJSON(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`,
      {
        method: "POST",
        body: JSON.stringify({
          keep_recent_count: this.config.commitKeepRecentCount,
        }),
      },
      { timeoutMs: options.timeoutMs ?? 30000, actorPeerId },
    );
  }

  async find(
    query: string,
    options: FindOptions = {},
  ): Promise<OpenVikingFindEntry[]> {
    const body: {
      query: string;
      target_uri?: string;
      limit?: number;
      score_threshold?: number;
    } = { query };
    if (options.targetUri) body.target_uri = options.targetUri;
    if (options.limit) body.limit = options.limit;
    if (options.scoreThreshold !== undefined)
      body.score_threshold = options.scoreThreshold;
    const response = await this.fetchJSON(
      "/api/v1/search/find",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      { actorPeerId: options.actorPeerId },
    );
    if (!response.ok || !response.result) return [];

    const results: OpenVikingFindEntry[] = [];
    for (const bucket of ["memories", "resources", "skills"]) {
      const entries = (response.result as Record<string, unknown>)[bucket];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        results.push({
          uri: entry?.uri || "",
          contextType:
            entry?.context_type ||
            (bucket === "memories"
              ? "memory"
              : bucket === "skills"
                ? "skill"
                : "resource"),
          score: Number(entry?.score || 0),
          abstract: entry?.abstract || "",
          overview: entry?.overview || null,
        });
      }
    }
    return results;
  }

  async read(
    uri: string,
    level: string,
    actorPeerId?: string,
  ): Promise<unknown> {
    const endpoint =
      level === "abstract"
        ? "abstract"
        : level === "overview"
          ? "overview"
          : "read";
    const response = await this.fetchJSON(
      `/api/v1/content/${endpoint}?uri=${encodeURIComponent(uri)}`,
      {},
      { actorPeerId },
    );
    return response.ok ? response.result : null;
  }

  async list(uri: string, actorPeerId?: string): Promise<unknown[]> {
    const response = await this.fetchJSON(
      `/api/v1/fs/ls?uri=${encodeURIComponent(uri)}&output=original`,
      {},
      { actorPeerId },
    );
    return response.ok && Array.isArray(response.result) ? response.result : [];
  }

  async stat(uri: string, actorPeerId?: string): Promise<unknown> {
    const response = await this.fetchJSON(
      `/api/v1/fs/stat?uri=${encodeURIComponent(uri)}`,
      {},
      { actorPeerId },
    );
    return response.ok ? response.result : null;
  }

  async forget(
    uri: string,
    recursive: boolean = false,
    actorPeerId?: string,
  ): Promise<boolean> {
    const response = await this.fetchJSON(
      `/api/v1/fs?uri=${encodeURIComponent(uri)}&recursive=${recursive}`,
      { method: "DELETE" },
      { actorPeerId },
    );
    return response.ok;
  }

  async addResource(
    path: string,
    reason: string,
    actorPeerId?: string,
  ): Promise<unknown> {
    const body: { path: string; reason?: string } = { path };
    if (reason) body.reason = reason;
    const response = await this.fetchJSON(
      "/api/v1/resources",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      { timeoutMs: 30000, actorPeerId },
    );
    return response.ok ? response.result : null;
  }
}
