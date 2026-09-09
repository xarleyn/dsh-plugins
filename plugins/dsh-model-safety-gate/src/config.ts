/**
 * Configuration surface of the dsh-model-safety-gate plugin (SPEC.md §4,
 * design SPEC §21, §27).
 *
 * `ModelSafetyGateConfigSchema` is the user-facing Schemastery contract
 * exposed through the Cordis `static Config`; `resolveSafetyGateConfig`
 * normalizes raw config into fully defaulted, validated values so guards and
 * the classifier service never deal with optional fields. Structurally
 * impossible config throws `SafetyGateError("SAFETY_INVALID_ARGUMENT")` at
 * load time.
 */

import z from "@deepseek-ai/schemastery";

import { SafetyGateError } from "./types.js";

/** Classifier backend kind (design SPEC §7). */
export type ClassifierBackend = "none" | "dsh" | "openai-compatible";

/** Behaviour when the classifier times out, errors, or answers garbage. */
export type FailureMode = "closed" | "open" | "rules-only" | "ask";

/** Global gate profile (design SPEC §24). */
export type GateMode = "off" | "audit" | "warn" | "enforce";

/** Streaming enforcement mode (design SPEC §11). */
export type StreamMode = "observe" | "interrupt" | "buffered";

/** Raw user-facing configuration. */
export interface ModelSafetyGateConfig {
  /** Master switch; when false nothing is scanned or blocked. */
  readonly enabled?: boolean;
  /** off | audit | warn | enforce (design SPEC §24). */
  readonly mode?: GateMode;

  readonly classifier?: {
    readonly backend?: ClassifierBackend;
    /** `backend: dsh` — provider id of the small safety model. */
    readonly provider?: string;
    /** `backend: dsh` — model id of the small safety model. */
    readonly model?: string;
    /** `backend: openai-compatible` — endpoint base URL. */
    readonly baseURL?: string;
    /** `backend: openai-compatible` — bearer API key. */
    readonly apiKey?: string;
    readonly timeoutMs?: number;
    readonly maxTokens?: number;
    readonly temperature?: number;
    readonly failureMode?: FailureMode;
    /** Forbid remote classifier endpoints entirely (design SPEC §22). */
    readonly requireLocal?: boolean;
  };

  readonly input?: {
    readonly enabled?: boolean;
    readonly safetyAction?: "allow" | "warn" | "block";
    /** Hard-blocking on usefulness requires explicit opt-in (SPEC §4). */
    readonly qualityAction?: "allow" | "warn" | "block";
  };

  readonly output?: {
    readonly enabled?: boolean;
    readonly mode?: StreamMode;
    readonly text?: boolean;
    readonly reasoning?: boolean;
    readonly checkEveryChars?: number;
    readonly windowChars?: number;
    readonly lookbehindChars?: number;
    readonly minCheckIntervalMs?: number;
    readonly maxBufferedChars?: number;
  };

  readonly tools?: {
    readonly enabled?: boolean;
    /** Also run the L1 classifier on tool calls, not just L0. */
    readonly semanticClassifier?: boolean;
    /** Scan only calls touching these tool names (empty = all). */
    readonly sensitiveTools?: readonly string[];
  };

  readonly toolResults?: {
    readonly enabled?: boolean;
    readonly classifyUntrustedSources?: boolean;
  };

  readonly audit?: {
    readonly enabled?: boolean;
    /** Opt-in raw content logging; default records hashes only (SPEC §23). */
    readonly includeRawContent?: boolean;
  };

  readonly ui?: {
    readonly enabled?: boolean;
    readonly showWarnings?: boolean;
  };

  /** false forbids per-session downgrade of the global mode (SPEC §26). */
  readonly allowSessionOverride?: boolean;

  /** L0 scan budget in characters; longer inputs are truncated for scanning. */
  readonly maxScanChars?: number;

  /** Additional regex sources scanned as hard-block rules (L0). */
  readonly customBlockPatterns?: readonly string[];
}

