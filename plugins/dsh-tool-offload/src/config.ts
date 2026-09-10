/**
 * Configuration surface of the dsh-tool-offload plugin (SPEC §13-§16, §23-§24).
 *
 * The Schemastery schema (`ToolOffloadConfigSchema`) is the user-facing
 * contract exposed through the Cordis `static Config`; `resolveToolOffloadConfig`
 * normalizes raw config into fully defaulted, validated values so the rest of
 * the plugin never deals with optional fields. Structurally impossible config
 * (unknown worker/prompt references, inverted bounds) throws `OffloadError`
 * ("OFFLOAD_INVALID_ARGUMENT") so misconfiguration is loud at load time,
 * while runtime worker failures fail open later (SPEC §22).
 */

import z from "@deepseek-ai/schemastery";

import { OffloadError } from "./errors.js";
import { BUNDLED_PROMPT_PROFILES } from "./prompts/profiles.js";

/** Raw user-facing configuration (SPEC §15). */
export interface ToolOffloadConfig {
  /** Master switch; when false every tool result passes through untouched. */
  readonly enabled?: boolean;
  readonly routing?: {
    /**
     * `allowlist` (default) offloads only tools listed in `allow`;
     * `denylist` offloads everything not listed in `deny`.
     */
    readonly mode?: "allowlist" | "denylist";
    /** Tool names matched exactly or by `prefix*` glob (SPEC §10.2). */
    readonly allow?: readonly string[];
    /** Tool names never offloaded; wins over `allow`. */
    readonly deny?: readonly string[];
    /** A result qualifies when either threshold is exceeded (SPEC §11). */
    readonly thresholds?: {
      readonly minBytes?: number;
      readonly minEstimatedTokens?: number;
    };
    /**
     * Ordered selection rules (SPEC §16); first matching rule wins. Rules
     * only pick worker/prompt or force passthrough — the global thresholds
     * still gate eligibility.
     */
    readonly rules?: readonly OffloadRuleConfig[];
  };
  /** Named worker profiles; `default` is always present (SPEC §13). */
  readonly workers?: Readonly<Record<string, WorkerProfileConfig>>;
  /** Worker profile used when no rule selects one. Default: `default`. */
  readonly defaultWorker?: string;
  readonly context?: {
    /** Pass the latest user task message to the worker (SPEC §9.3). */
    readonly includeLastUserMessage?: boolean;
    /** Byte cap applied to the extracted parent task. */
    readonly maxParentContextBytes?: number;
  };
  /** Results larger than `maxBytes` pass through instead of offloading (SPEC §12.1). */
  readonly payload?: {
    readonly maxBytes?: number;
  };
  readonly validation?: {
    /** Worker answers above this byte size are rejected (SPEC §9.6). */
    readonly maxOutputBytes?: number;
    /** Reject answers that did not actually shrink the result. */
    readonly requireReduction?: boolean;
    /** Required relative shrink, e.g. `0.15` = at least 15% smaller. */
    readonly minReductionRatio?: number;
  };
  readonly fallback?: {
    /** `original` (default), `truncate`, or `error` (SPEC §9.7). */
    readonly mode?: "original" | "truncate" | "error";
  };
  /** Prefix compact answers with a machine-generated marker (SPEC §6.4). */
  readonly annotation?: {
    readonly enabled?: boolean;
  };
  /** Non-blocking worker budgets (SPEC §24). */
  readonly concurrency?: {
    readonly maxWorkersPerAgent?: number;
    readonly maxWorkersGlobal?: number;
  };
  /** Custom "Your job" prompt sections keyed by profile name (SPEC §14). */
  readonly prompts?: Readonly<Record<string, string>>;
  /** Structured event logging; counters stay on either way. */
  readonly telemetry?: {
    readonly enabled?: boolean;
  };
}

export interface OffloadRuleConfig {
  /** Stable identifier surfaced in telemetry. */
  readonly id?: string;
  readonly match?: {
    /** Tool names (exact or `prefix*`); empty matches every tool. */
    readonly tools?: readonly string[];
    /** Additional byte floor for this rule. */
    readonly minBytes?: number;
  };
  readonly action?: "offload" | "passthrough";
  /** Worker profile name; defaults to `defaultWorker`. */
  readonly worker?: string;
  /** Prompt profile name; defaults to `generic`. */
  readonly prompt?: string;
}

