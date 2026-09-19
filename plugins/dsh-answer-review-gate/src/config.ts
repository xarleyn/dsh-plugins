/**
 * Configuration surface of the dsh-answer-review-gate plugin.
 *
 * The Schemastery schema (`AnswerReviewGateConfigSchema`) is the user-facing
 * contract exposed through the Cordis named `Config` export;
 * `resolveAnswerReviewGateConfig` normalizes raw config into fully defaulted,
 * clamped values, so the gate never handles optional fields or unsafe limits.
 * Every field is documented — this is the deployment contract (`SPEC.md`,
 * "Proposed configuration").
 */

import z from "@deepseek-ai/schemastery";

/** Raw user-facing configuration. */
export interface AnswerReviewGateConfig {
  /** Master switch; when false the gate registers no listeners at all. */
  readonly enabled?: boolean;
  readonly reviewer?: {
    /**
     * `domain-expert` runs the reviewer domain configured in
     * dsh-domain-experts by stable domain id. `subagent` starts a native
     * reviewer child from this plugin's own persona/route settings.
     */
    readonly backend?: "domain-expert" | "subagent";
    /** Reviewer domain id for the `domain-expert` backend (stable id, not a display name). */
    readonly domain?: string;
    /** Subagent provider name for the `subagent` backend. */
    readonly provider?: string;
    /** Optional model override for the `subagent` backend. */
    readonly model?: string;
    /** Optional provider route override for the `subagent` backend. */
    readonly route?: string;
    /** Optional reasoning-effort override for the `subagent` backend. */
    readonly reasoningEffort?: string;
    /** Persona instruction for the `subagent` reviewer child. */
    readonly persona?: string;
    /**
     * Read-only tool allow-list for the `subagent` reviewer child. Empty
     * means the reviewer works from its own knowledge only.
     */
    readonly allowedTools?: string[];
  };
  /** Review/revision rounds per user turn before the failure policy applies (clamped 1-10). */
  readonly maxReviewRounds?: number;
  /**
   * What happens when the review could not complete (reviewer failure or
   * rounds exhausted): `open` allows the answer, `warn` allows it with a
   * mandatory unverified-answer qualification, `closed` demands a revision
   * or an explicit unverified-answer notice. Reviewer failure is never
   * converted into a PASS.
   */
  readonly failMode?: "open" | "warn" | "closed";
  /**
   * Suppress review while background delegations of the session are still
   * pending; an interim "waiting for research" turn is then never reviewed.
   */
  readonly trackBackgroundDelegations?: boolean;
  /** Candidates shorter than this many characters are not reviewed (clamped >= 1). */
  readonly minCandidateChars?: number;
  /**
   * Session-id substrings whose agents are never reviewed. Reviewer children
   * are exempt structurally (they are subagents), this list is for
   * special-casing top-level agents.
   */
  readonly excludedAgents?: string[];
  readonly audit?: {
    /** Keep an in-memory ring of review decisions. */
    readonly enabled?: boolean;
    /** Ring capacity (clamped 10-10_000). */
    readonly maxEntries?: number;
  };
}

/** Fully defaulted, clamped configuration used by the gate. */
export interface ResolvedAnswerReviewGateConfig {
  readonly enabled: boolean;
  readonly reviewer: {
    readonly backend: "domain-expert" | "subagent";
    readonly domain: string;
    readonly provider: string;
    readonly model: string;
    readonly route: string;
    readonly reasoningEffort: string;
    readonly persona: string;
    readonly allowedTools: readonly string[];
  };
  readonly maxReviewRounds: number;
  readonly failMode: "open" | "warn" | "closed";
  readonly trackBackgroundDelegations: boolean;
  readonly minCandidateChars: number;
  readonly excludedAgents: readonly string[];
  readonly audit: {
    readonly enabled: boolean;
    readonly maxEntries: number;
  };
}