/** Fully resolved configuration consumed by the runtime. */
export interface ResolvedSafetyGateConfig {
  readonly enabled: boolean;
  readonly mode: GateMode;
  readonly classifier: {
    readonly backend: ClassifierBackend;
    readonly provider: string;
    readonly model: string;
    readonly baseURL: string;
    readonly apiKey: string;
    readonly timeoutMs: number;
    readonly maxTokens: number;
    readonly temperature: number;
    readonly failureMode: FailureMode;
    readonly requireLocal: boolean;
  };
  readonly input: {
    readonly enabled: boolean;
    readonly safetyAction: "allow" | "warn" | "block";
    readonly qualityAction: "allow" | "warn" | "block";
  };
  readonly output: {
    readonly enabled: boolean;
    readonly mode: StreamMode;
    readonly text: boolean;
    readonly reasoning: boolean;
    readonly checkEveryChars: number;
    readonly windowChars: number;
    readonly lookbehindChars: number;
    readonly minCheckIntervalMs: number;
    readonly maxBufferedChars: number;
  };
  readonly tools: {
    readonly enabled: boolean;
    readonly semanticClassifier: boolean;
    readonly sensitiveTools: readonly string[];
  };
  readonly toolResults: {
    readonly enabled: boolean;
    readonly classifyUntrustedSources: boolean;
  };
  readonly audit: {
    readonly enabled: boolean;
    readonly includeRawContent: boolean;
  };
  readonly ui: {
    readonly enabled: boolean;
    readonly showWarnings: boolean;
  };
  readonly allowSessionOverride: boolean;
  readonly maxScanChars: number;
  readonly customBlockPatterns: readonly string[];
}

export const SAFETY_GATE_DEFAULTS = {
  enabled: true,
  mode: "warn",
  backend: "none",
  provider: "",
  model: "",
  baseURL: "",
  apiKey: "",
  timeoutMs: 3_000,
  maxTokens: 128,
  temperature: 0,
  failureMode: "rules-only",
  requireLocal: false,
  inputEnabled: true,
  safetyAction: "block",
  qualityAction: "warn",
  outputEnabled: true,
  streamMode: "buffered",
  text: true,
  reasoning: true,
  checkEveryChars: 512,
  windowChars: 1_536,
  lookbehindChars: 768,
  minCheckIntervalMs: 250,
  maxBufferedChars: 8_192,
  toolsEnabled: true,
  semanticClassifier: true,
  sensitiveTools: [] as string[],
  toolResultsEnabled: true,
  classifyUntrustedSources: true,
  auditEnabled: true,
  includeRawContent: false,
  uiEnabled: true,
  showWarnings: true,
  allowSessionOverride: true,
  maxScanChars: 65_536,
} as const;

const GATE_MODES = ["off", "audit", "warn", "enforce"] as const;
const FAILURE_MODES = ["closed", "open", "rules-only", "ask"] as const;
const STREAM_MODES = ["observe", "interrupt", "buffered"] as const;
const BACKENDS = ["none", "dsh", "openai-compatible"] as const;
const ACTION_MODES = ["allow", "warn", "block"] as const;

function enumOr<T extends readonly string[]>(values: T, name: string, raw: string | undefined, fallback: T[number]): T[number] {
  const value = raw ?? fallback;
  if (!(values as readonly string[]).includes(value)) {
    throw new SafetyGateError("SAFETY_INVALID_ARGUMENT", `config "${name}" must be one of: ${values.join(", ")} (got ${value})`);
  }
  return value as T[number];
}

function requirePositive(name: string, value: number, minimum: number): number {
  if (!Number.isFinite(value) || value < minimum || (minimum >= 1 && !Number.isInteger(value))) {
    throw new SafetyGateError("SAFETY_INVALID_ARGUMENT", `config "${name}" must be an integer >= ${minimum}`);
  }
  return value;
}

function requireRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new SafetyGateError("SAFETY_INVALID_ARGUMENT", `config "${name}" must be a number in [${min}, ${max}]`);
  }
  return value;
}

