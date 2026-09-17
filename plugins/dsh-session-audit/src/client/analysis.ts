/**
 * Decoding what the host sent.
 *
 * The host ships `analysis.json` as text rather than as a decoded value, so
 * this is the client's single parse point — and it is the same parser the host
 * and every other consumer uses, which is what keeps the two views of one
 * audit identical.
 */
import {
  isKnownAnalysis,
  parseAuditAnalysis,
  type AuditAnalysis,
  type AuditAnalysisV1,
} from "@yadsh/dsh-audit-core";

/** A decoded analysis plus the raw document behind it. */
export interface ParsedAnalysis {
  readonly analysis: AuditAnalysis;
  /** The document exactly as published, for the JSON view. */
  readonly raw: unknown;
  /** `true` when this build understands the schema. */
  readonly known: boolean;
}

/**
 * Parse `analysis.json` text.
 *
 * Never throws and never returns "nothing": an unreadable document becomes an
 * unknown-schema analysis, because the JSON tab and the report can still show
 * something useful where a thrown error would show a blank pane.
 */
export function parseAnalysis(analysisJson: string): ParsedAnalysis {
  if (analysisJson.trim().length === 0) {
    return {
      analysis: { kind: "unknown", schemaVersion: null },
      raw: null,
      known: false,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(analysisJson);
  } catch {
    raw = analysisJson;
  }

  const parsed = parseAuditAnalysis(analysisJson);
  if (!parsed.ok) {
    return {
      analysis: { kind: "unknown", schemaVersion: null },
      raw,
      known: false,
    };
  }
  return {
    analysis: parsed.analysis,
    raw,
    known: isKnownAnalysis(parsed.analysis),
  };
}

/** The typed analysis, when the schema is understood. */
export function knownAnalysis(parsed: ParsedAnalysis): AuditAnalysisV1 | null {
  return isKnownAnalysis(parsed.analysis) ? parsed.analysis : null;
}
