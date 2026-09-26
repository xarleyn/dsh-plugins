/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
//
// The vocabulary the recall stages share: the config slice each of them reads,
// the transport it is handed, and the shapes one stage passes to the next.

/**
 * The slice of plugin config this module reads. Declared locally because the
 * shared module never imports the plugin's config type; the index signature
 * keeps every other key readable to the callers that thread the whole config
 * through.
 */
export interface RecallConfig {
  readonly peerId?: string;
  readonly recallLimit?: number;
  readonly recallMaxContentChars?: number;
  readonly scoreThreshold?: number;
  readonly recallPeerScope?: string;
  readonly recallTokenBudget?: number;
  readonly recallPreferAbstract?: boolean;
  readonly recallRewrite?: string;
  readonly recallMaxTokens?: number;
  readonly recallLimitConfigured?: boolean;
  readonly recallMaxTokensConfigured?: boolean;
  readonly recallQueryExpansion?: string;
  readonly recallQueryExpansionConfigured?: boolean;
  readonly recallDedupTurns?: number;
  readonly recallCompressMaxBullets?: number;
  readonly recallCompressMaxBulletsConfigured?: boolean;
  readonly recallContextTimeoutMs?: number;
  readonly timeoutMs?: number;
}

/**
 * The plugin's HTTP transport result. Only the envelope fields the recall
 * paths probe are named; anything else a transport layer attaches (including
 * the rejection detail `looksLikeUnknownField` stringifies) stays opaque.
 */
export interface FetchJSONResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly status?: number;
  readonly error?: unknown;
  // FORK LOCAL EDIT (see docs/upstream-sync.md): the harness transport reports
  // "no trace id" as an explicit `undefined`. Type-level only.
  readonly traceId?: string | undefined;
  readonly [key: string]: unknown;
}

/**
 * The `makeFetchJSON` closure the runtime hands these helpers: a path, an
 * optional request init, and an optional per-call actor/timeout override.
 *
 * FORK LOCAL EDIT (see docs/upstream-sync.md): both override fields admit an
 * explicit `undefined`, because the caller forwards the values it read off its
 * own options. Type-level only; the requests are unchanged.
 */
export type FetchJSON = (
  path: string,
  init?: { readonly method?: string; readonly body?: string },
  options?: {
    readonly actorPeerId?: string | undefined;
    readonly timeoutMs?: number | undefined;
  },
) => Promise<FetchJSONResult>;

/**
 * A recall item as `find` returns it. Every value comes off the wire, so each
 * read below narrows (or stringifies) the field it needs. `_sourceType` is the
 * tag `searchOneSource` adds locally.
 */
export interface RecallItem {
  readonly uri?: unknown;
  readonly score?: unknown;
  readonly abstract?: unknown;
  readonly overview?: unknown;
  readonly category?: unknown;
  readonly level?: unknown;
  readonly _sourceType?: unknown;
  readonly [key: string]: unknown;
}

/** The request body of `/search/find`, `/search/search`, and `/search/recall`. */
export interface RecallBody {
  query?: unknown;
  quotas?: unknown;
  max_chars?: unknown;
  min_score?: unknown;
  render?: unknown;
  peer_scope?: unknown;
  mode?: unknown;
  purpose?: unknown;
  score_threshold?: unknown;
  max_tokens?: unknown;
  session_id?: unknown;
  query_expansion?: unknown;
  dedup_turns?: unknown;
  exclude_uris?: unknown;
  rewrite?: unknown;
  rewrite_max_bullets?: unknown;
  target_uri?: unknown;
  limit?: unknown;
  [key: string]: unknown;
}

/** The options bag the recall entry points thread through each other. */
export interface RecallOptions {
  readonly actorPeerId?: string;
  readonly log?: RecallLog;
  readonly legacyCachePath?: string;
  readonly digestCachePath?: string;
  readonly runCompressor?: (prompt: string) => Promise<unknown>;
  readonly sessionId?: unknown;
  readonly excludeUris?: unknown;
  readonly localCompressorAvailable?: unknown;
  readonly legacyPeerId?: unknown;
}

/** The options bag `postRecall` takes. */
export interface PostRecallOptions {
  readonly actorPeerId?: string;
  readonly log?: RecallLog;
  readonly peerScopeMemoPath?: string;
}

/** The relevance profile `buildQueryProfile` derives from the query text. */
export interface QueryProfile {
  readonly tokens: string[];
  readonly wantsPreference: boolean;
  readonly wantsTemporal: boolean;
}

/** The server's assembled context, before any envelope is wrapped around it. */
export interface AssembledContext {
  readonly rendered: string;
  readonly entries: RecallItem[];
  readonly digest: string;
  readonly stats: Record<string, unknown>;
}

/** Parsed on-disk state (`context-face.json`, `peer-scope.json`). */
export interface StateRecord {
  readonly legacyUntil?: unknown;
  readonly scope?: unknown;
  readonly status?: unknown;
  readonly at?: unknown;
  readonly [key: string]: unknown;
}

/** How the runtime logs recall telemetry: an event name plus a payload. */
export type RecallLog = (event: string, data: Record<string, unknown>) => void;

/**
 * `unknown` wire payload read as a plain object, else null. This is the one
 * narrowing step between the transport's opaque `result` and the property
 * reads the original performed directly.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
