/**
 * Configuration surface of the kv-persist plugin (SPEC §35-§37).
 *
 * The Schemastery schema in `index.ts` is the user-facing contract; this
 * module resolves raw config into fully defaulted, validated values so the
 * rest of the plugin never deals with optional fields.
 */

import z from "@deepseek-ai/schemastery";
import { KvPersistError } from "./errors.js";

/** Raw user-facing configuration (SPEC §36). */
export interface KvPersistConfig {
  /** Master switch; when false the plugin passes every request through. */
  readonly enabled?: boolean;

  /** llama.cpp server connection. */
  readonly backend?: {
    readonly type?: "llama.cpp";
    readonly baseURL?: string;
    /** Management-API key; never logged. */
    readonly apiKey?: string;
    /** Bounded timeout for every persistence HTTP call (SPEC §59). */
    readonly requestTimeoutMs?: number;
  };

  /**
   * Explicit managed provider routes (SPEC §37). Requests to any other
   * provider pass through untouched. Default: none (plugin inert).
   */
  readonly providers?: readonly string[];

  /** v0.1 supports single-slot only (SPEC §8). */
  readonly mode?: "single-slot" | "managed-slots";

  /** Physical slot used in single-slot mode. */
  readonly slotId?: number;

  /**
   * Manual runtime identity escape hatch (SPEC §15): changing it makes all
   * previously saved snapshots invisible without deleting them.
   */
  readonly runtimeKey?: string;

  /** Checkpoint policy (SPEC §26). */
  readonly checkpoint?: {
    /** Save a dirty slot before reassigning it. Default: true. */
    readonly onSwitch?: boolean;
    /** Final checkpoint during Cordis disposal. Default: true. */
    readonly onShutdown?: boolean;
    /** Checkpoint on the session/flush durability event. Default: true. */
    readonly onSessionFlush?: boolean;
    /** Save dirty state after this many idle milliseconds; 0 disables. Default: 30000. */
    readonly idleMs?: number;
    /** Checkpoint after every completed user turn. Default: false. */
    readonly onTurnEnd?: boolean;
    /** Reserved for future per-step checkpoints. Default: false. */
    readonly onStepEnd?: boolean;
  };

  /** Restore behavior (SPEC §23-§24). */
  readonly restore?: {
    /** Restore compatible snapshots before a session's first request. Default: true. */
    readonly enabled?: boolean;
    /** Validate restored state (n_restored) after an HTTP 200. Default: true. */
    readonly verify?: boolean;
  };

  /** Failure policy and circuit breaker (SPEC §32-§33). */
  readonly failure?: {
    /** Turn persistence failures into request failures. Default: false. */
    readonly strict?: boolean;
    /** Consecutive failures before the circuit opens. Default: 3. */
    readonly maxConsecutiveFailures?: number;
    /** Circuit open duration in milliseconds. Default: 60000. */
    readonly cooldownMs?: number;
  };

  /** Local metadata storage (SPEC §39). */
  readonly metadata?: {
    /** Absolute metadata directory; blank uses `<$DSH_HOME>/cache/dsh-kv-persist`. */
    readonly path?: string;
  };

  /** Structured logging verbosity. */
  readonly logging?: {
    /** `debug`, `info`, or `off`. Default: `info`. */
    readonly level?: "debug" | "info" | "off";
  };
}

/** Fully resolved configuration. */
export interface ResolvedKvPersistConfig {
  readonly enabled: boolean;
  readonly backendType: "llama.cpp";
  readonly baseURL: string;
  readonly apiKey: string | null;
  readonly requestTimeoutMs: number;
  readonly providers: readonly string[];
  readonly mode: "single-slot" | "managed-slots";
  readonly slotId: number;
  readonly runtimeKey: string | null;
  readonly checkpoint: {
    readonly onSwitch: boolean;
    readonly onShutdown: boolean;
    readonly onSessionFlush: boolean;
    readonly idleMs: number;
    readonly onTurnEnd: boolean;
    readonly onStepEnd: boolean;
  };
  readonly restore: {
    readonly enabled: boolean;
    readonly verify: boolean;
  };
  readonly failure: {
    readonly strict: boolean;
    readonly maxConsecutiveFailures: number;
    readonly cooldownMs: number;
  };
  readonly metadataPath: string | null;
  readonly logLevel: "debug" | "info" | "off";
}