export const ModelSafetyGateConfigSchema = z.object({
  enabled: z.boolean().default(SAFETY_GATE_DEFAULTS.enabled),
  mode: z
    .union([...GATE_MODES.map((value) => z.const(value))])
    .default(SAFETY_GATE_DEFAULTS.mode),
  classifier: z
    .object({
      backend: z
        .union([...BACKENDS.map((value) => z.const(value))])
        .default(SAFETY_GATE_DEFAULTS.backend),
      provider: z.string().default(SAFETY_GATE_DEFAULTS.provider),
      model: z.string().default(SAFETY_GATE_DEFAULTS.model),
      baseURL: z.string().default(SAFETY_GATE_DEFAULTS.baseURL),
      apiKey: z.string().default(SAFETY_GATE_DEFAULTS.apiKey),
      timeoutMs: z.number().default(SAFETY_GATE_DEFAULTS.timeoutMs),
      maxTokens: z.number().default(SAFETY_GATE_DEFAULTS.maxTokens),
      temperature: z.number().default(SAFETY_GATE_DEFAULTS.temperature),
      failureMode: z
        .union([...FAILURE_MODES.map((value) => z.const(value))])
        .default(SAFETY_GATE_DEFAULTS.failureMode),
      requireLocal: z.boolean().default(SAFETY_GATE_DEFAULTS.requireLocal),
    })
    .default({
      backend: SAFETY_GATE_DEFAULTS.backend,
      provider: SAFETY_GATE_DEFAULTS.provider,
      model: SAFETY_GATE_DEFAULTS.model,
      baseURL: SAFETY_GATE_DEFAULTS.baseURL,
      apiKey: SAFETY_GATE_DEFAULTS.apiKey,
      timeoutMs: SAFETY_GATE_DEFAULTS.timeoutMs,
      maxTokens: SAFETY_GATE_DEFAULTS.maxTokens,
      temperature: SAFETY_GATE_DEFAULTS.temperature,
      failureMode: SAFETY_GATE_DEFAULTS.failureMode,
      requireLocal: SAFETY_GATE_DEFAULTS.requireLocal,
    }),
  input: z
    .object({
      enabled: z.boolean().default(SAFETY_GATE_DEFAULTS.inputEnabled),
      safetyAction: z
        .union([...ACTION_MODES.map((value) => z.const(value))])
        .default(SAFETY_GATE_DEFAULTS.safetyAction),
      qualityAction: z
        .union([...ACTION_MODES.map((value) => z.const(value))])
        .default(SAFETY_GATE_DEFAULTS.qualityAction),
    })
    .default({
      enabled: SAFETY_GATE_DEFAULTS.inputEnabled,
      safetyAction: SAFETY_GATE_DEFAULTS.safetyAction,
      qualityAction: SAFETY_GATE_DEFAULTS.qualityAction,
    }),
  output: z
    .object({
      enabled: z.boolean().default(SAFETY_GATE_DEFAULTS.outputEnabled),
      mode: z
        .union([...STREAM_MODES.map((value) => z.const(value))])
        .default(SAFETY_GATE_DEFAULTS.streamMode),
      text: z.boolean().default(SAFETY_GATE_DEFAULTS.text),
      reasoning: z.boolean().default(SAFETY_GATE_DEFAULTS.reasoning),
      checkEveryChars: z.number().default(SAFETY_GATE_DEFAULTS.checkEveryChars),
      windowChars: z.number().default(SAFETY_GATE_DEFAULTS.windowChars),
      lookbehindChars: z.number().default(SAFETY_GATE_DEFAULTS.lookbehindChars),
      minCheckIntervalMs: z.number().default(SAFETY_GATE_DEFAULTS.minCheckIntervalMs),
      maxBufferedChars: z.number().default(SAFETY_GATE_DEFAULTS.maxBufferedChars),
    })
    .default({
      enabled: SAFETY_GATE_DEFAULTS.outputEnabled,
      mode: SAFETY_GATE_DEFAULTS.streamMode,
      text: SAFETY_GATE_DEFAULTS.text,
      reasoning: SAFETY_GATE_DEFAULTS.reasoning,
      checkEveryChars: SAFETY_GATE_DEFAULTS.checkEveryChars,
      windowChars: SAFETY_GATE_DEFAULTS.windowChars,
      lookbehindChars: SAFETY_GATE_DEFAULTS.lookbehindChars,
      minCheckIntervalMs: SAFETY_GATE_DEFAULTS.minCheckIntervalMs,
      maxBufferedChars: SAFETY_GATE_DEFAULTS.maxBufferedChars,
    }),
  tools: z
    .object({
      enabled: z.boolean().default(SAFETY_GATE_DEFAULTS.toolsEnabled),
      semanticClassifier: z.boolean().default(SAFETY_GATE_DEFAULTS.semanticClassifier),
      sensitiveTools: z.array(z.string()).default([...SAFETY_GATE_DEFAULTS.sensitiveTools]),
    })
    .default({
      enabled: SAFETY_GATE_DEFAULTS.toolsEnabled,
      semanticClassifier: SAFETY_GATE_DEFAULTS.semanticClassifier,
      sensitiveTools: [...SAFETY_GATE_DEFAULTS.sensitiveTools],
    }),
  toolResults: z
    .object({
      enabled: z.boolean().default(SAFETY_GATE_DEFAULTS.toolResultsEnabled),
      classifyUntrustedSources: z.boolean().default(SAFETY_GATE_DEFAULTS.classifyUntrustedSources),
    })
    .default({
      enabled: SAFETY_GATE_DEFAULTS.toolResultsEnabled,
      classifyUntrustedSources: SAFETY_GATE_DEFAULTS.classifyUntrustedSources,
    }),
  audit: z
    .object({
      enabled: z.boolean().default(SAFETY_GATE_DEFAULTS.auditEnabled),
      includeRawContent: z.boolean().default(SAFETY_GATE_DEFAULTS.includeRawContent),
    })
    .default({
      enabled: SAFETY_GATE_DEFAULTS.auditEnabled,
      includeRawContent: SAFETY_GATE_DEFAULTS.includeRawContent,
    }),
  ui: z
    .object({
      enabled: z.boolean().default(SAFETY_GATE_DEFAULTS.uiEnabled),
      showWarnings: z.boolean().default(SAFETY_GATE_DEFAULTS.showWarnings),
    })
    .default({
      enabled: SAFETY_GATE_DEFAULTS.uiEnabled,
      showWarnings: SAFETY_GATE_DEFAULTS.showWarnings,
    }),
  allowSessionOverride: z.boolean().default(SAFETY_GATE_DEFAULTS.allowSessionOverride),
  maxScanChars: z.number().default(SAFETY_GATE_DEFAULTS.maxScanChars),
  customBlockPatterns: z.array(z.string()).default([]),
}) as unknown as z<ModelSafetyGateConfig>;

