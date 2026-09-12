import {
  EXPERT_RESULT_MARKER,
  type DomainExpertFinding,
  type ExpertConfidence,
} from "../types.js";

export interface ParsedExpertAnswer {
  readonly summary: string;
  readonly findings: readonly DomainExpertFinding[];
  readonly conflicts: readonly string[];
  readonly assumptions: readonly string[];
  readonly followUps: readonly string[];
  /** True when a structured block was found and parsed. */
  readonly structured: boolean;
}

const FENCE_PATTERN = /```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/gu;
const CONFIDENCES: readonly ExpertConfidence[] = ["high", "medium", "low"];

/**
 * Read the structured answer a child was asked to produce.
 *
 * Parsing is lenient on purpose: the expert result is model output, and losing
 * a run because a fence was mistyped would be worse than degrading to prose.
 * The prose is always kept as the summary, so an unparsed answer is still a
 * usable answer — `structured` records which of the two happened.
 */
export function parseExpertAnswer(text: string): ParsedExpertAnswer {
  const trimmed = text.trim();
  const payload = extractPayload(trimmed);
  if (payload === null) {
    return {
      summary: trimmed,
      findings: [],
      conflicts: [],
      assumptions: [],
      followUps: [],
      structured: false,
    };
  }
  const prose = trimmed.slice(0, payload.start).trim();
  return {
    summary: payload.object["summary"] !== undefined
      ? asText(payload.object["summary"])
      : prose,
    findings: findingsOf(payload.object["findings"]),
    conflicts: stringList(payload.object["conflicts"]),
    assumptions: stringList(payload.object["assumptions"]),
    followUps: stringList(payload.object["followUps"] ?? payload.object["follow_ups"]),
    structured: true,
  };
}

interface Payload {
  readonly object: Record<string, unknown>;
  readonly start: number;
}

function extractPayload(text: string): Payload | null {
  const tagged: Payload[] = [];
  const generic: Payload[] = [];
  FENCE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(FENCE_PATTERN)) {
    const tag = match[1] ?? "";
    const body = match[2] ?? "";
    const object = parseObject(body);
    if (object === null) continue;
    const start = match.index ?? 0;
    if (tag === EXPERT_RESULT_MARKER) tagged.push({ object, start });
    else if (tag === "json") generic.push({ object, start });
  }
  const chosen = tagged[0] ?? generic[0];
  if (chosen !== undefined) return chosen;
  return scanBareObject(text);
}

/** Last resort: a bare JSON object with the expected shape, unfenced. */
function scanBareObject(text: string): Payload | null {
  let index = text.indexOf("{");
  while (index !== -1) {
    const candidate = text.slice(index);
    const object = parseObject(candidate);
    if (object !== null && ("summary" in object || "findings" in object)) {
      return { object, start: index };
    }
    index = text.indexOf("{", index + 1);
  }
  return null;
}

function parseObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  const end = balancedEnd(trimmed);
  if (end === -1) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(0, end));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Index just past the object that starts at 0, honouring strings and escapes. */
function balancedEnd(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function findingsOf(value: unknown): readonly DomainExpertFinding[] {
  if (!Array.isArray(value)) return [];
  const out: DomainExpertFinding[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item.trim() !== "") {
        out.push({ claim: item.trim(), evidence: [], confidence: "medium" });
      }
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const claim = asText(record["claim"] ?? record["finding"] ?? record["statement"]);
    if (claim === "") continue;
    const confidence = record["confidence"];
    out.push({
      claim,
      evidence: stringList(record["evidence"] ?? record["sources"]),
      confidence: typeof confidence === "string" &&
        (CONFIDENCES as readonly string[]).includes(confidence)
        ? (confidence as ExpertConfidence)
        : "medium",
    });
  }
  return out;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item))
    .filter((item) => item !== "");
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Flatten the child's content blocks into the text the parser reads. */
export function textOfBlocks(output: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of output) {
    if (typeof block !== "object" || block === null) continue;
    const record = block as Record<string, unknown>;
    if (record["type"] !== "text") continue;
    if (typeof record["text"] === "string") parts.push(record["text"]);
  }
  return parts.join("\n\n").trim();
}