export const KV_PERSIST_DEFAULTS = {
  enabled: true,
  baseURL: "http://127.0.0.1:8080",
  requestTimeoutMs: 15_000,
  mode: "single-slot",
  slotId: 0,
  onSwitch: true,
  onShutdown: true,
  onSessionFlush: true,
  idleMs: 30_000,
  onTurnEnd: false,
  onStepEnd: false,
  restoreEnabled: true,
  restoreVerify: true,
  strict: false,
  maxConsecutiveFailures: 3,
  cooldownMs: 60_000,
  logLevel: "info",
} as const;

function requireInt(
  name: string,
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum) {
    throw new KvPersistError("KV_INVARIANT", `config "${name}" must be an integer >= ${minimum}`);
  }
  return value;
}

function requirePositiveMs(name: string, value: number | undefined, fallback: number): number {
  return requireInt(name, value, fallback, 1);
}

/**
 * Resolve raw config into validated values. Throws `KV_INVARIANT` failures
 * for structurally impossible config so misconfiguration is loud (SPEC §32
 * only applies to runtime persistence failures, not to broken config).
 */
export function resolveKvPersistConfig(input: KvPersistConfig = {}): ResolvedKvPersistConfig {
  if (input.backend?.type !== undefined && input.backend.type !== "llama.cpp") {
    throw new KvPersistError(
      "KV_BACKEND_UNSUPPORTED",
      `backend type "${String(input.backend.type)}" is not supported in v0.1 (SPEC §12)`,
    );
  }
  if (input.mode !== undefined && input.mode !== "single-slot" && input.mode !== "managed-slots") {
    throw new KvPersistError("KV_INVARIANT", `unknown mode "${String(input.mode)}"`);
  }
  if (input.mode === "managed-slots") {
    throw new KvPersistError(
      "KV_BACKEND_UNSUPPORTED",
      'mode "managed-slots" is planned for v0.3 (SPEC §63); v0.1 supports only "single-slot"',
    );
  }
  const logLevel = input.logging?.level ?? KV_PERSIST_DEFAULTS.logLevel;
  if (logLevel !== "debug" && logLevel !== "info" && logLevel !== "off") {
    throw new KvPersistError("KV_INVARIANT", `unknown logging.level "${String(logLevel)}"`);
  }

  const baseURL = (input.backend?.baseURL ?? KV_PERSIST_DEFAULTS.baseURL).trim();
  if (baseURL.length === 0) {
    throw new KvPersistError("KV_INVARIANT", "backend.baseURL must not be blank");
  }

  return {
    enabled: input.enabled ?? KV_PERSIST_DEFAULTS.enabled,
    backendType: input.backend?.type ?? "llama.cpp",
    baseURL: baseURL.replace(/\/+$/, ""),
    apiKey: input.backend?.apiKey && input.backend.apiKey.length > 0 ? input.backend.apiKey : null,
    requestTimeoutMs: requirePositiveMs(
      "backend.requestTimeoutMs",
      input.backend?.requestTimeoutMs,
      KV_PERSIST_DEFAULTS.requestTimeoutMs,
    ),
    providers: (input.providers ?? []).filter((p) => p.length > 0),
    mode: input.mode ?? KV_PERSIST_DEFAULTS.mode,
    slotId: requireInt("slotId", input.slotId, KV_PERSIST_DEFAULTS.slotId, 0),
    runtimeKey: input.runtimeKey && input.runtimeKey.length > 0 ? input.runtimeKey : null,
    checkpoint: {
      onSwitch: input.checkpoint?.onSwitch ?? KV_PERSIST_DEFAULTS.onSwitch,
      onShutdown: input.checkpoint?.onShutdown ?? KV_PERSIST_DEFAULTS.onShutdown,
      onSessionFlush: input.checkpoint?.onSessionFlush ?? KV_PERSIST_DEFAULTS.onSessionFlush,
      idleMs: requireInt("checkpoint.idleMs", input.checkpoint?.idleMs, KV_PERSIST_DEFAULTS.idleMs, 0),
      onTurnEnd: input.checkpoint?.onTurnEnd ?? KV_PERSIST_DEFAULTS.onTurnEnd,
      onStepEnd: input.checkpoint?.onStepEnd ?? KV_PERSIST_DEFAULTS.onStepEnd,
    },
    restore: {
      enabled: input.restore?.enabled ?? KV_PERSIST_DEFAULTS.restoreEnabled,
      verify: input.restore?.verify ?? KV_PERSIST_DEFAULTS.restoreVerify,
    },
    failure: {
      strict: input.failure?.strict ?? KV_PERSIST_DEFAULTS.strict,
      maxConsecutiveFailures: requireInt(
        "failure.maxConsecutiveFailures",
        input.failure?.maxConsecutiveFailures,
        KV_PERSIST_DEFAULTS.maxConsecutiveFailures,
        1,
      ),
      cooldownMs: requireInt(
        "failure.cooldownMs",
        input.failure?.cooldownMs,
        KV_PERSIST_DEFAULTS.cooldownMs,
        1,
      ),
    },
    metadataPath:
      input.metadata?.path && input.metadata.path.trim().length > 0
        ? input.metadata.path.trim()
        : null,
    logLevel,
  };
}

