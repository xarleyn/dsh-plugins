/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

import { readFileSync } from "node:fs";

import z from "@deepseek-ai/schemastery";

import { buildUserAgent, resolveOpenVikingCredentials } from "./openviking/credentials.js";
import { resolveEffectivePeerId } from "./openviking/workspace-peer.js";

/**
 * Version reported in the OpenViking `User-Agent`. Read from the package
 * manifest so a release bump cannot drift away from it (upstream kept a
 * hand-written constant pinned by a test instead).
 */
export function pluginVersion(): string {
  // Resolved on first use, not at import time, so loading the module never
  // touches the filesystem.
  cachedVersion ??= readManifestVersion() ?? VERSION_FALLBACK;
  return cachedVersion;
}

let cachedVersion: string | undefined;

/**
 * Namespace for the bridged OpenViking MCP tools. DSH publishes every MCP tool
 * as `mcp__<serverName>__<rawName>`, so this string is part of the
 * model-facing contract: changing it renames all of them.
 */
export const MCP_SERVER_NAME = "openviking";

const VERSION_FALLBACK = "0.0.0";

function readManifestVersion(): string | undefined {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    );
    const version = (manifest as { version?: unknown }).version;
    return typeof version === "string" && version.trim() ? version.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Peer-scope values the OpenViking recall endpoints accept. */
export const RECALL_PEER_SCOPES = ["all", "actor"] as const;
export type RecallPeerScope = (typeof RECALL_PEER_SCOPES)[number];

/** Query-expansion modes understood by the server-side context face. */
export const RECALL_QUERY_EXPANSIONS = ["auto", "off"] as const;
export type RecallQueryExpansion = (typeof RECALL_QUERY_EXPANSIONS)[number];

