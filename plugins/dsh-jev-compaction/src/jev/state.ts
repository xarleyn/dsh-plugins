/**
 * Jev state builder (SPEC §11).
 *
 * Produces the bounded semantic representation of the conversation: user and
 * assistant intent stays represented (bounded, privacy-gated), full
 * historical tool outputs are replaced by short notes, candidates appear as
 * one-line records with stable ids and their deterministic features. Recent
 * task context is favored; the goal defaults to the last user prompts.
 */

import type { Session } from "@deepseek-ai/dsh-session";
import type { ToolCallInfo } from "../dsh/surface.js";
import type { ResolvedJevCompactionConfig } from "../config/index.js";
import type { ToolResultCandidate } from "../planner/collect.js";
import { formatFeatures, type CandidateFeatures } from "../planner/features.js";
import {
  estimateStateTokens,
  type JevHistoryEntry,
  type JevState,
} from "./types.js";

export const STATE_CONTEXT =
  "A coding assistant conversation is being compacted to free context. " +
  "`history` is the whole conversation so far, oldest first; tool outputs " +
  "are replaced by a short note and long texts may be abridged. Each " +
  "question asks whether one historical tool result still needs to remain " +
  "in the model context, and whether it must remain verbatim. Pruned " +
  "outputs are recoverable from the session log, and the assistant can " +
  "always re-run a tool or re-read a file if needed.";