export interface WorkerProfileConfig {
  /** DSH subagent provider; must support tool restrictions (`spawn`). */
  readonly subagentProvider?: string;
  /** Model provider route; omitted inherits the parent agent's route. */
  readonly provider?: string | null;
  /** Model id; omitted inherits the parent agent's model. */
  readonly model?: string | null;
  /** Output token cap for the worker. */
  readonly maxTokens?: number | null;
  /** Bounded worker timeout in milliseconds (SPEC §23). */
  readonly timeoutMs?: number;
}

/** Fully resolved configuration consumed by the runtime. */
export interface ResolvedToolOffloadConfig {
  readonly enabled: boolean;
  readonly routing: {
    readonly mode: "allowlist" | "denylist";
    readonly allow: readonly string[];
    readonly deny: readonly string[];
    readonly thresholds: { readonly minBytes: number; readonly minEstimatedTokens: number };
    readonly rules: readonly ResolvedOffloadRule[];
  };
  readonly workers: Readonly<Record<string, ResolvedWorkerProfile>>;
  readonly defaultWorker: string;
  readonly context: { readonly includeLastUserMessage: boolean; readonly maxParentContextBytes: number };
  readonly payload: { readonly maxBytes: number };
  readonly validation: {
    readonly maxOutputBytes: number;
    readonly requireReduction: boolean;
    readonly minReductionRatio: number;
  };
  readonly fallback: { readonly mode: "original" | "truncate" | "error" };
  readonly annotation: { readonly enabled: boolean };
  readonly concurrency: { readonly maxWorkersPerAgent: number; readonly maxWorkersGlobal: number };
  readonly prompts: Readonly<Record<string, string>>;
  readonly telemetry: { readonly enabled: boolean };
}

export interface ResolvedOffloadRule {
  readonly id: string;
  readonly tools: readonly string[];
  readonly minBytes: number | null;
  readonly action: "offload" | "passthrough";
  readonly worker: string;
  readonly prompt: string;
}

export interface ResolvedWorkerProfile {
  readonly subagentProvider: string;
  /** `null` inherits the parent agent's provider/model route. */
  readonly provider: string | null;
  readonly model: string | null;
  readonly maxTokens: number | null;
  readonly timeoutMs: number;
}

export const TOOL_OFFLOAD_DEFAULTS = {
  enabled: true,
  mode: "allowlist",
  // Conservative defaults from SPEC §10.2; exact names must match the DSH
  // composition in use — adjust via config (SPEC §40.6).
  allow: ["read", "grep", "search", "web_fetch"],
  deny: ["bash"],
  minBytes: 24_000,
  minEstimatedTokens: 6_000,
  defaultWorker: "default",
  workerProvider: null,
  workerModel: null,
  workerMaxTokens: 4_000,
  workerTimeoutMs: 45_000,
  includeLastUserMessage: true,
  maxParentContextBytes: 12_000,
  payloadMaxBytes: 300_000,
  maxOutputBytes: 20_000,
  requireReduction: true,
  minReductionRatio: 0.15,
  fallbackMode: "original",
  annotationEnabled: false,
  maxWorkersPerAgent: 3,
  maxWorkersGlobal: 8,
  telemetryEnabled: true,
} as const;

/**
 * Built-in selection rules (SPEC §42): map default tool candidates to their
 * bundled prompt profiles. Evaluated after user rules; unmatched results fall
 * back to the default worker with the `generic` prompt.
 */
const BUILT_IN_RULE_TOOLS = [
  { id: "built-in:web-reader", tools: ["web_fetch"], prompt: "web-reader" },
  { id: "built-in:search-results", tools: ["grep", "search"], prompt: "search-results" },
  { id: "built-in:code-reader", tools: ["read"], prompt: "code-reader" },
] as const;

const WORKER_PROFILE_DEFAULTS: ResolvedWorkerProfile = {
  subagentProvider: "spawn",
  provider: TOOL_OFFLOAD_DEFAULTS.workerProvider,
  model: TOOL_OFFLOAD_DEFAULTS.workerModel,
  maxTokens: TOOL_OFFLOAD_DEFAULTS.workerMaxTokens,
  timeoutMs: TOOL_OFFLOAD_DEFAULTS.workerTimeoutMs,
};

const nullableString = z.union([z.string(), z.const(null)]);
const nullableNumber = z.union([z.number(), z.const(null)]);