/** True when the request route is explicitly managed (SPEC §37). */
export function isManagedProvider(config: ResolvedKvPersistConfig, provider: string): boolean {
  return config.providers.includes(provider);
}

/**
 * Schemastery contract shown in DSH settings; every field is optional with a
 * default so partial user config resolves. `resolveKvPersistConfig` remains
 * the single source of truth for actual values (SPEC §36).
 */
export const KvPersistConfigSchema = z.object({
  enabled: z.boolean().default(true),
  backend: z
    .object({
      type: z.const("llama.cpp").default("llama.cpp"),
      baseURL: z.string().default(KV_PERSIST_DEFAULTS.baseURL),
      apiKey: z.string().default(""),
      requestTimeoutMs: z.number().default(KV_PERSIST_DEFAULTS.requestTimeoutMs),
    })
    .default({
      type: "llama.cpp",
      baseURL: KV_PERSIST_DEFAULTS.baseURL,
      apiKey: "",
      requestTimeoutMs: KV_PERSIST_DEFAULTS.requestTimeoutMs,
    }),
  providers: z.array(z.string()).default([]),
  mode: z.const("single-slot").default("single-slot"),
  slotId: z.number().default(KV_PERSIST_DEFAULTS.slotId),
  runtimeKey: z.string().default(""),
  checkpoint: z
    .object({
      onSwitch: z.boolean().default(KV_PERSIST_DEFAULTS.onSwitch),
      onShutdown: z.boolean().default(KV_PERSIST_DEFAULTS.onShutdown),
      onSessionFlush: z.boolean().default(KV_PERSIST_DEFAULTS.onSessionFlush),
      idleMs: z.number().default(KV_PERSIST_DEFAULTS.idleMs),
      onTurnEnd: z.boolean().default(KV_PERSIST_DEFAULTS.onTurnEnd),
      onStepEnd: z.boolean().default(KV_PERSIST_DEFAULTS.onStepEnd),
    })
    .default({
      onSwitch: KV_PERSIST_DEFAULTS.onSwitch,
      onShutdown: KV_PERSIST_DEFAULTS.onShutdown,
      onSessionFlush: KV_PERSIST_DEFAULTS.onSessionFlush,
      idleMs: KV_PERSIST_DEFAULTS.idleMs,
      onTurnEnd: KV_PERSIST_DEFAULTS.onTurnEnd,
      onStepEnd: KV_PERSIST_DEFAULTS.onStepEnd,
    }),
  restore: z
    .object({
      enabled: z.boolean().default(KV_PERSIST_DEFAULTS.restoreEnabled),
      verify: z.boolean().default(KV_PERSIST_DEFAULTS.restoreVerify),
    })
    .default({ enabled: KV_PERSIST_DEFAULTS.restoreEnabled, verify: KV_PERSIST_DEFAULTS.restoreVerify }),
  failure: z
    .object({
      strict: z.boolean().default(KV_PERSIST_DEFAULTS.strict),
      maxConsecutiveFailures: z.number().default(KV_PERSIST_DEFAULTS.maxConsecutiveFailures),
      cooldownMs: z.number().default(KV_PERSIST_DEFAULTS.cooldownMs),
    })
    .default({
      strict: KV_PERSIST_DEFAULTS.strict,
      maxConsecutiveFailures: KV_PERSIST_DEFAULTS.maxConsecutiveFailures,
      cooldownMs: KV_PERSIST_DEFAULTS.cooldownMs,
    }),
  metadata: z
    .object({
      path: z.string().default(""),
    })
    .default({ path: "" }),
  logging: z
    .object({
      level: z.union([z.const("debug"), z.const("info"), z.const("off")]).default("info"),
    })
    .default({ level: "info" }),
});
