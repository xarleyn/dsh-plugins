/**
 * The deterministic L0 scanner (design SPEC §6, §38).
 *
 * Runs the compiled injection, secret, obfuscation, flood, and user rule set
 * over folded text plus decoded encoding candidates. No model calls, bounded
 * work: inputs are truncated to the configured scan budget, decoded
 * candidates are capped, and every rule is a single linear regex pass.
 *
 * False-positive control: matches that fall entirely inside quoted or fenced
 * code spans (`, ', «», “”, ``` fences) are downgraded from `block` to
 * `warn` — discussing or quoting an attack is not performing it.
 */

import type { ScanFinding, ScanResult, SafetyCategory, SafetyDecision } from "../types.js";
import { DECISION_ORDER, SafetyGateError } from "../types.js";
import { compileInjectionRule, INJECTION_RULES, type InjectionRule } from "./injection.js";
import { decodeEncodings, foldText } from "./normalize.js";
import { findHighEntropyTokens, SECRET_RULES } from "./secrets.js";

export interface ScannerOptions {
  /** Scan budget in characters; content beyond this is truncated. */
  readonly maxScanChars: number;
  /** User-configured sources compiled as hard-block rules. */
  readonly customBlockPatterns?: readonly string[];
}

interface CompiledRule {
  readonly id: string;
  readonly category: SafetyCategory;
  readonly severity: Extract<SafetyDecision, "warn" | "block">;
  readonly confidence: number;
  readonly regex: RegExp;
}

function compile(rule: InjectionRule): CompiledRule {
  return {
    id: rule.id,
    category: rule.category,
    severity: rule.severity,
    confidence: rule.confidence,
    regex: compileInjectionRule(rule),
  };
}

/** Double-quote styles and inline/triple backticks (single ` also fenced). */
const QUOTED_SPAN = /"[^"\n]{1,400}"|“[^”\n]{1,400}”|«[^«»\n]{1,400}»|„[^“”\n]{1,400}“|`[^`\n]{1,400}`|```[\s\S]{0,4000}?```/g;

/** Longest repeated-character run that is still considered prose. */
const MAX_CHAR_RUN = 256;
/** Minimum folded length before the flood heuristic is consulted. */
const FLOOD_MIN_CHARS = 2_048;
/** Distinct 8-gram ratio below which content counts as a repeated flood. */
const FLOOD_UNIQUE_RATIO = 0.05;

function floodRatio(folded: string): number {
  const sample = folded.slice(0, 8_192);
  const grams = new Set<string>();
  const total = sample.length - 8;
  if (total <= 0) return 0;
  for (let index = 0; index < total; index += 1) grams.add(sample.slice(index, index + 8));
  return grams.size / total;
}

/**
 * Reusable deterministic scanner. Compilation happens once in the
 * constructor; `scan` is stateless and safe to call concurrently.
 */
export class SafetyScanner {
  private readonly rules: readonly CompiledRule[];
  private readonly budget: number;

  constructor(options: ScannerOptions) {
    if (!Number.isFinite(options.maxScanChars) || options.maxScanChars < 1_024) {
      throw new SafetyGateError("SAFETY_INVALID_ARGUMENT", "scanner maxScanChars must be an integer >= 1024");
    }
    this.budget = options.maxScanChars;
    const custom = (options.customBlockPatterns ?? []).map((source, index) => {
      let regex: RegExp;
      try {
        regex = new RegExp(source, "iu");
      } catch (error) {
        throw new SafetyGateError("SAFETY_INVALID_ARGUMENT", `customBlockPatterns[${index}] is not a valid regular expression`, { cause: error });
      }
      return {
        id: `custom.${index}`,
        category: "policy_violation" as const,
        severity: "block" as const,
        confidence: 1,
        regex,
      };
    });
    this.rules = [...INJECTION_RULES.map(compile), ...SECRET_RULES.map(compile), ...custom];
  }