const workerProfileSchema = z
  .object({
    subagentProvider: z.string().default(WORKER_PROFILE_DEFAULTS.subagentProvider),
    provider: nullableString.default(WORKER_PROFILE_DEFAULTS.provider),
    model: nullableString.default(WORKER_PROFILE_DEFAULTS.model),
    maxTokens: nullableNumber.default(WORKER_PROFILE_DEFAULTS.maxTokens),
    timeoutMs: z.number().default(WORKER_PROFILE_DEFAULTS.timeoutMs),
  })
  .default({
    subagentProvider: WORKER_PROFILE_DEFAULTS.subagentProvider,
    provider: WORKER_PROFILE_DEFAULTS.provider,
    model: WORKER_PROFILE_DEFAULTS.model,
    maxTokens: WORKER_PROFILE_DEFAULTS.maxTokens,
    timeoutMs: WORKER_PROFILE_DEFAULTS.timeoutMs,
  });

export const ToolOffloadConfigSchema = z.object({
  enabled: z.boolean().default(TOOL_OFFLOAD_DEFAULTS.enabled),
  routing: z
    .object({
      mode: z.union([z.const("allowlist"), z.const("denylist")]).default(TOOL_OFFLOAD_DEFAULTS.mode),
      allow: z.array(z.string()).default([...TOOL_OFFLOAD_DEFAULTS.allow]),
      deny: z.array(z.string()).default([...TOOL_OFFLOAD_DEFAULTS.deny]),
      thresholds: z
        .object({
          minBytes: z.number().default(TOOL_OFFLOAD_DEFAULTS.minBytes),
          minEstimatedTokens: z.number().default(TOOL_OFFLOAD_DEFAULTS.minEstimatedTokens),
        })
        .default({
          minBytes: TOOL_OFFLOAD_DEFAULTS.minBytes,
          minEstimatedTokens: TOOL_OFFLOAD_DEFAULTS.minEstimatedTokens,
        }),
      rules: z
        .array(
          z.object({
            id: z.string().default(""),
            match: z
              .object({
                tools: z.array(z.string()).default([]),
                minBytes: nullableNumber.default(null),
              })
              .default({ tools: [], minBytes: null }),
            action: z.union([z.const("offload"), z.const("passthrough")]).default("offload"),
            worker: nullableString.default(null),
            prompt: nullableString.default(null),
          }),
        )
        .default([]),
    })
    .default({
      mode: TOOL_OFFLOAD_DEFAULTS.mode,
      allow: [...TOOL_OFFLOAD_DEFAULTS.allow],
      deny: [...TOOL_OFFLOAD_DEFAULTS.deny],
      thresholds: { minBytes: TOOL_OFFLOAD_DEFAULTS.minBytes, minEstimatedTokens: TOOL_OFFLOAD_DEFAULTS.minEstimatedTokens },
      rules: [],
    }),
  workers: z.dict(workerProfileSchema).default({}),
  defaultWorker: z.string().default(TOOL_OFFLOAD_DEFAULTS.defaultWorker),
  context: z
    .object({
      includeLastUserMessage: z.boolean().default(TOOL_OFFLOAD_DEFAULTS.includeLastUserMessage),
      maxParentContextBytes: z.number().default(TOOL_OFFLOAD_DEFAULTS.maxParentContextBytes),
    })
    .default({
      includeLastUserMessage: TOOL_OFFLOAD_DEFAULTS.includeLastUserMessage,
      maxParentContextBytes: TOOL_OFFLOAD_DEFAULTS.maxParentContextBytes,
    }),
  payload: z
    .object({ maxBytes: z.number().default(TOOL_OFFLOAD_DEFAULTS.payloadMaxBytes) })
    .default({ maxBytes: TOOL_OFFLOAD_DEFAULTS.payloadMaxBytes }),
  validation: z
    .object({
      maxOutputBytes: z.number().default(TOOL_OFFLOAD_DEFAULTS.maxOutputBytes),
      requireReduction: z.boolean().default(TOOL_OFFLOAD_DEFAULTS.requireReduction),
      minReductionRatio: z.number().default(TOOL_OFFLOAD_DEFAULTS.minReductionRatio),
    })
    .default({
      maxOutputBytes: TOOL_OFFLOAD_DEFAULTS.maxOutputBytes,
      requireReduction: TOOL_OFFLOAD_DEFAULTS.requireReduction,
      minReductionRatio: TOOL_OFFLOAD_DEFAULTS.minReductionRatio,
    }),
  fallback: z
    .object({
      mode: z.union([z.const("original"), z.const("truncate"), z.const("error")]).default(TOOL_OFFLOAD_DEFAULTS.fallbackMode),
    })
    .default({ mode: TOOL_OFFLOAD_DEFAULTS.fallbackMode }),
  annotation: z
    .object({ enabled: z.boolean().default(TOOL_OFFLOAD_DEFAULTS.annotationEnabled) })
    .default({ enabled: TOOL_OFFLOAD_DEFAULTS.annotationEnabled }),
  concurrency: z
    .object({
      maxWorkersPerAgent: z.number().default(TOOL_OFFLOAD_DEFAULTS.maxWorkersPerAgent),
      maxWorkersGlobal: z.number().default(TOOL_OFFLOAD_DEFAULTS.maxWorkersGlobal),
    })
    .default({
      maxWorkersPerAgent: TOOL_OFFLOAD_DEFAULTS.maxWorkersPerAgent,
      maxWorkersGlobal: TOOL_OFFLOAD_DEFAULTS.maxWorkersGlobal,
    }),
  prompts: z.dict(z.string()).default({}),
  telemetry: z
    .object({ enabled: z.boolean().default(TOOL_OFFLOAD_DEFAULTS.telemetryEnabled) })
    .default({ enabled: TOOL_OFFLOAD_DEFAULTS.telemetryEnabled }),
}) as unknown as z<ToolOffloadConfig>;

