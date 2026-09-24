/**
 * Structured, durable review-waiver support.
 *
 * The gate never infers a waiver from prose. `/no-review <request>` is a
 * human-issued host command. Its handler queues a normal user message through
 * `agent.followup`; the command result points `command/done.sourceEventSeq` at
 * the authoritative `agent/inbox/spliced` event that admitted that exact
 * message. The gate accepts only that stock, replayable lifecycle chain.
 */

import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";

import type { ResolvedAnswerReviewGateConfig } from "./config.js";

export const REVIEW_WAIVER_COMMAND = "no-review";

export interface ReviewWaiverEvidence {
  readonly scope: "turn";
  readonly via: "command";
  readonly commandId: string;
}

export interface WaiverSessionEvent {
  readonly type: string;
  readonly data: unknown;
  readonly seq?: number;
}

export interface WaiverSession {
  snapshotEvents(): readonly WaiverSessionEvent[];
}

/** Minimal host command registry used through Cordis's optional `commands` service. */
export interface ReviewWaiverCommandRegistry {
  register(definition: {
    readonly name: string;
    readonly description: string;
    readonly input: { readonly hint: string; readonly attachments: true };
    readonly recordInput: false;
    readonly handler: (
      invocation: ReviewWaiverCommandInvocation,
    ) => ReviewWaiverCommandResult;
  }): () => void;
}

export interface ReviewWaiverCommandInvocation {
  readonly commandId: unknown;
  readonly rawInput: string;
  readonly attachments: readonly ContentBlock[];
  readonly signal: AbortSignal;
  readonly agent: {
    readonly session: WaiverSession;
    followup(message: unknown): void;
  };
}

export type ReviewWaiverCommandResult =
  | {
      readonly kind: "success";
      readonly text: string;
      readonly sourceEventSeq: number;
    }
  | { readonly kind: "error"; readonly text: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function sequenceOf(event: WaiverSessionEvent, index: number): number {
  return typeof event.seq === "number" ? event.seq : index;
}

function insertedMessage(
  event: WaiverSessionEvent,
  messageId: string,
): boolean {
  if (event.type !== "agent/inbox/spliced") return false;
  const data = record(event.data);
  if (data?.["target"] !== "next-turn" || !Array.isArray(data["inserted"])) {
    return false;
  }
  return data["inserted"].some((value) => {
    const message = record(value);
    const source = record(message?.["source"]);
    return message?.["id"] === messageId && source?.["kind"] === "user";
  });
}

/**
 * Validate the exact request against the command runtime's durable lifecycle.
 * The request message keeps the stock human source schema; identity and the
 * command's `sourceEventSeq` provide the replayable binding.
 */
export function collectReviewWaiver(
  session: WaiverSession,
  requestMessageId: string | null,
  requestSeq: number,
  candidateSeq: number,
): ReviewWaiverEvidence | null {
  if (requestMessageId === null) return null;
  const events = session.snapshotEvents();
  const eventsBySequence = new Map<number, WaiverSessionEvent>();
  const waiverRuns = new Map<string, number>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const sequence = sequenceOf(event, index);
    eventsBySequence.set(sequence, event);
    if (event.type !== "command/run") continue;
    const data = record(event.data);
    const source = record(data?.["source"]);
    if (
      typeof data?.["commandId"] === "string" &&
      data["name"] === REVIEW_WAIVER_COMMAND &&
      source?.["kind"] === "user"
    ) {
      waiverRuns.set(data["commandId"], sequence);
    }
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const done = events[index]!;
    const doneSeq = sequenceOf(done, index);
    if (doneSeq > candidateSeq || doneSeq >= requestSeq) continue;
    if (done.type !== "command/done") continue;
    const doneData = record(done.data);
    if (
      doneData?.["kind"] !== "success" ||
      typeof doneData["commandId"] !== "string" ||
      typeof doneData["sourceEventSeq"] !== "number"
    ) {
      continue;
    }

    const sourceEventSeq = doneData["sourceEventSeq"];
    if (sourceEventSeq >= doneSeq) continue;
    const sourceEvent = eventsBySequence.get(sourceEventSeq);
    if (
      sourceEvent === undefined ||
      !insertedMessage(sourceEvent, requestMessageId)
    ) {
      continue;
    }

    const commandId = doneData["commandId"];
    const runSeq = waiverRuns.get(commandId);
    if (runSeq === undefined || runSeq >= sourceEventSeq) continue;

    return { scope: "turn", via: "command", commandId };
  }
  return null;
}

function findAdmissionSequence(
  events: readonly WaiverSessionEvent[],
  messageId: string,
  fromIndex: number,
): number | null {
  for (let index = events.length - 1; index >= fromIndex; index -= 1) {
    const event = events[index]!;
    if (insertedMessage(event, messageId)) return sequenceOf(event, index);
  }
  return null;
}

/** Register the explicit one-request waiver command. */
export function registerReviewWaiverCommand(
  commands: ReviewWaiverCommandRegistry,
  config: () => ResolvedAnswerReviewGateConfig,
): () => void {
  return commands.register({
    name: REVIEW_WAIVER_COMMAND,
    description: "Send one request without automatic answer review.",
    input: { hint: "<request>", attachments: true },
    recordInput: false,
    handler(invocation): ReviewWaiverCommandResult {
      const current = config();
      if (!current.waiver.enabled) {
        return {
          kind: "error",
          text: "Review waivers are disabled by the deployment policy.",
        };
      }
      if (
        current.failMode === "closed" &&
        !current.waiver.allowedInClosedMode
      ) {
        return {
          kind: "error",
          text: "Review waivers are not allowed while the gate uses closed failure mode.",
        };
      }
      if (invocation.signal.aborted) {
        return { kind: "error", text: "The no-review request was cancelled." };
      }
      const request = invocation.rawInput.trim();
      if (request === "") {
        return { kind: "error", text: "Usage: /no-review <request>" };
      }

      const before = invocation.agent.session.snapshotEvents().length;
      const message = createUserMessage({
        content: [{ type: "text", text: request }, ...invocation.attachments],
        source: { kind: "user" },
      });
      invocation.agent.followup(message);
      const sourceEventSeq = findAdmissionSequence(
        invocation.agent.session.snapshotEvents(),
        String(message.id),
        before,
      );
      if (sourceEventSeq === null) {
        throw new Error(
          "no-review command could not locate its durable inbox admission",
        );
      }
      return {
        kind: "success",
        text: "Review skipped for this request. The answer will not be independently verified.",
        sourceEventSeq,
      };
    },
  });
}
