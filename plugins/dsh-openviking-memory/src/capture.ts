/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 *
 * Turn capture: turn one DSH session event into the payload OpenViking's
 * `addMessage` endpoint accepts, or drop it.
 */

import type { UserMessage } from "@deepseek-ai/dsh-llm";

import {
  extractPartsFromPayload,
  extractTextFromPayload,
  shouldCaptureText,
  type CapturedPart,
  type CaptureConfig,
} from "./openviking/capture-utils.js";

/**
 * The producer kind every message this plugin injects attributes itself to.
 *
 * Kept as a named export because it is the marker the upstream plugin wrote
 * into its injected blocks (`docs/specs/fork.md`); since 0.1.7 it is also the
 * only place this plugin's own context can be recognised.
 */
export const OPENVIKING_PLUGIN_SOURCE = "openviking-memory";

/**
 * This plugin's own producer source kind, declared the way the harness declares
 * its own: the `@deepseek-ai/dsh-llm` source map is merge-extensible and ships
 * no catch-all `plugin` kind, so every producer names itself here.
 *
 * `kind` says *who produced this*, `form` says *what kind of thing it is* — and
 * this plugin only ever injects the profile it was told to keep, or memories it
 * lifted out of earlier sessions.
 */
export interface OpenVikingMemoryMessageSource {
  readonly kind: typeof OPENVIKING_PLUGIN_SOURCE;
  readonly form: "instructions" | "recall";
}

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "openviking-memory": OpenVikingMemoryMessageSource;
  }
}

/**
 * Producer kinds whose text is conversation.
 *
 * A user turn, an assistant answer and a tool result are things that happened
 * in this chat. Everything else the (merge-extensible) map can carry — this
 * plugin's recall blocks, another producer's injected context, a host notice,
 * the `tool-registry` churn a `developer/message` brings — is model *input*,
 * and mirroring it would launder synthetic text into memory as if a person had
 * said it. So the list admits, and an unknown kind never reaches memory.
 */
const CAPTURED_SOURCE_KINDS = new Set(["user", "model", "tool"]);

/** The subset of a session event the capture path reads. */
export interface CaptureSessionEvent {
  readonly type?: string;
  readonly time?: number;
  readonly data?: unknown;
}

/** One `addMessage` request body. */
export interface CapturePayload {
  role: "user" | "assistant";
  parts?: CapturedPart[];
  content?: string;
  created_at?: string;
  peer_id?: string;
}

/**
 * Capture one session event into an `addMessage` payload.
 *
 * `toolNames` is the per-session callId → tool-name map maintained here: only
 * `tool/call` events fill it, and a matching `tool/result` consumes its entry
 * in the `finally` block so the map cannot grow without bound.
 */
export function captureEvent(
  event: CaptureSessionEvent | null | undefined,
  config: CaptureConfig,
  toolNames: Map<string, string> = new Map(),
): CapturePayload | null {
  if (!event || typeof event !== "object") return null;
  if (event.type === "tool/call") {
    const data = event.data as { callId?: unknown; name?: unknown } | undefined;
    if (config.captureToolResults === true) {
      toolNames.set(String(data?.callId), String(data?.name));
    }
    return null;
  }

  const message = eventMessage(event);
  if (!message) return null;
  const toolCallId =
    event.type === "tool/result" ? String(toolCallIdOf(message) || "") : "";
  try {
    return captureMessage(event, message, config, toolNames);
  } finally {
    if (toolCallId) toolNames.delete(toolCallId);
  }
}

type MessageLike = {
  readonly role?: unknown;
  readonly content?: unknown;
  readonly source?: {
    readonly kind?: unknown;
    readonly callId?: unknown;
  } & Record<string, unknown>;
  readonly [key: string]: unknown;
};

function captureMessage(
  event: CaptureSessionEvent,
  message: MessageLike,
  config: CaptureConfig,
  toolNames: Map<string, string>,
): CapturePayload | null {
  // Whitelist by producer, not by a deny-list of injected kinds: the source map
  // grows one producer at a time, and a kind this plugin has never heard of is
  // not conversation either.
  if (!CAPTURED_SOURCE_KINDS.has(String(message.source?.kind ?? ""))) {
    return null;
  }
  if (message.role === "assistant" && config.captureAssistantTurns === false) {
    return null;
  }
  if (message.source?.kind === "tool" && config.captureToolResults !== true) {
    return null;
  }

  const role = message.role === "assistant" ? "assistant" : "user";
  const toolNameById = Object.fromEntries(toolNames);
  const rawText = extractTextFromPayload(message, {
    toolMaxChars: config.captureToolMaxChars,
  });
  const parts = extractPartsFromPayload(message, {
    toolMaxChars: config.captureToolMaxChars,
    toolNameById,
  });
  const decision = shouldCaptureText(rawText, role, config);
  const structuredParts = parts.filter((part) => part?.type !== "text");
  if (!decision.shouldCapture && structuredParts.length === 0) return null;

  const hasTextPart = parts.some((part) => part?.type === "text");
  const bodyParts: CapturedPart[] = [
    ...(hasTextPart && decision.shouldCapture && decision.text
      ? [{ type: "text" as const, text: decision.text }]
      : []),
    ...structuredParts,
  ];
  const payload: CapturePayload =
    bodyParts.length > 0
      ? { role, parts: bodyParts }
      : { role, content: decision.text };
  const createdAt = eventCreatedAt(event);
  if (createdAt) payload.created_at = createdAt;
  if (config.peerId) payload.peer_id = config.peerId;
  return payload;
}

/**
 * The prompt a recall is searched for: every model-visible message of the
 * step's claimed batch except this plugin's own injected blocks, which would
 * otherwise make memory retrieve itself.
 */
export function promptText(
  messages: readonly UserMessage[] | null | undefined,
): string {
  return (messages || [])
    .filter((message) => message?.source?.kind !== OPENVIKING_PLUGIN_SOURCE)
    .map((message) => extractTextFromPayload(message))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function toolCallIdOf(message: MessageLike): unknown {
  const content = Array.isArray(message.content) ? message.content : [];
  const first = content[0] as { toolCallId?: unknown } | undefined;
  return message.source?.callId || first?.toolCallId || "";
}

function eventMessage(event: CaptureSessionEvent): MessageLike | null {
  switch (event.type) {
    case "user/message":
      return (event.data ?? null) as MessageLike | null;
    case "assistant/message":
    case "tool/result": {
      const data = event.data as { message?: unknown } | undefined;
      return (data?.message ?? null) as MessageLike | null;
    }
    default:
      return null;
  }
}

function eventCreatedAt(event: CaptureSessionEvent): string {
  const time = Number(event?.time);
  if (!Number.isFinite(time) || time < 0) return "";
  try {
    return new Date(time).toISOString();
  } catch {
    return "";
  }
}