function requirePositiveInt(name: string, value: number, minimum: number): number {
  if (!Number.isFinite(value) || value < minimum || !Number.isInteger(value)) {
    throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "${name}" must be an integer >= ${minimum}`);
  }
  return value;
}

function requireRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "${name}" must be between ${min} and ${max}`);
  }
  return value;
}

function requireNonEmptyPatterns(name: string, patterns: readonly string[]): string[] {
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || pattern.trim() === "") {
      throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "${name}" must contain non-empty tool patterns`);
    }
  }
  return [...patterns];
}

/**
 * Resolve raw config into validated values. Unknown worker or prompt profile
 * references in rules fail loudly here so routing can stay total at runtime.
 */
export function resolveToolOffloadConfig(input: ToolOffloadConfig = {}): ResolvedToolOffloadConfig {
  const routing = input.routing ?? {};
  const thresholds = {
    minBytes: requirePositiveInt("routing.thresholds.minBytes", routing.thresholds?.minBytes ?? TOOL_OFFLOAD_DEFAULTS.minBytes, 1),
    minEstimatedTokens: requirePositiveInt(
      "routing.thresholds.minEstimatedTokens",
      routing.thresholds?.minEstimatedTokens ?? TOOL_OFFLOAD_DEFAULTS.minEstimatedTokens,
      1,
    ),
  };
  const mode = routing.mode ?? TOOL_OFFLOAD_DEFAULTS.mode;
  if (mode !== "allowlist" && mode !== "denylist") {
    throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "routing.mode" must be allowlist or denylist (got ${String(mode)})`);
  }

  const resolvedWorkers: Record<string, ResolvedWorkerProfile> = {
    default: { ...WORKER_PROFILE_DEFAULTS },
  };
  for (const [name, profile] of Object.entries(input.workers ?? {})) {
    resolvedWorkers[name] = {
      subagentProvider: profile.subagentProvider?.trim() || WORKER_PROFILE_DEFAULTS.subagentProvider,
      provider: profile.provider ?? WORKER_PROFILE_DEFAULTS.provider,
      model: profile.model ?? WORKER_PROFILE_DEFAULTS.model,
      maxTokens: profile.maxTokens === null || profile.maxTokens === undefined ? WORKER_PROFILE_DEFAULTS.maxTokens : requirePositiveInt(`workers.${name}.maxTokens`, profile.maxTokens, 1),
      timeoutMs: requirePositiveInt(`workers.${name}.timeoutMs`, profile.timeoutMs ?? WORKER_PROFILE_DEFAULTS.timeoutMs, 100),
    };
  }
  const defaultWorker = input.defaultWorker ?? TOOL_OFFLOAD_DEFAULTS.defaultWorker;
  if (!(defaultWorker in resolvedWorkers)) {
    throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "defaultWorker" references unknown worker profile "${defaultWorker}"`);
  }

  const prompts: Record<string, string> = {};
  for (const [name, job] of Object.entries(input.prompts ?? {})) {
    if (typeof job !== "string" || job.trim() === "") {
      throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "prompts.${name}" must be a non-empty string`);
    }
    prompts[name] = job;
  }
  const resolvePromptName = (name: string, source: string): string => {
    if (name in prompts || name in BUNDLED_PROMPT_PROFILES) return name;
    throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "${source}" references unknown prompt profile "${name}"`);
  };

  const userRules: ResolvedOffloadRule[] = (routing.rules ?? []).map((rule, index) => {
    const id = rule.id?.trim() || `rule-${index + 1}`;
    const minBytes = rule.match?.minBytes ?? null;
    const action = rule.action ?? "offload";
    if (action !== "offload" && action !== "passthrough") {
      throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "routing.rules.${id}.action" must be offload or passthrough`);
    }
    const worker = rule.worker ?? defaultWorker;
    if (!(worker in resolvedWorkers)) {
      throw new OffloadError("OFFLOAD_INVALID_ARGUMENT", `config "routing.rules.${id}.worker" references unknown worker profile "${worker}"`);
    }
    const prompt = resolvePromptName(rule.prompt ?? "generic", `routing.rules.${id}.prompt`);
    return {
      id,
      tools: requireNonEmptyPatterns(`routing.rules.${id}.match.tools`, rule.match?.tools ?? []),
      minBytes: minBytes === null ? null : requirePositiveInt(`routing.rules.${id}.match.minBytes`, minBytes, 1),
      action,
      worker,
      prompt,
    };
  });
  const builtInRules: ResolvedOffloadRule[] = BUILT_IN_RULE_TOOLS.map((rule) => ({
    id: rule.id,
    tools: [...rule.tools],
    minBytes: null,
    action: "offload",
    worker: defaultWorker,
    prompt: resolvePromptName(rule.prompt, `built-in rule ${rule.id}`),
  }));

  const minReductionRatio = requireRange(
    "validation.minReductionRatio",
    input.validation?.minReductionRatio ?? TOOL_OFFLOAD_DEFAULTS.minReductionRatio,
    0,
    0.95,
  );

  return {
    enabled: input.enabled ?? TOOL_OFFLOAD_DEFAULTS.enabled,
    routing: {
      mode,
      allow: requireNonEmptyPatterns("routing.allow", routing.allow ?? TOOL_OFFLOAD_DEFAULTS.allow),
      deny: requireNonEmptyPatterns("routing.deny", routing.deny ?? TOOL_OFFLOAD_DEFAULTS.deny),
      thresholds,
      rules: [...userRules, ...builtInRules],
    },
    workers: resolvedWorkers,
    defaultWorker,
    context: {
      includeLastUserMessage: input.context?.includeLastUserMessage ?? TOOL_OFFLOAD_DEFAULTS.includeLastUserMessage,
      maxParentContextBytes: requirePositiveInt(
        "context.maxParentContextBytes",
        input.context?.maxParentContextBytes ?? TOOL_OFFLOAD_DEFAULTS.maxParentContextBytes,
        256,
      ),
    },
    payload: {
      maxBytes: requirePositiveInt("payload.maxBytes", input.payload?.maxBytes ?? TOOL_OFFLOAD_DEFAULTS.payloadMaxBytes, 1024),
    },
    validation: {
      maxOutputBytes: requirePositiveInt(
        "validation.maxOutputBytes",
        input.validation?.maxOutputBytes ?? TOOL_OFFLOAD_DEFAULTS.maxOutputBytes,
        256,
      ),
      requireReduction: input.validation?.requireReduction ?? TOOL_OFFLOAD_DEFAULTS.requireReduction,
      minReductionRatio,
    },
    fallback: { mode: input.fallback?.mode ?? TOOL_OFFLOAD_DEFAULTS.fallbackMode },
    annotation: { enabled: input.annotation?.enabled ?? TOOL_OFFLOAD_DEFAULTS.annotationEnabled },
    concurrency: {
      maxWorkersPerAgent: requirePositiveInt(
        "concurrency.maxWorkersPerAgent",
        input.concurrency?.maxWorkersPerAgent ?? TOOL_OFFLOAD_DEFAULTS.maxWorkersPerAgent,
        1,
      ),
      maxWorkersGlobal: requirePositiveInt(
        "concurrency.maxWorkersGlobal",
        input.concurrency?.maxWorkersGlobal ?? TOOL_OFFLOAD_DEFAULTS.maxWorkersGlobal,
        1,
      ),
    },
    prompts,
    telemetry: { enabled: input.telemetry?.enabled ?? TOOL_OFFLOAD_DEFAULTS.telemetryEnabled },
  };
}

/** Bundled prompt profiles live in `prompts/profiles.ts`; config only validates references. */