/** Values for the deprecated `captureMode` knob (accepted, see the schema note). */
export const CAPTURE_MODES = ["semantic", "keyword"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

/** Where the digest for a server-assembled context block comes from. */
export const RECALL_REWRITE_MODES = ["off", "auto", "client", "server"] as const;
export type RecallRewriteMode = (typeof RECALL_REWRITE_MODES)[number];

/**
 * The canonical default for every knob. `resolveConfig()` falls back to these
 * values for anything the user did not set, so an installation that only names
 * an endpoint behaves exactly like the upstream plugin.
 */
const DEFAULT_CONFIG = Object.freeze({
  endpoint: "http://127.0.0.1:1933",
  apiKey: "",
  account: "",
  user: "",
  peerId: "",
  workspacePeer: true,
  peerSource: "",
  recallPeerScope: "all" as RecallPeerScope,
  recallQueryExpansion: "auto" as RecallQueryExpansion,
  syncTurns: true,
  recallTokenBudget: 2000,
  recallMaxContentChars: 500,
  recallPreferAbstract: true,
  recallLimit: 10,
  scoreThreshold: 0.35,
  minQueryLength: 3,
  profileTokenBudget: 10000,
  commitTokenThreshold: 20000,
  commitKeepRecentCount: 10,
  captureToolResults: false,
  captureMode: "semantic" as CaptureMode,
  captureMaxLength: 24000,
  captureToolMaxChars: 1000000,
  captureAssistantTurns: true,
  captureFilters: [] as readonly string[],
  skipSubagentSessions: false,
  requestTimeoutMs: 10000,
  mcpToolCallTimeoutMs: 60000,
  recallRewrite: "off" as RecallRewriteMode,
  recallDedupTurns: 5,
  recallContextTimeoutMs: 0,
  recallMaxTokens: 1600,
  recallCompressMaxBullets: 6,
});

/**
 * User-facing plugin configuration — the schema below is the single source of
 * truth for defaults, ranges and enums, and Cordis rejects the whole plugin
 * when a value is out of range instead of silently clamping it.
 *
 * Every field is optional: a field without a `.default()` is left *absent* in
 * the config object Cordis hands to the plugin, which is how the runtime still
 * tells "the user asked for this" (and sends the matching request field) from
 * "this is just the fallback". Four knobs work that way on purpose — see
 * `recallLimit`, `recallQueryExpansion`, `recallMaxTokens` and
 * `recallCompressMaxBullets`.
 */
export interface Config {
  /**
   * Master switch for *automatic context presentation*. When `false`, the
   * plugin performs no startup-profile request, no per-step profile request and
   * no automatic recall — and issues no HTTP requests for them at all.
   *
   * Everything else keeps working: conversation capture, commit, MCP tools,
   * skills, the `viking://` guard and the runtime/service lifecycle. Set it to
   * `false` to leave memory retrieval entirely to the model's own tool calls.
   */
  readonly autoInject?: boolean;
  /**
   * Inject the stored user profile once at session start. Requires
   * `autoInject: true` — this knob narrows the master switch, never widens it.
   */
  readonly injectStartupProfile?: boolean;
  /**
   * Inject the stored user profile before each step while it has not been
   * delivered yet. Requires `autoInject: true`.
   */
  readonly injectStepProfile?: boolean;
  /** Run automatic semantic recall before each step. Requires `autoInject: true`. */
  readonly autoRecall?: boolean;

  /** OpenViking base URL. Falls back to `OPENVIKING_URL` / `ovcli.conf` / `ov.conf`. */
  readonly endpoint?: string;
  /** Bearer token. Falls back to `OPENVIKING_API_KEY` and the credential files. */
  readonly apiKey?: string;
  /** `X-OpenViking-Account` header value. Falls back to `OPENVIKING_ACCOUNT`. */
  readonly account?: string;
  /** `X-OpenViking-User` header value. Falls back to `OPENVIKING_USER`. */
  readonly user?: string;
  /** Explicit actor peer id; skips workspace-peer derivation entirely. */
  readonly peerId?: string;
  /** Derive a peer id from the workspace. `OPENVIKING_WORKSPACE_PEER=0` forces this off. */
  readonly workspacePeer?: boolean;
  /**
   * Peer-source preset (`git`, `cwd`, `none`) or a template such as
   * `team-{dir}`; a list of templates is tried in order.
   */
  readonly peerSource?: string;

  /** Which peers a recall searches: the caller's own, or every peer of the user. */
  readonly recallPeerScope?: RecallPeerScope;
  /** Server-side query expansion. Only an explicit value is sent to the server. */
  readonly recallQueryExpansion?: RecallQueryExpansion;
  /** Token budget for one recall injection block. */
  readonly recallTokenBudget?: number;
  /** Per-entry character cap inside a recall block. */
  readonly recallMaxContentChars?: number;
  /** Use the stored abstract instead of reading the item body. */
  readonly recallPreferAbstract?: boolean;
  /** Maximum number of recall entries per step. */
  readonly recallLimit?: number;
  /** Minimum relevance score a recall entry must reach. */
  readonly scoreThreshold?: number;
  /** Shortest prompt (in characters) that still triggers a recall. */
  readonly minQueryLength?: number;
  /** Token budget for the startup/per-step profile block. */
  readonly profileTokenBudget?: number;
  /** Who builds the recall digest: the server, this client, or nobody. */
  readonly recallRewrite?: RecallRewriteMode;
  /** Turns the server de-duplicates a recall against. `0` disables de-duplication. */
  readonly recallDedupTurns?: number;
  /** Hard deadline for one context-face request. `0` derives it from the request body. */
  readonly recallContextTimeoutMs?: number;
  /** Token ceiling for a server-assembled context block. */
  readonly recallMaxTokens?: number;
  /** Bullet cap when a digest is produced. */
  readonly recallCompressMaxBullets?: number;

  /** Commit the session once its pending token count reaches this value. */
  readonly commitTokenThreshold?: number;
  /** How many recent turns a commit keeps unsummarized. */
  readonly commitKeepRecentCount?: number;

  /** Capture conversation turns into the OpenViking session. */
  readonly syncTurns?: boolean;
  /** Capture tool results as well as user/assistant turns. */
  readonly captureToolResults?: boolean;
  /** Accepted for compatibility with upstream configs; not consumed by this plugin. */
  readonly captureMode?: CaptureMode;
  /** Character cap for one captured turn. */
  readonly captureMaxLength?: number;
  /** Character cap for one captured tool payload. */
  readonly captureToolMaxChars?: number;
  /** Capture assistant turns as well as user turns. */
  readonly captureAssistantTurns?: boolean;
  /**
   * Sed-style filters applied to captured text: `s/pat/rep/`, `d|pat|` (drop),
   * `k|pat|` (keep only), optionally prefixed with `user:` or `assistant:`.
   */
  readonly captureFilters?: string[];

  /** Leave sessions whose header origin is `subagent` entirely alone. */
  readonly skipSubagentSessions?: boolean;

  /** Timeout for one OpenViking HTTP request. */
  readonly requestTimeoutMs?: number;
  /** Timeout for one bridged OpenViking MCP tool call. */
  readonly mcpToolCallTimeoutMs?: number;
}

export const Config: z<Config> = z.object({
  autoInject: z.boolean().default(true),
  injectStartupProfile: z.boolean().default(true),
  injectStepProfile: z.boolean().default(true),
  autoRecall: z.boolean().default(true),

  endpoint: z.string().default(""),
  apiKey: z.string().default(""),
  account: z.string().default(""),
  user: z.string().default(""),
  peerId: z.string().default(""),
  workspacePeer: z.boolean().default(true),
  peerSource: z.string().default(""),

  recallPeerScope: z.union(RECALL_PEER_SCOPES).default("all"),
  // No `.default()`: the runtime only sends `query_expansion` when the user
  // named it, and a materialized default would send it on every deployment.
  recallQueryExpansion: z.union(RECALL_QUERY_EXPANSIONS),
  recallTokenBudget: z.number().step(1).min(200).max(50000).default(2000),
  recallMaxContentChars: z.number().step(1).min(100).max(5000).default(500),
  recallPreferAbstract: z.boolean().default(true),
  // No `.default()`: an explicit `recallLimit` switches the request from the
  // server's own quota ratios to the client's coding quota table.
  recallLimit: z.number().step(1).min(1).max(50),
  scoreThreshold: z.number().min(0).max(1).default(0.35),
  minQueryLength: z.number().step(1).min(1).max(64).default(3),
  profileTokenBudget: z.number().step(1).min(500).max(50000).default(10000),
  recallRewrite: z.union(RECALL_REWRITE_MODES).default("off"),
  recallDedupTurns: z.number().step(1).min(0).max(1000).default(5),
  recallContextTimeoutMs: z.number().step(1).min(0).max(600000).default(0),
  recallMaxTokens: z.number().step(1).min(64).max(1000000),
  recallCompressMaxBullets: z.number().step(1).min(1).max(50),

  commitTokenThreshold: z.number().step(1).min(1000).max(1000000).default(20000),
  commitKeepRecentCount: z.number().step(1).min(0).max(1000).default(10),

  syncTurns: z.boolean().default(true),
  captureToolResults: z.boolean().default(false),
  captureMode: z.union(CAPTURE_MODES).default("semantic"),
  captureMaxLength: z.number().step(1).min(200).max(100000).default(24000),
  captureToolMaxChars: z.number().step(1).min(200).max(1000000).default(1000000),
  captureAssistantTurns: z.boolean().default(true),
  captureFilters: z.array(z.string()).default([]),

  skipSubagentSessions: z.boolean().default(false),

  requestTimeoutMs: z.number().step(1).min(1000).max(120000).default(10000),
  mcpToolCallTimeoutMs: z.number().step(1).min(1000).max(600000).default(60000),
});

/**
 * The fully resolved runtime configuration: every knob present, plus the
 * derived fields the runtime, client and MCP proxy read.
 */
export interface ResolvedConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly account: string;
  readonly user: string;
  readonly peerId: string;
  readonly legacyPeerId: string;
  readonly explicitPeerId: string;
  readonly userAgent: string;
  readonly harness: string;
  readonly workspacePeer: boolean;
  readonly peerSource: string;
  readonly recallPeerScope: RecallPeerScope;
  readonly recallQueryExpansion: RecallQueryExpansion;
  readonly recallQueryExpansionConfigured: boolean;
  readonly recallLimitConfigured: boolean;
  readonly recallMaxTokensConfigured: boolean;
  readonly recallCompressMaxBulletsConfigured: boolean;
  readonly syncTurns: boolean;
  readonly recallTokenBudget: number;
  readonly recallMaxContentChars: number;
  readonly recallPreferAbstract: boolean;
  readonly recallLimit: number;
  readonly scoreThreshold: number;
  readonly minQueryLength: number;
  readonly profileTokenBudget: number;
  readonly recallRewrite: RecallRewriteMode;
  readonly recallDedupTurns: number;
  readonly recallContextTimeoutMs: number;
  readonly recallMaxTokens: number;
  readonly recallCompressMaxBullets: number;
  readonly commitTokenThreshold: number;
  readonly commitKeepRecentCount: number;
  readonly captureToolResults: boolean;
  readonly captureMode: CaptureMode;
  readonly captureMaxLength: number;
  readonly captureToolMaxChars: number;
  readonly captureAssistantTurns: boolean;
  readonly captureFilters: readonly string[];
  readonly skipSubagentSessions: boolean;
  readonly requestTimeoutMs: number;
  readonly mcpToolCallTimeoutMs: number;
  readonly autoInject: boolean;
  readonly injectStartupProfile: boolean;
  readonly injectStepProfile: boolean;
  readonly autoRecall: boolean;
}

