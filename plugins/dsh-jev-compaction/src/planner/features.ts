/**
 * Deterministic feature extraction (SPEC §10).
 *
 * Cheap local signals that ride into the Jev state and bias preservation.
 * Features are advisory: they never delete anything on their own, and Jev
 * output never overrides a deterministic pin (SPEC §5.3).
 */

import type { ToolCallInfo } from "../dsh/surface.js";
import type { ToolResultCandidate } from "./collect.js";

/** Rerunnability classes (SPEC §9.2). */
export type Rerunnable = "cheap" | "moderate" | "expensive" | "unknown";

/** Tools whose output is normally cheap to reproduce. */
const CHEAP_RERUN_TOOLS = new Set([
  "read",
  "ls",
  "list",
  "glob",
  "grep",
  "search",
  "find",
  "cat",
  "stat",
  "which",
]);

/** Tools whose output is normally expensive or impossible to reproduce. */
const EXPENSIVE_RERUN_TOOLS = new Set([
  "web_fetch",
  "fetch",
  "http",
  "browser",
  "jira_search",
  "jira_get_issue",
  "confluence_search",
  "send_message",
  "mail",
]);

/** Deterministic signals attached to one candidate before scoring. */
export interface CandidateFeatures {
  /** An equivalent or newer access to the same target exists. */
  superseded: boolean;
  /** A near-duplicate call with an equivalent query exists. */
  duplicateLike: boolean;
  rerunnable: Rerunnable;
  /** Likely exact evidence: stack traces, hashes, URLs, identifiers. */
  containsLikelyExactEvidence: boolean;
  /**
   * The result was already reduced by immediate shaping before persistence.
   * Carried so the classifier and the state know the visible text is a
   * reconstruction with omission markers, not the raw tool output.
   */
  alreadyShaped?: boolean;
}

const EXACT_EVIDENCE_PATTERNS: RegExp[] = [
  /at\s+.*:\d+:\d+/, // stack frame
  /^\s*at\s+/m,
  /\berror\s+TS\d+:/, // compiler diagnostics
  /\b[A-Fa-f0-9]{40}\b/, // git sha
  /\b[A-Fa-f0-9]{32}\b/, // md5-like
  /https?:\/\/\S+/,
  /\b[A-Z]{3,10}-\d+\b/, // issue key (synthetic-friendly)
];

function extractCommand(preview: string | undefined): string | undefined {
  if (preview === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(preview);
    if (parsed !== null && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["command", "cmd", "script"]) {
        const value = record[key];
        if (typeof value === "string" && value.length > 0) return value;
      }
    }
  } catch {
    // Non-JSON arguments: no command hint.
  }
  return undefined;
}

function classifyRerunnable(
  toolName: string | undefined,
  command: string | undefined,
): Rerunnable {
  const name = (toolName ?? "").toLowerCase();
  if (EXPENSIVE_RERUN_TOOLS.has(name)) return "expensive";
  if (CHEAP_RERUN_TOOLS.has(name)) return "cheap";
  if (command !== undefined) {
    // Test and build invocations are routinely re-runnable.
    if (
      /(^|\s)(test|vitest|jest|pytest|go\s+test|build|compile)\b/i.test(command)
    )
      return "cheap";
    if (/\b(curl|wget|deploy|publish|install)\b/i.test(command))
      return "expensive";
    return "moderate";
  }
  return "unknown";
}

function matchesEvidence(text: string): boolean {
  return EXACT_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Extracted path-like tokens from the arguments preview, for comparisons. */
function extractPaths(preview: string | undefined): string[] {
  if (preview === undefined) return [];
  const paths: string[] = [];
  try {
    const parsed: unknown = JSON.parse(preview);
    if (parsed !== null && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const value of Object.values(record)) {
        if (
          typeof value === "string" &&
          (value.includes("/") || value.includes("\\"))
        ) {
          paths.push(value);
        }
      }
    }
  } catch {
    // Non-JSON arguments: no path hints.
  }
  return paths;
}

function sameTarget(
  a: { toolName?: string; command?: string },
  b: { toolName?: string; command?: string },
): boolean {
  if (a.command !== undefined && b.command !== undefined)
    return a.command === b.command;
  if (a.toolName !== undefined && a.toolName === b.toolName) return true;
  return false;
}

/**
 * Compute deterministic features for every candidate.
 *
 * Supersession: a later call to the same tool targeting the same path (or
 * the same command) marks the older result. Superseded reads of a path that
 * also saw an intermediate write are the strongest stale signal, but v1
 * keeps this advisory either way (SPEC §10.1).
 */
export function extractFeatures(
  candidates: readonly ToolResultCandidate[],
  callIndex: Map<string, ToolCallInfo>,
): Map<string, CandidateFeatures> {
  const features = new Map<string, CandidateFeatures>();
  const enriched = candidates.map((candidate) => {
    const info = callIndex.get(candidate.callId);
    const preview = candidate.toolArgumentsPreview ?? info?.arguments;
    return {
      candidate,
      command: extractCommand(preview),
      paths: extractPaths(preview),
    };
  });

  for (const { candidate, command } of enriched) {
    const byId = callIndex.get(candidate.callId);
    // Later candidates (higher surface seq) that touch the same target.
    const later = enriched.filter(
      (other) =>
        other.candidate.surfaceSeq > candidate.surfaceSeq &&
        sameTarget(
          { toolName: candidate.toolName, command },
          { toolName: other.candidate.toolName, command: other.command },
        ),
    );
    const superseded =
      later.length > 0 &&
      (candidate.toolName === undefined ||
        later.some((other) => other.candidate.toolName === candidate.toolName));
    const duplicateLike = later.some(
      (other) =>
        other.candidate.toolName === candidate.toolName &&
        other.candidate.toolArgumentsPreview ===
          candidate.toolArgumentsPreview &&
        byId?.arguments === callIndex.get(other.candidate.callId)?.arguments,
    );
    features.set(candidate.callId, {
      superseded,
      duplicateLike,
      rerunnable: classifyRerunnable(candidate.toolName, command),
      containsLikelyExactEvidence: matchesEvidence(candidate.originalText),
      ...(candidate.alreadyShaped === true ? { alreadyShaped: true } : {}),
    });
  }
  return features;
}

/** One-line feature summary rendered into the Jev state (SPEC §11). */
export function formatFeatures(
  features: CandidateFeatures | undefined,
): string {
  if (features === undefined) return "none";
  const parts: string[] = [];
  if (features.superseded) parts.push("superseded:true");
  if (features.duplicateLike) parts.push("duplicateLike:true");
  parts.push(`rerunnable:${features.rerunnable}`);
  if (features.containsLikelyExactEvidence) parts.push("exactEvidence:true");
  if (features.alreadyShaped === true) parts.push("alreadyShaped:true");
  return parts.length > 0 ? parts.join("; ") : "none";
}