/**
 * Resolve raw config into validated values. Throws
 * `SafetyGateError("SAFETY_INVALID_ARGUMENT")` for structurally impossible
 * combinations so misconfiguration is loud at load time.
 */
export function resolveSafetyGateConfig(input: ModelSafetyGateConfig = {}): ResolvedSafetyGateConfig {
  const mode = enumOr(GATE_MODES, "mode", input.mode, SAFETY_GATE_DEFAULTS.mode);
  const classifier = input.classifier ?? {};
  const backend = enumOr(BACKENDS, "classifier.backend", classifier.backend, SAFETY_GATE_DEFAULTS.backend);
  const failureMode = enumOr(FAILURE_MODES, "classifier.failureMode", classifier.failureMode, SAFETY_GATE_DEFAULTS.failureMode);
  const input_ = input.input ?? {};
  const output = input.output ?? {};
  const tools = input.tools ?? {};
  const toolResults = input.toolResults ?? {};
  const audit = input.audit ?? {};
  const ui = input.ui ?? {};

  const streamMode = enumOr(STREAM_MODES, "output.mode", output.mode, SAFETY_GATE_DEFAULTS.streamMode);
  const windowChars = requirePositive("output.windowChars", output.windowChars ?? SAFETY_GATE_DEFAULTS.windowChars, 128);
  const lookbehindChars = requirePositive(
    "output.lookbehindChars",
    output.lookbehindChars ?? SAFETY_GATE_DEFAULTS.lookbehindChars,
    0,
  );
  const checkEveryChars = requirePositive(
    "output.checkEveryChars",
    output.checkEveryChars ?? SAFETY_GATE_DEFAULTS.checkEveryChars,
    1,
  );
  const maxBufferedChars = requirePositive(
    "output.maxBufferedChars",
    output.maxBufferedChars ?? SAFETY_GATE_DEFAULTS.maxBufferedChars,
    windowChars,
  );

  if (backend === "dsh" && (!classifier.provider || !classifier.model)) {
    throw new SafetyGateError("SAFETY_INVALID_ARGUMENT", 'config "classifier.provider" and "classifier.model" are required for backend "dsh"');
  }
  if (backend === "openai-compatible" && !classifier.baseURL) {
    throw new SafetyGateError("SAFETY_INVALID_ARGUMENT", 'config "classifier.baseURL" is required for backend "openai-compatible"');
  }
  if (classifier.requireLocal && backend === "openai-compatible") {
    throw new SafetyGateError("SAFETY_INVALID_ARGUMENT", 'config "classifier.requireLocal" forbids the "openai-compatible" backend');
  }

  const customPatterns: string[] = [];
  for (const source of input.customBlockPatterns ?? []) {
    // Compile once here so invalid user patterns fail loudly at load time.
    try {
      new RegExp(source, "iu");
    } catch (error) {
      throw new SafetyGateError(
        "SAFETY_INVALID_ARGUMENT",
        `config "customBlockPatterns" contains an invalid regular expression: ${String((error as Error).message)}`,
        { cause: error },
      );
    }
    customPatterns.push(source);
  }

  return {
    enabled: input.enabled ?? SAFETY_GATE_DEFAULTS.enabled,
    mode,
    classifier: {
      backend,
      provider: classifier.provider ?? SAFETY_GATE_DEFAULTS.provider,
      model: classifier.model ?? SAFETY_GATE_DEFAULTS.model,
      baseURL: classifier.baseURL ?? SAFETY_GATE_DEFAULTS.baseURL,
      apiKey: classifier.apiKey ?? SAFETY_GATE_DEFAULTS.apiKey,
      timeoutMs: requirePositive("classifier.timeoutMs", classifier.timeoutMs ?? SAFETY_GATE_DEFAULTS.timeoutMs, 1),
      maxTokens: requirePositive("classifier.maxTokens", classifier.maxTokens ?? SAFETY_GATE_DEFAULTS.maxTokens, 16),
      temperature: requireRange("classifier.temperature", classifier.temperature ?? SAFETY_GATE_DEFAULTS.temperature, 0, 2),
      failureMode,
      requireLocal: classifier.requireLocal ?? SAFETY_GATE_DEFAULTS.requireLocal,
    },
    input: {
      enabled: input_.enabled ?? SAFETY_GATE_DEFAULTS.inputEnabled,
      safetyAction: enumOr(ACTION_MODES, "input.safetyAction", input_.safetyAction, SAFETY_GATE_DEFAULTS.safetyAction),
      qualityAction: enumOr(ACTION_MODES, "input.qualityAction", input_.qualityAction, SAFETY_GATE_DEFAULTS.qualityAction),
    },
    output: {
      enabled: output.enabled ?? SAFETY_GATE_DEFAULTS.outputEnabled,
      mode: streamMode,
      text: output.text ?? SAFETY_GATE_DEFAULTS.text,
      reasoning: output.reasoning ?? SAFETY_GATE_DEFAULTS.reasoning,
      checkEveryChars,
      windowChars,
      lookbehindChars,
      minCheckIntervalMs: requirePositive(
        "output.minCheckIntervalMs",
        output.minCheckIntervalMs ?? SAFETY_GATE_DEFAULTS.minCheckIntervalMs,
        0,
      ),
      maxBufferedChars,
    },
    tools: {
      enabled: tools.enabled ?? SAFETY_GATE_DEFAULTS.toolsEnabled,
      semanticClassifier: tools.semanticClassifier ?? SAFETY_GATE_DEFAULTS.semanticClassifier,
      sensitiveTools: [...(tools.sensitiveTools ?? SAFETY_GATE_DEFAULTS.sensitiveTools)],
    },
    toolResults: {
      enabled: toolResults.enabled ?? SAFETY_GATE_DEFAULTS.toolResultsEnabled,
      classifyUntrustedSources:
        toolResults.classifyUntrustedSources ?? SAFETY_GATE_DEFAULTS.classifyUntrustedSources,
    },
    audit: {
      enabled: audit.enabled ?? SAFETY_GATE_DEFAULTS.auditEnabled,
      includeRawContent: audit.includeRawContent ?? SAFETY_GATE_DEFAULTS.includeRawContent,
    },
    ui: {
      enabled: ui.enabled ?? SAFETY_GATE_DEFAULTS.uiEnabled,
      showWarnings: ui.showWarnings ?? SAFETY_GATE_DEFAULTS.showWarnings,
    },
    allowSessionOverride: input.allowSessionOverride ?? SAFETY_GATE_DEFAULTS.allowSessionOverride,
    maxScanChars: requirePositive("maxScanChars", input.maxScanChars ?? SAFETY_GATE_DEFAULTS.maxScanChars, 1_024),
    customBlockPatterns: customPatterns,
  };
}