/**
 * `ResolvedConfig` with mutable members: the resolver starts from defaults and
 * then normalizes in place, exactly as the upstream module did.
 */
type MutableResolvedConfig = { -readonly [K in keyof ResolvedConfig]: ResolvedConfig[K] };

/**
 * Merge user config over credential files and environment overrides, then
 * normalize every value the way the upstream plugin does.
 *
 * The `hasOwnProperty` probes run against the *raw* config Cordis handed over,
 * so a knob the user never set keeps its upstream "not configured" meaning even
 * though `DEFAULT_CONFIG` supplies a usable value here.
 */
export function resolveConfig(
  input: Config = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ResolvedConfig {
  const credentials = resolveOpenVikingCredentials(env);
  const explicitPeerId = input.peerId || credentials.peerId;
  // Every field is spelled out rather than spread, so the object is fully
  // typed from the start and a knob added to `Config` cannot silently miss its
  // default here.
  const config: MutableResolvedConfig = {
    endpoint: input.endpoint || credentials.baseUrl || DEFAULT_CONFIG.endpoint,
    apiKey: input.apiKey || credentials.apiKey,
    account: input.account || credentials.account,
    user: input.user || credentials.user,
    peerId: explicitPeerId,
    explicitPeerId,
    legacyPeerId: "",
    userAgent: buildUserAgent("dsh", pluginVersion()),
    harness: "dsh",
    workspacePeer: input.workspacePeer ?? DEFAULT_CONFIG.workspacePeer,
    peerSource: input.peerSource ?? DEFAULT_CONFIG.peerSource,
    recallPeerScope: input.recallPeerScope ?? DEFAULT_CONFIG.recallPeerScope,
    recallQueryExpansion: input.recallQueryExpansion ?? DEFAULT_CONFIG.recallQueryExpansion,
    syncTurns: input.syncTurns ?? DEFAULT_CONFIG.syncTurns,
    recallTokenBudget: input.recallTokenBudget ?? DEFAULT_CONFIG.recallTokenBudget,
    recallMaxContentChars: input.recallMaxContentChars ?? DEFAULT_CONFIG.recallMaxContentChars,
    recallPreferAbstract: input.recallPreferAbstract ?? DEFAULT_CONFIG.recallPreferAbstract,
    recallLimit: input.recallLimit ?? DEFAULT_CONFIG.recallLimit,
    scoreThreshold: input.scoreThreshold ?? DEFAULT_CONFIG.scoreThreshold,
    minQueryLength: input.minQueryLength ?? DEFAULT_CONFIG.minQueryLength,
    profileTokenBudget: input.profileTokenBudget ?? DEFAULT_CONFIG.profileTokenBudget,
    commitTokenThreshold: input.commitTokenThreshold ?? DEFAULT_CONFIG.commitTokenThreshold,
    commitKeepRecentCount: input.commitKeepRecentCount ?? DEFAULT_CONFIG.commitKeepRecentCount,
    captureToolResults: input.captureToolResults ?? DEFAULT_CONFIG.captureToolResults,
    captureMode: input.captureMode ?? DEFAULT_CONFIG.captureMode,
    captureMaxLength: input.captureMaxLength ?? DEFAULT_CONFIG.captureMaxLength,
    captureToolMaxChars: input.captureToolMaxChars ?? DEFAULT_CONFIG.captureToolMaxChars,
    captureAssistantTurns: input.captureAssistantTurns ?? DEFAULT_CONFIG.captureAssistantTurns,
    captureFilters: input.captureFilters ?? [...DEFAULT_CONFIG.captureFilters],
    skipSubagentSessions: input.skipSubagentSessions ?? DEFAULT_CONFIG.skipSubagentSessions,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_CONFIG.requestTimeoutMs,
    mcpToolCallTimeoutMs: input.mcpToolCallTimeoutMs ?? DEFAULT_CONFIG.mcpToolCallTimeoutMs,
    recallRewrite: input.recallRewrite ?? DEFAULT_CONFIG.recallRewrite,
    recallDedupTurns: input.recallDedupTurns ?? DEFAULT_CONFIG.recallDedupTurns,
    recallContextTimeoutMs: input.recallContextTimeoutMs ?? DEFAULT_CONFIG.recallContextTimeoutMs,
    recallMaxTokens: input.recallMaxTokens ?? DEFAULT_CONFIG.recallMaxTokens,
    recallCompressMaxBullets:
      input.recallCompressMaxBullets ?? DEFAULT_CONFIG.recallCompressMaxBullets,
    autoInject: input.autoInject ?? true,
    injectStartupProfile: input.injectStartupProfile ?? true,
    injectStepProfile: input.injectStepProfile ?? true,
    autoRecall: input.autoRecall ?? true,
    // "Configured" means the user named the knob, not that a default filled it:
    // each of these switches the matching request field on.
    recallLimitConfigured: Object.prototype.hasOwnProperty.call(input, "recallLimit"),
    recallQueryExpansionConfigured:
      Object.prototype.hasOwnProperty.call(input, "recallQueryExpansion"),
    recallMaxTokensConfigured: Object.prototype.hasOwnProperty.call(input, "recallMaxTokens"),
    recallCompressMaxBulletsConfigured: Object.prototype.hasOwnProperty.call(
      input,
      "recallCompressMaxBullets",
    ),
  };

  if (env.OPENVIKING_WORKSPACE_PEER !== undefined) {
    config.workspacePeer = environmentBoolean(
      env.OPENVIKING_WORKSPACE_PEER,
      config.workspacePeer,
    );
  }
  if (env.OPENVIKING_RECALL_PEER_SCOPE) {
    config.recallPeerScope = env.OPENVIKING_RECALL_PEER_SCOPE as RecallPeerScope;
  }
  if (env.OPENVIKING_RECALL_QUERY_EXPANSION) {
    config.recallQueryExpansion = env.OPENVIKING_RECALL_QUERY_EXPANSION as RecallQueryExpansion;
    config.recallQueryExpansionConfigured = true;
  }
  if (env.OPENVIKING_RECALL_LIMIT) {
    config.recallLimit = Number(env.OPENVIKING_RECALL_LIMIT);
    config.recallLimitConfigured = true;
  }

  config.endpoint = String(config.endpoint || DEFAULT_CONFIG.endpoint).replace(/\/+$/, "");
  config.workspacePeer = config.workspacePeer !== false;
  const effectivePeer = resolveEffectivePeerId({ cfg: config, cwd });
  config.peerId = effectivePeer.peerId;
  config.legacyPeerId = effectivePeer.legacyPeerId;
  config.recallPeerScope = config.recallPeerScope === "actor" ? "actor" : "all";
  config.recallQueryExpansion = config.recallQueryExpansion === "off" ? "off" : "auto";
  config.recallLimit = clampInteger(config.recallLimit, 1, 50, DEFAULT_CONFIG.recallLimit);
  config.recallMaxContentChars = clampInteger(
    config.recallMaxContentChars,
    100,
    5000,
    DEFAULT_CONFIG.recallMaxContentChars,
  );
  config.recallTokenBudget = clampInteger(
    config.recallTokenBudget,
    200,
    50000,
    DEFAULT_CONFIG.recallTokenBudget,
  );
  config.scoreThreshold = clampNumber(
    config.scoreThreshold,
    0,
    1,
    DEFAULT_CONFIG.scoreThreshold,
  );
  config.minQueryLength = clampInteger(
    config.minQueryLength,
    1,
    64,
    DEFAULT_CONFIG.minQueryLength,
  );
  config.profileTokenBudget = clampInteger(
    config.profileTokenBudget,
    500,
    50000,
    DEFAULT_CONFIG.profileTokenBudget,
  );
  config.commitTokenThreshold = clampInteger(
    config.commitTokenThreshold,
    1000,
    1000000,
    DEFAULT_CONFIG.commitTokenThreshold,
  );
  config.commitKeepRecentCount = clampInteger(
    config.commitKeepRecentCount,
    0,
    1000,
    DEFAULT_CONFIG.commitKeepRecentCount,
  );
  config.captureMaxLength = clampInteger(
    config.captureMaxLength,
    200,
    100000,
    DEFAULT_CONFIG.captureMaxLength,
  );
  config.captureToolMaxChars = clampInteger(
    config.captureToolMaxChars,
    200,
    1000000,
    DEFAULT_CONFIG.captureToolMaxChars,
  );
  config.requestTimeoutMs = clampInteger(
    config.requestTimeoutMs,
    1000,
    120000,
    DEFAULT_CONFIG.requestTimeoutMs,
  );
  config.mcpToolCallTimeoutMs = clampInteger(
    config.mcpToolCallTimeoutMs,
    1000,
    600000,
    DEFAULT_CONFIG.mcpToolCallTimeoutMs,
  );
  config.recallDedupTurns = clampInteger(
    config.recallDedupTurns,
    0,
    1000,
    DEFAULT_CONFIG.recallDedupTurns,
  );
  config.recallContextTimeoutMs = clampInteger(
    config.recallContextTimeoutMs,
    0,
    600000,
    DEFAULT_CONFIG.recallContextTimeoutMs,
  );
  config.recallMaxTokens = clampInteger(
    config.recallMaxTokens,
    64,
    1000000,
    DEFAULT_CONFIG.recallMaxTokens,
  );
  config.recallCompressMaxBullets = clampInteger(
    config.recallCompressMaxBullets,
    1,
    50,
    DEFAULT_CONFIG.recallCompressMaxBullets,
  );
  config.recallRewrite = RECALL_REWRITE_MODES.includes(config.recallRewrite)
    ? config.recallRewrite
    : "off";
  config.captureMode = config.captureMode === "keyword" ? "keyword" : "semantic";
  config.captureFilters = Array.isArray(config.captureFilters)
    ? config.captureFilters.filter((rule): rule is string => typeof rule === "string")
    : [];
  config.syncTurns = config.syncTurns !== false;
  config.captureAssistantTurns = config.captureAssistantTurns !== false;
  config.captureToolResults = config.captureToolResults === true;
  config.skipSubagentSessions = config.skipSubagentSessions === true;
  config.autoInject = config.autoInject !== false;
  config.injectStartupProfile = config.injectStartupProfile !== false;
  config.injectStepProfile = config.injectStepProfile !== false;
  config.autoRecall = config.autoRecall !== false;
  return config;
}

/**
 * Effective behaviour of the three injection knobs. Each is gated by the
 * master switch, so `autoInject: false` is enough to switch every automatic
 * context addition off without touching the rest of the integration
 * (SPEC §9-§11, §36).
 */
export interface InjectionPlan {
  readonly startupProfile: boolean;
  readonly stepProfile: boolean;
  readonly recall: boolean;
}

export function resolveInjectionPlan(config: ResolvedConfig): InjectionPlan {
  return {
    startupProfile: config.autoInject && config.injectStartupProfile,
    stepProfile: config.autoInject && config.injectStepProfile,
    recall: config.autoInject && config.autoRecall,
  };
}

function environmentBoolean(value: unknown, fallback: boolean): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return fallback;
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}