  /**
   * Run every rule over the raw content and its decoded candidates.
   * `allowQuotedDowngrade` (default true) downgrades block-rule hits inside
   * quotation spans to warn; tool-argument scanning disables it because JSON
   * quotes there are structural, not citation.
   */
  scan(raw: string, options?: { allowQuotedDowngrade?: boolean }): ScanResult {
    const allowQuotedDowngrade = options?.allowQuotedDowngrade ?? true;
    if (raw.length === 0) {
      return { findings: [], decision: "allow", categories: [], scannedChars: 0, truncated: false };
    }

    const truncated = raw.length > this.budget;
    const content = truncated ? raw.slice(0, this.budget) : raw;
    const fold = foldText(content);
    const quotedSpans = collectQuotedSpans(fold.plain);
    const findings: ScanFinding[] = [];
    const categories = new Set<SafetyCategory>();
    const seenHits = new Set<string>();
    let decision: SafetyDecision = "allow";

    const record = (finding: ScanFinding): void => {
      findings.push(finding);
      categories.add(finding.category);
      if (DECISION_ORDER[finding.severity] > DECISION_ORDER[decision]) decision = finding.severity;
    };

    const collect = (rule: CompiledRule, text: string, allowQuotedDowngrade: boolean): void => {
      const global = new RegExp(rule.regex.source, `${rule.regex.flags}g`);
      let hits = 0;
      for (const match of text.matchAll(global)) {
        if (hits >= 8) break;
        hits += 1;
        const matched = match[0] ?? "";
        const dedupeKey = `${rule.id}:${matched}`;
        if (seenHits.has(dedupeKey)) continue;
        seenHits.add(dedupeKey);
        const severity = rule.severity;
        const quoted = quotedSpans !== null && insideSpans(match.index ?? 0, (match.index ?? 0) + matched.length, quotedSpans);
        if (severity === "block" && quoted && allowQuotedDowngrade) {
          record({
            ruleId: rule.id,
            category: rule.category,
            severity: "warn",
            spanLength: matched.length,
            confidence: Math.min(0.9, rule.confidence * 0.9),
          });
        } else {
          record({
            ruleId: rule.id,
            category: rule.category,
            severity,
            spanLength: matched.length,
            confidence: rule.confidence,
          });
        }
      }
    };

    // Rules run over both views: the folded view catches Latin-keyword
    // obfuscation (homoglyphs, fullwidth), the plain view keeps native-script
    // (e.g. Cyrillic) rules matchable.
    for (const rule of this.rules) {
      collect(rule, fold.plain, allowQuotedDowngrade);
      collect(rule, fold.folded, allowQuotedDowngrade);
    }

    // Decoded candidates only ever add obfuscation + the underlying rule hit.
    for (const candidate of decodeEncodings(content)) {
      const candidateFold = foldText(candidate.text);
      for (const rule of this.rules) {
        if (rule.category === "secret_leak") continue;
        const before = findings.length;
        collect(rule, candidateFold.plain, false);
        collect(rule, candidateFold.folded, false);
        if (findings.length > before && candidate.encoding === "base64") {
          record({
            ruleId: "obfuscation.base64_payload",
            category: "prompt_injection",
            severity: "warn",
            spanLength: candidate.text.length,
            confidence: 0.7,
          });
        }
      }
    }

    if (fold.zeroWidthRemoved > 8) {
      record({
        ruleId: "obfuscation.zero_width",
        category: "prompt_injection",
        severity: "warn",
        spanLength: fold.zeroWidthRemoved,
        confidence: 0.6,
      });
    }
    if (fold.foldedChanged && /[а-яё]/.test(fold.folded) === false && /\b(?:ignore|disregard|instructions?)\b/.test(fold.folded)) {
      record({
        ruleId: "obfuscation.homoglyph",
        category: "prompt_injection",
        severity: "warn",
        spanLength: fold.folded.length,
        confidence: 0.5,
      });
    }

    const charRun = fold.folded.match(new RegExp(`(.)\\1{${MAX_CHAR_RUN},}`, "u"));
    if (charRun !== null || (fold.folded.length >= FLOOD_MIN_CHARS && floodRatio(fold.folded) < FLOOD_UNIQUE_RATIO)) {
      record({
        ruleId: "flood.repeated_payload",
        category: "unknown_high_risk",
        severity: "warn",
        spanLength: fold.folded.length,
        confidence: 0.5,
      });
    }

    // Generic secret-like tokens only when no specific rule already fired.
    // Runs on the case-preserved view: mixed-case evidence is lost after
    // lowercasing.
    if (!categories.has("secret_leak")) {
      for (const finding of findHighEntropyTokens(fold.cased)) record(finding);
    }

    return {
      findings,
      decision,
      categories: [...categories],
      scannedChars: content.length,
      truncated,
    };
  }
}

function collectQuotedSpans(text: string): Array<[number, number]> | null {
  if (!/["“«„`]/.test(text)) return null;
  const spans: Array<[number, number]> = [];
  for (const match of text.matchAll(QUOTED_SPAN)) {
    spans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  return spans.length > 0 ? spans : null;
}

function insideSpans(start: number, end: number, spans: ReadonlyArray<readonly [number, number]>): boolean {
  return spans.some(([from, to]) => start >= from && end <= to);
}
