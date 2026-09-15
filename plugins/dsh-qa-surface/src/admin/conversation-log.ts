import type {
  QaConversationMessage,
  QaConversationToolCall,
  QaMessageUsage,
} from "../types.js";
import type { QaAdminRedactor } from "./redaction.js";

/**
 * Projection of a stored session log into the reviewer's transcript.
 *
 * The admin viewer reads the event log rather than the live agent state: a
 * conversation is reviewed weeks after it happened, usually on a process that
 * has never had it open. The projection therefore walks the raw event order and
 * shows what the log recorded — it does not re-derive model history, so a
 * compaction or a surface replacement never hides evidence from a reviewer.
 *
 * Messages are identified by their event `seq`, the one identity both the
 * durable log and the browser transcript agree on. A rating recorded against
 * `seq` keeps pointing at the same assistant message after the log is replayed.
 */

/** The events read back from durable storage; only these fields are used. */
export interface StoredSessionEvent {
  readonly seq: number;
  readonly time?: number;
  readonly type: string;
  readonly data?: unknown;
}

export interface QaProjectedTranscript {
  readonly title?: string;
  readonly messages: readonly QaConversationMessage[];
  readonly model?: string;
  readonly provider?: string;
  /** Skills the model loaded, in first-use order, from its skill tool calls. */
  readonly loadedSkills: readonly string[];
  /** Newest event time in the log, when the log carried one. */
  readonly lastActivity?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Flatten one message's content blocks into review text. Non-text blocks are
 * named rather than dropped: a reviewer judging "the answer ignored my
 * screenshot" needs to see that an image was attached.
 */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const entry = record(block);
    if (entry === undefined) continue;
    const text = string(entry.text);
    switch (entry.type) {
      case "text":
        if (text !== undefined) parts.push(text);
        break;
      case "reasoning":
        break;
      case "image":
        parts.push("[изображение]");
        break;
      case "file":
        parts.push("[файл]");
        break;
      case "tool-call":
        break;
      case "tool-result":
        parts.push(contentText(entry.content));
        break;
      default:
        if (text !== undefined) parts.push(text);
        break;
    }
  }
  return parts.filter((part) => part !== "").join("\n");
}