/** Defaults a deployment gets with an empty config block. */
export const ANSWER_REVIEW_GATE_DEFAULTS: ResolvedAnswerReviewGateConfig = {
  enabled: true,
  reviewer: {
    backend: "domain-expert",
    domain: "answer-reviewer",
    provider: "spawn",
    model: "",
    route: "",
    reasoningEffort: "",
    persona: "",
    allowedTools: [],
  },
  maxReviewRounds: 3,
  failMode: "warn",
  trackBackgroundDelegations: true,
  minCandidateChars: 80,
  excludedAgents: [],
  audit: {
    enabled: true,
    maxEntries: 500,
  },
};

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function cleanString(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function cleanList(value: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Normalize raw config into fully defaulted, clamped values. */
export function resolveAnswerReviewGateConfig(
  raw: AnswerReviewGateConfig | undefined,
): ResolvedAnswerReviewGateConfig {
  const entry = raw ?? {};
  const reviewer = entry.reviewer ?? {};
  const audit = entry.audit ?? {};
  const defaults = ANSWER_REVIEW_GATE_DEFAULTS;
  return {
    enabled: entry.enabled !== false,
    reviewer: {
      backend: oneOf(
        reviewer.backend,
        ["domain-expert", "subagent"],
        defaults.reviewer.backend,
      ),
      domain: cleanString(reviewer.domain, defaults.reviewer.domain),
      provider: cleanString(reviewer.provider, defaults.reviewer.provider),
      model: cleanString(reviewer.model, ""),
      route: cleanString(reviewer.route, ""),
      reasoningEffort: cleanString(reviewer.reasoningEffort, ""),
      persona: cleanString(reviewer.persona, ""),
      allowedTools: cleanList(reviewer.allowedTools),
    },
    maxReviewRounds: clampInteger(
      entry.maxReviewRounds,
      1,
      10,
      defaults.maxReviewRounds,
    ),
    failMode: oneOf(
      entry.failMode,
      ["open", "warn", "closed"],
      defaults.failMode,
    ),
    trackBackgroundDelegations: entry.trackBackgroundDelegations !== false,
    minCandidateChars: clampInteger(
      entry.minCandidateChars,
      1,
      1_000_000,
      defaults.minCandidateChars,
    ),
    excludedAgents: cleanList(entry.excludedAgents),
    audit: {
      enabled: audit.enabled !== false,
      maxEntries: clampInteger(
        audit.maxEntries,
        10,
        10_000,
        defaults.audit.maxEntries,
      ),
    },
  };
}

export const AnswerReviewGateConfigSchema: z<AnswerReviewGateConfig> = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .description("Enable the independent answer review gate."),
    reviewer: z
      .object({
        backend: z
          .union([z.const("domain-expert"), z.const("subagent")])
          .default("domain-expert")
          .description(
            "Reviewer backend: a dsh-domain-experts domain or a native subagent child.",
          ),
        domain: z
          .string()
          .default("answer-reviewer")
          .description(
            "Reviewer domain id in dsh-domain-experts (stable id, not a display name).",
          ),
        provider: z
          .string()
          .default("spawn")
          .description("Subagent provider name for the subagent backend."),
        model: z
          .string()
          .default("")
          .description("Model override for the subagent reviewer."),
        route: z
          .string()
          .default("")
          .description("Provider route override for the subagent reviewer."),
        reasoningEffort: z
          .string()
          .default("")
          .description("Reasoning-effort override for the subagent reviewer."),
        persona: z
          .string()
          .default("")
          .description("Persona instruction for the subagent reviewer."),
        allowedTools: z
          .array(z.string())
          .default([])
          .description(
            "Read-only tool allow-list for the subagent reviewer; empty means no tools.",
          ),
      })
      .default({
        backend: "domain-expert",
        domain: "answer-reviewer",
        provider: "spawn",
        model: "",
        route: "",
        reasoningEffort: "",
        persona: "",
        allowedTools: [],
      }),
    maxReviewRounds: z
      .number()
      .default(3)
      .description(
        "Review/revision rounds per user turn before the failure policy applies (1-10).",
      ),
    failMode: z
      .union([z.const("open"), z.const("warn"), z.const("closed")])
      .default("warn")
      .description("Behavior when the review could not complete."),
    trackBackgroundDelegations: z
      .boolean()
      .default(true)
      .description(
        "Suppress review while the session's background delegations are pending.",
      ),
    minCandidateChars: z
      .number()
      .default(80)
      .description(
        "Candidates shorter than this many characters skip review (>= 1).",
      ),
    excludedAgents: z
      .array(z.string())
      .default([])
      .description("Session-id substrings that are never reviewed."),
    audit: z
      .object({
        enabled: z
          .boolean()
          .default(true)
          .description("Keep an in-memory audit ring of review decisions."),
        maxEntries: z
          .number()
          .default(500)
          .description("Audit ring capacity (10-10000)."),
      })
      .default({ enabled: true, maxEntries: 500 }),
  })
  .description("Independent answer review gate configuration.");
