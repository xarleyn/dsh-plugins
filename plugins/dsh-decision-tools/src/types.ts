/** System One's three typed decision contracts. */
export type Kind = "noul" | "choice" | "score";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type State = string | Json[] | { [key: string]: Json };
export interface Question {
  readonly id: string;
  readonly type: Kind;
  readonly instructions: string;
  readonly criteria?: Json;
}
export interface Answer {
  readonly type: Kind;
  readonly uncertain: boolean;
  readonly noul?: number;
  readonly decision?: "yes" | "no" | "uncertain";
  readonly choice?: string;
  readonly score?: number;
  readonly confidence?: number;
  readonly probabilities?: Record<string, number>;
  readonly legend?: Record<string, Json>;
}
export interface Result {
  readonly backend: string;
  readonly model: string;
  readonly answers: Record<string, Answer>;
  readonly usage: { input_tokens: number; output_tokens: number } | null;
  readonly latencyMs: number;
  readonly confidenceMeaning: string;
  readonly ranking?: readonly {
    id: string;
    score: number;
    confidence: number;
    uncertain: boolean;
  }[];
}
/** Expected errors carry a stable, model-readable category, never provider bodies. */
export class DecisionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "DecisionError";
  }
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new DecisionError("INVALID_INPUT", `${label} must be an object`);
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max)
    throw new DecisionError(
      "INVALID_INPUT",
      `${label} must be nonempty text, at most ${max} characters`,
    );
  return value;
}
export function id(value: unknown): string {
  const name = text(value, "id", 64);
  if (
    !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(name) ||
    ["constructor", "prototype"].includes(name)
  )
    throw new DecisionError(
      "INVALID_INPUT",
      "ids must be simple identifiers, starting with a letter",
    );
  return name;
}
/** Conservative estimate, not a backend tokenizer or billing count. */
export function estimateTokens(value: string): number {
  let n = 0;
  for (const match of value.matchAll(/[A-Za-z]+|\d+|\s+|[^\sA-Za-z\d]/g)) {
    const p = match[0];
    n += /^[A-Za-z]/u.test(p)
      ? 1 + Math.floor((p.length - 1) / 6)
      : /^\d/u.test(p)
        ? p.length / 2
        : /^\s/u.test(p)
          ? 0.25
          : 0.9;
  }
  return Math.ceil(n);
}