function usageOf(value: unknown): QaMessageUsage | undefined {
  const entry = record(value);
  if (entry === undefined) return undefined;
  const inputTokens = number(entry.inputTokens);
  const outputTokens = number(entry.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const totalTokens = number(entry.totalTokens);
  return Object.freeze({
    inputTokens,
    outputTokens,
    ...(totalTokens === undefined ? {} : { totalTokens }),
  });
}

/** The skill tool's argument shape, read defensively across schema revisions. */
function loadedSkillOf(name: string, args: string): string | undefined {
  if (name !== "skill") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(args === "" ? "null" : args);
  } catch {
    return undefined;
  }
  const entry = record(parsed);
  if (entry === undefined) return undefined;
  for (const key of ["name", "skill", "skillName", "id"]) {
    const value = string(entry[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Project one log into the review transcript. Unknown event types are skipped,
 * not refused: a deployment may carry plugin events this package has never
 * heard of, and a review console must still show the conversation.
 */
export function projectTranscript(
  events: readonly StoredSessionEvent[],
  redactor: QaAdminRedactor,
): QaProjectedTranscript {
  const messages: QaConversationMessage[] = [];
  /** Which message each call was attached to, so its result lands in place. */
  const callOwner = new Map<string, { message: number; call: number }>();
  const loaded: string[] = [];
  let title: string | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let lastActivity: number | undefined;
  let lastAssistant = -1;

  const attachCalls = (
    index: number,
    update: (
      calls: readonly QaConversationToolCall[],
    ) => readonly QaConversationToolCall[],
  ): void => {
    const owner = messages[index];
    if (owner === undefined) return;
    messages[index] = Object.freeze({
      ...owner,
      toolCalls: Object.freeze(update(owner.toolCalls ?? [])),
    });
  };

  const ordered = [...events].sort((left, right) => left.seq - right.seq);

  for (const event of ordered) {
    if (event.time !== undefined && event.time !== lastActivity) {
      lastActivity = event.time;
    }
    const data = record(event.data);
    if (data === undefined) continue;
    switch (event.type) {
      case "session/title": {
        const value = string(data.title);
        if (value !== undefined) title = value;
        break;
      }
      case "request/header": {
        const header = record(data.header);
        const config = record(header?.config);
        provider = string(config?.provider) ?? provider;
        model = string(config?.model) ?? model;
        break;
      }
      case "user/message": {
        const source = record(data.source);
        // Synthetic context (injected skills, file notices) is model input, not
        // something the user said; the reviewer reads human prompts here.
        if (source?.kind !== "user") break;
        lastAssistant = -1;
        messages.push(
          Object.freeze({
            id: String(event.seq),
            seq: event.seq,
            role: "user" as const,
            text: redactor.redactMessage(contentText(data.content)),
            time: event.time ?? 0,
          }),
        );
        break;
      }
      case "assistant/message": {
        const message = record(data.message);
        const source = record(message?.source);
        const usage = usageOf(data.usage);
        const messageModel = string(source?.model);
        const messageProvider = string(source?.provider);
        lastAssistant = messages.length;
        messages.push(
          Object.freeze({
            id: String(event.seq),
            seq: event.seq,
            role: "assistant" as const,
            text: redactor.redactMessage(contentText(message?.content)),
            time: event.time ?? 0,
            ...(messageModel === undefined ? {} : { model: messageModel }),
            ...(messageProvider === undefined
              ? {}
              : { provider: messageProvider }),
            ...(usage === undefined ? {} : { usage }),
            ...(data.interrupted === true ? { interrupted: true } : {}),
            toolCalls: Object.freeze([]),
          }),
        );
        break;
      }
      case "tool/call": {
        const callId = string(data.callId);
        const name = string(data.name);
        if (callId === undefined || name === undefined) break;
        const args = string(data.arguments) ?? "";
        const skill = loadedSkillOf(name, args);
        if (skill !== undefined && !loaded.includes(skill)) loaded.push(skill);
        const call: QaConversationToolCall = {
          callId,
          name,
          arguments: redactor.redactToolArguments(args),
          ...(event.time === undefined ? {} : { time: event.time }),
        };
        let index = lastAssistant;
        if (index === -1) {
          // A call whose requesting message never reached the log (an aborted
          // turn) still belongs in the transcript: the reviewer is often
          // looking for exactly that.
          index = messages.length;
          messages.push(
            Object.freeze({
              id: String(event.seq),
              seq: event.seq,
              role: "assistant" as const,
              text: "",
              time: event.time ?? 0,
              toolCalls: Object.freeze([]),
            }),
          );
          lastAssistant = index;
        }
        callOwner.set(callId, {
          message: index,
          call: (messages[index]?.toolCalls ?? []).length,
        });
        attachCalls(index, (calls) => [...calls, call]);
        break;
      }
      case "tool/result": {
        const message = record(data.message);
        const first = Array.isArray(message?.content)
          ? record(message?.content[0])
          : undefined;
        const callId = string(data.callId) ?? string(first?.toolCallId);
        if (callId === undefined) break;
        const owner = callOwner.get(callId);
        if (owner === undefined) break;
        const result = redactor.redactToolResult(contentText(first?.content));
        const error = record(data.error);
        const errorName = string(error?.name);
        const current = messages[owner.message]?.toolCalls?.[owner.call];
        const duration =
          event.time === undefined || current?.time === undefined
            ? undefined
            : Math.max(0, event.time - current.time);
        attachCalls(owner.message, (calls) =>
          calls.map((call, index) =>
            index !== owner.call
              ? call
              : Object.freeze({
                  ...call,
                  ...(result === "" ? {} : { result }),
                  ...(first?.isError === true || errorName !== undefined
                    ? { error: errorName ?? "tool-error" }
                    : {}),
                  ...(duration === undefined ? {} : { durationMs: duration }),
                }),
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  return Object.freeze({
    ...(title === undefined ? {} : { title }),
    messages: Object.freeze(messages),
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    loadedSkills: Object.freeze(loaded),
    ...(lastActivity === undefined ? {} : { lastActivity }),
  });
}
