/**
 * Text → analysis. The only place JSON is decoded.
 */
import type { AuditAnalysis } from "../types.js";
import {
  validateAuditAnalysis,
  type AuditAnalysisResult,
} from "../validation/validate-analysis.js";

/**
 * Decode and validate `analysis.json` text.
 *
 * Parsing and validation are one step on purpose: a caller that can obtain an
 * unvalidated JSON value has no use for it, and every caller needs the failure
 * reasons — not an exception — when the bytes are wrong.
 *
 * @param text - file contents; a leading byte-order mark is tolerated.
 */
export function parseAuditAnalysis(text: string): AuditAnalysisResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim().length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_JSON",
          message: "analysis.json is empty",
          severity: "error",
        },
      ],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_JSON",
          message: `analysis.json is not valid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
          severity: "error",
        },
      ],
    };
  }

  return validateAuditAnalysis(value);
}

/**
 * The session an audit is bound to, or `null` when this build cannot tell.
 *
 * The trajectory's own `sessionId` is authoritative (SPEC §14); a directory
 * name is a hint for resolution, never a binding. An unknown schema has no
 * readable binding, which is exactly why such an audit is retained unresolved
 * rather than attached to a guess.
 */
export function getAuditSessionId(analysis: AuditAnalysis): string | null {
  return analysis.kind === "v1" ? analysis.trajectory.sessionId : null;
}
