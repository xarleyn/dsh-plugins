import { isDeepStrictEqual } from "node:util";
import type { Config } from "./config.js";
import {
  DecisionError,
  id,
  record,
  text,
  type Answer,
  type Json,
  type Question,
  type State,
} from "./types.js";

export function questions(value: unknown, cfg: Config): Question[] {
  if (!Array.isArray(value) || !value.length || value.length > cfg.maxQuestions)
    throw new DecisionError(
      "INVALID_INPUT",
      `provide 1..${cfg.maxQuestions} questions`,
    );
  const result = value.map((item) => {
    const q = record(item, "question");
    const name = id(q.id);
    const instructions = text(q.instructions, "instructions");
    if (!["noul", "choice", "score"].includes(String(q.type)))
      throw new DecisionError("INVALID_INPUT", "unsupported question kind");
    if (q.type === "choice") {
      const options = record(q.criteria, "choice criteria");
      if (
        Object.keys(options).length < 2 ||
        Object.keys(options).length > cfg.maxLabels
      )
        throw new DecisionError(
          "INVALID_INPUT",
          `choice requires 2..${cfg.maxLabels} options`,
        );
      for (const [key, description] of Object.entries(options)) {
        id(key);
        json(description, "option description", 2000);
      }
    } else if (q.type === "score") {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        q.criteria.length > cfg.maxLabels
      )
        throw new DecisionError(
          "INVALID_INPUT",
          `score requires 2..${cfg.maxLabels} ordered levels`,
        );
      for (const level of q.criteria) {
        if (level === null)
          throw new DecisionError(
            "INVALID_INPUT",
            "score levels cannot be null",
          );
        json(level, "score level", 2000);
      }
      if (
        new Set(q.criteria.map((v) => JSON.stringify(v))).size !==
        q.criteria.length
      )
        throw new DecisionError(
          "INVALID_INPUT",
          "score levels must be distinct",
        );
    } else if (q.criteria !== undefined) {
      const criteria = record(q.criteria, "noul criteria");
      for (const [key, value] of Object.entries(criteria)) {
        if (key !== "true" && key !== "false")
          throw new DecisionError(
            "INVALID_INPUT",
            "noul criteria allow true and false only",
          );
        json(value, "noul criterion", 2000);
      }
    }
    return {
      id: name,
      type: q.type as Question["type"],
      instructions,
      ...(q.criteria === undefined ? {} : { criteria: q.criteria as Json }),
    };
  });
  if (new Set(result.map((q) => q.id)).size !== result.length)
    throw new DecisionError("INVALID_INPUT", "question ids must be unique");
  return result;
}
function json(value: unknown, label: string, max: number): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length > max)
    throw new DecisionError(
      "INVALID_INPUT",
      `${label} exceeds ${max} characters`,
    );
  if (
    value !== null &&
    typeof value !== "string" &&
    !Array.isArray(value) &&
    typeof value !== "object"
  )
    throw new DecisionError(
      "INVALID_INPUT",
      `${label} must be string, object, array or null`,
    );
}
export function state(value: unknown): State {
  if (
    typeof value !== "string" &&
    (value === null || typeof value !== "object")
  )
    throw new DecisionError(
      "INVALID_INPUT",
      "state must be text, a JSON object or a JSON array",
    );
  if (JSON.stringify(value) === '""')
    throw new DecisionError("INVALID_INPUT", "state must not be empty text");
  return value as State;
}
function finite(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new DecisionError(
      "INVALID_RESPONSE",
      `expected finite number in [${min},${max}]`,
    );
  return value;
}
function distribution(value: unknown, keys: string[]): Record<string, number> {
  const raw = record(value, "probabilities");
  exactKeys(raw, keys);
  const entries = Object.entries(raw).map(
    ([key, v]) => [key, finite(v, 0, 1)] as const,
  );
  if (Math.abs(entries.reduce((sum, [, p]) => sum + p, 0) - 1) > 0.002)
    throw new DecisionError(
      "INVALID_RESPONSE",
      "probabilities must sum to one within rounding tolerance",
    );
  return Object.fromEntries(entries);
}
function exactKeys(raw: Record<string, unknown>, keys: string[]): void {
  if (
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(raw, key))
  )
    throw new DecisionError(
      "INVALID_RESPONSE",
      "response ids/labels do not exactly match request",
    );
}
export function answers(
  value: unknown,
  qs: readonly Question[],
  cfg: Config,
): Record<string, Answer> {
  try {
    const raw = record(value, "answers");
    exactKeys(
      raw,
      qs.map((q) => q.id),
    );
    return Object.fromEntries(
      qs.map((q) => {
        const a = record(raw[q.id], "answer");
        if (a.type !== q.type)
          throw new DecisionError(
            "INVALID_RESPONSE",
            "answer kind does not match question",
          );
        if (q.type === "noul") {
          const noul = finite(a.noul, 0, 1);
          const decision =
            noul >= cfg.yesThreshold
              ? "yes"
              : noul <= cfg.noThreshold
                ? "no"
                : "uncertain";
          return [
            q.id,
            {
              type: q.type,
              noul,
              decision,
              uncertain: decision === "uncertain",
            },
          ];
        }
        const confidence = finite(a.confidence, 0, 1);
        const keys =
          q.type === "choice"
            ? Object.keys(q.criteria as object)
            : (q.criteria as Json[]).map((_, i) => String(i));
        const probabilities = distribution(a.probabilities, keys);
        if (q.type === "choice") {
          if (
            typeof a.choice !== "string" ||
            !keys.includes(a.choice) ||
            probabilities[a.choice]! + 0.0001 <
              Math.max(...Object.values(probabilities))
          )
            throw new DecisionError(
              "INVALID_RESPONSE",
              "choice must name a most-probable provided option",
            );
          return [
            q.id,
            {
              type: q.type,
              choice: a.choice,
              confidence,
              probabilities,
              uncertain: confidence < cfg.confidenceFloor,
            },
          ];
        }
        const score = finite(a.score, 0, keys.length - 1);
        const legend = record(a.legend, "legend");
        exactKeys(legend, keys);
        const expected = Object.fromEntries(
          (q.criteria as Json[]).map((v, i) => [String(i), v]),
        );
        // Return the request's authoritative legend; reject altered provider labels.
        for (const key of keys)
          if (!isDeepStrictEqual(legend[key], expected[key]))
            throw new DecisionError(
              "INVALID_RESPONSE",
              "score legend differs from requested rubric",
            );
        return [
          q.id,
          {
            type: q.type,
            score,
            confidence,
            probabilities,
            legend: expected,
            uncertain: confidence < cfg.confidenceFloor,
          },
        ];
      }),
    );
  } catch (error) {
    if (error instanceof DecisionError && error.code === "INVALID_INPUT")
      throw new DecisionError(
        "INVALID_RESPONSE",
        "response must contain typed objects",
      );
    throw error;
  }
}