/** Text blocks of one message event, flattened (user/message is bare). */
function messageText(event: { data: Record<string, unknown> }): string {
  const data = event.data as {
    message?: { content?: { type: string; text?: string }[] };
    content?: { type: string; text?: string }[];
  };
  const content = data.message?.content ?? data.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

function truncate(text: string, limit: number): string {
  if (limit <= 0) return "";
  return text.length <= limit
    ? text
    : `${text.slice(0, Math.max(0, limit - 1))}\u2026`;
}

function abridge(text: string, head: number, tail: number): string {
  if (text.length <= head + tail + 40) return text;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n[\u2026 ${omitted} chars omitted \u2026]\n${text.slice(-tail)}`;
}

/** Features and candidate ids by callId for quick lookup while building. */
export interface StateInputs {
  readonly candidates: readonly ToolResultCandidate[];
  readonly features: Map<string, CandidateFeatures>;
  readonly callIndex: Map<string, ToolCallInfo>;
}

/** The recent task goal: last user prompts (bounded). */
export function goalFromSession(
  session: Session,
  config: ResolvedJevCompactionConfig,
): string {
  const goals: string[] = [];
  const events = session.snapshotEvents();
  for (
    let index = events.length - 1;
    index >= 0 && goals.length < 3;
    index -= 1
  ) {
    const event = events[index]!;
    if (event.type !== "user/message") continue;
    const text = messageText(event as never).trim();
    if (text.length === 0) continue;
    goals.unshift(truncate(text, 500));
  }
  void config;
  return goals.join("\n") || "(no recent user text)";
}

/**
 * Build the full (unfitted) state. Deterministic: the same surface read
 * always produces the same history and the same candidate ids.
 */
export function buildState(
  session: Session,
  inputs: StateInputs,
  config: ResolvedJevCompactionConfig,
): { state: JevState; tokens: number } {
  const candidateByCallId = new Map(
    inputs.candidates.map((c) => [c.callId, c]),
  );
  const events = session.snapshotEvents();
  const history: JevHistoryEntry[] = [];
  const privacy = config.privacy;
  const textBudget = privacy.textChars;

  for (const event of events) {
    if (event.type === "user/message") {
      if (!privacy.includeUserText) continue;
      const text = messageText(event as never).trim();
      if (text.length === 0) continue;
      history.push({
        label: `user t${(event.data as { turn?: number }).turn ?? "?"}`,
        text: truncate(text, textBudget),
      });
      continue;
    }
    if (event.type === "assistant/message") {
      if (!privacy.includeAssistantText) continue;
      const text = messageText(event as never).trim();
      if (text.length === 0) continue;
      history.push({
        label: `assistant t${(event.data as { turn?: number }).turn ?? "?"}`,
        text: truncate(text, textBudget),
      });
      continue;
    }
    if (event.type === "tool/call") {
      if (!privacy.includeToolArguments) continue;
      const data = event.data as { callId: string; name: string; turn: number };
      const candidate = candidateByCallId.get(data.callId);
      if (candidate === undefined) continue; // pinned or not a candidate
      const args = truncate(
        candidate.toolArgumentsPreview ?? "",
        config.state.toolInputChars,
      );
      const features = inputs.features.get(data.callId);
      const result = candidate.isError ? "error" : "ok";
      history.push({
        label: `tool t${data.turn}/c${data.callId}`,
        callId: data.callId,
        text: [
          `id=${candidate.callId}`,
          `name=${data.name}`,
          `args=${args || "{}"}`,
          `result=${result}, ${candidate.originalChars} chars omitted`,
          `features=age:${candidate.agePositions}p; ${formatFeatures(features)}`,
        ].join(" "),
      });
    }
  }

  const state: JevState = {
    context: STATE_CONTEXT,
    goal: goalFromSession(session, config),
    history,
  };
  return { state, tokens: estimateStateTokens(JSON.stringify(state)) };
}

/**
 * Progressive fitting (SPEC §19): shrink the state deterministically until it
 * fits `maxStateTokens`, oldest-first and metadata-first, never dropping the
 * goal or the last three privacy-bounded user entries. Stages: abridge other
 * long texts → drop oldest tool metadata → prefer the newest five entries →
 * trim remaining unprotected history. Throws if protected context cannot fit.
 */
export function fitState(
  state: JevState,
  maxStateTokens: number,
): { state: JevState; tokens: number; stage: string } {
  const sizeOf = (candidate: JevState): number =>
    estimateStateTokens(JSON.stringify(candidate));

  let current: JevState = state;
  if (sizeOf(current) <= maxStateTokens) {
    return { state: current, tokens: sizeOf(current), stage: "full" };
  }

  const protectedUsers = new Set(
    state.history.filter((entry) => entry.label.startsWith("user ")).slice(-3),
  );

  // Stage 1: abridge long texts without losing recent user constraints.
  current = {
    ...current,
    history: current.history.map((entry) =>
      protectedUsers.has(entry)
        ? entry
        : {
            ...entry,
            text: abridge(entry.text, 400, 150),
          },
    ),
  };
  if (sizeOf(current) <= maxStateTokens) {
    return { state: current, tokens: sizeOf(current), stage: "abridged" };
  }

  // Find the smallest oldest-first removal with logarithmic serializations;
  // serializing the whole history after each deletion is quadratic on long logs.
  const trim = (
    canDrop: (entry: JevHistoryEntry, index: number) => boolean,
  ): readonly JevHistoryEntry[] => {
    const history = current.history;
    const indices = history.flatMap((entry, index) =>
      canDrop(entry, index) ? [index] : [],
    );
    const without = (count: number): readonly JevHistoryEntry[] => {
      const dropped = new Set(indices.slice(0, count));
      return history.filter((_, index) => !dropped.has(index));
    };
    let low = 0;
    let high = indices.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (sizeOf({ ...current, history: without(mid) }) <= maxStateTokens)
        high = mid;
      else low = mid + 1;
    }
    return without(low);
  };
  const isProtected = (entry: JevHistoryEntry): boolean =>
    protectedUsers.has(entry);

  // Stage 2: drop oldest tool metadata entries.
  let history = trim(
    (entry) => entry.callId !== undefined && !isProtected(entry),
  );
  current = { ...current, history };
  if (sizeOf(current) <= maxStateTokens) {
    return {
      state: current,
      tokens: sizeOf(current),
      stage: "tool-metadata-trimmed",
    };
  }

  // Stage 3: prefer the newest five entries plus protected user constraints.
  history = trim(
    (entry, index) => index < current.history.length - 5 && !isProtected(entry),
  );
  current = { ...current, history };
  if (sizeOf(current) <= maxStateTokens) {
    return {
      state: current,
      tokens: sizeOf(current),
      stage: "history-trimmed",
    };
  }

  // Five entries are a preference, not a hard floor for a small local backend.
  history = trim((entry) => !isProtected(entry));
  current = { ...current, history };
  if (sizeOf(current) <= maxStateTokens) {
    return {
      state: current,
      tokens: sizeOf(current),
      stage: "recent-context-trimmed",
    };
  }

  throw new Error(
    `jev-compaction: the Jev state cannot fit within state.maxStateTokens ` +
      `(protected context: ${sizeOf(current)} tokens, budget: ${maxStateTokens})`,
  );
}
