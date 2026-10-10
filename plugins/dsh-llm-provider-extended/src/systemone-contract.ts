import { LlmError } from "@deepseek-ai/dsh-llm";

export type JsonDescription = string | Record<string, unknown> | unknown[];
export type DecisionQuestion =
  | {
      type: "noul";
      instructions: JsonDescription;
      criteria?: Record<string, JsonDescription>;
    }
  | {
      type: "choice";
      instructions: JsonDescription;
      criteria: Record<string, JsonDescription | null>;
    }
  | {
      type: "score";
      instructions: JsonDescription;
      criteria: JsonDescription[];
    };
export interface DecisionRequest {
  state: JsonDescription;
  questions: Record<string, DecisionQuestion>;
}
export interface DecisionResponse {
  model: string;
  answers: Record<string, Record<string, unknown>>;
  usage: { input_tokens: number; output_tokens: number };
}

function invalid(message: string): never {
  throw new LlmError(message, "PROTOCOL");
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function description(value: unknown): boolean {
  return typeof value === "string" || record(value) || Array.isArray(value);
}

/** Validate the actual native request rather than invent questions from a chat prompt. */
export function validateDecisionRequest(value: unknown): DecisionRequest {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !["state", "questions"].includes(key)) ||
    !description(value.state) ||
    !record(value.questions)
  )
    invalid("System One requires only state and questions");
  const questions = Object.entries(value.questions);
  if (questions.length === 0 || questions.length > 64)
    invalid("System One requires 1 through 64 questions");
  for (const [id, q] of questions) {
    if (
      id.length === 0 ||
      id.length > 128 ||
      !record(q) ||
      !description(q.instructions) ||
      Object.keys(q).some(
        (key) => !["type", "instructions", "criteria"].includes(key),
      )
    )
      invalid("Invalid System One question");
    if (q.type === "noul") {
      if (
        q.criteria != null &&
        (!record(q.criteria) ||
          Object.entries(q.criteria).some(
            ([key, v]) => !["true", "false"].includes(key) || !description(v),
          ))
      )
        invalid("Invalid Noul criteria");
    } else if (q.type === "choice") {
      if (
        !record(q.criteria) ||
        Object.keys(q.criteria).length < 2 ||
        Object.keys(q.criteria).length > 255 ||
        Object.entries(q.criteria).some(
          ([key, v]) => key.length === 0 || (v !== null && !description(v)),
        )
      )
        invalid("Choice requires 2 through 255 described options");
    } else if (q.type === "score") {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        q.criteria.length > 10 ||
        q.criteria.some((v) => !description(v))
      )
        invalid("Score requires 2 through 10 ordered levels");
    } else invalid("System One question type must be noul, choice or score");
  }
  if (JSON.stringify(value).length > 250_000)
    invalid("System One request exceeds 250000 characters");
  return value as unknown as DecisionRequest;
}

function probability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
function sameKeys(
  actual: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(actual).length === expected.length &&
    expected.every((key) => Object.hasOwn(actual, key))
  );
}

/** Validate results before publishing them through the model seam. */
export function validateDecisionResponse(
  value: unknown,
  request: DecisionRequest,
): DecisionResponse {
  if (
    !record(value) ||
    typeof value.model !== "string" ||
    !value.model ||
    !record(value.answers) ||
    !sameKeys(value.answers, Object.keys(request.questions)) ||
    !record(value.usage)
  )
    invalid("Malformed System One response");
  for (const count of [value.usage.input_tokens, value.usage.output_tokens])
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
      invalid("Malformed System One token usage");
  for (const [id, q] of Object.entries(request.questions)) {
    const answer = value.answers[id];
    if (!record(answer) || answer.type !== q.type)
      invalid("System One answer type does not match its question");
    if (q.type === "noul") {
      if (!probability(answer.noul)) invalid("Invalid Noul probability");
      continue;
    }
    const keys =
      q.type === "choice"
        ? Object.keys(q.criteria)
        : q.criteria.map((_, i) => String(i));
    if (
      !probability(answer.confidence) ||
      !record(answer.probabilities) ||
      !sameKeys(answer.probabilities, keys) ||
      Object.values(answer.probabilities).some((v) => !probability(v))
    )
      invalid("Invalid System One probability distribution");
    if (
      Math.abs(
        Object.values(answer.probabilities).reduce<number>(
          (sum, v) => sum + (v as number),
          0,
        ) - 1,
      ) > 0.001
    )
      invalid("System One probabilities do not sum to one");
    if (q.type === "choice") {
      if (typeof answer.choice !== "string" || !keys.includes(answer.choice))
        invalid("Unknown System One choice");
    } else if (
      typeof answer.score !== "number" ||
      !Number.isFinite(answer.score) ||
      answer.score < 0 ||
      answer.score > q.criteria.length - 1 ||
      !record(answer.legend) ||
      !sameKeys(answer.legend, keys) ||
      Object.values(answer.legend).some((value) => typeof value !== "string")
    )
      invalid("Invalid System One score or legend");
  }
  return value as unknown as DecisionResponse;
}
