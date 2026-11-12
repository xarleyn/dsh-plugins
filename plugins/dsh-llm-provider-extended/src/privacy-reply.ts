import { createHash } from "node:crypto";
import { LlmError, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { aliasPattern, type PrivacyFilter } from "./privacy-rules.js";

type Span = readonly [start: number, end: number, kind: string];
interface RestoredSpans {
  digest: string;
  spans: Span[];
}
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** One stream, shared with the filter populated by that SDK call's onPayload. */
export class PrivacyReply {
  private readonly pending = new Map<number, string>();
  private readonly received = new Map<number, number>();
  private readonly restoredBlocks = new Map<number, RestoredSpans>();
  // A model can repeat one short token for a much longer original many times.
  // Covers both the incremental and authoritative block representations.
  private expansionLeft = 8_000_000;
  private spansLeft = 32768;
  private visibleTags = new Set<string>();

  constructor(private readonly filter: PrivacyFilter) {}

  /** Only reveal a value echoed from conversation text or a tool result. A tag
   * found exclusively in a system prompt, tool definition or reasoning stays opaque.
   */
  acceptPayload(payload: unknown): void {
    this.visibleTags.clear();
    if (!payload || typeof payload !== "object") return;
    const content = (value: unknown): void => {
      if (typeof value === "string") {
        for (const match of value.matchAll(aliasPattern)) {
          if (this.filter.replyAliases.has(match[0]))
            this.visibleTags.add(match[0]);
        }
      } else if (Array.isArray(value)) {
        for (const block of value) {
          if (["text", "input_text", "output_text"].includes(block?.type))
            content(block.text);
          else if (block?.type === "tool_result") content(block.content);
        }
      }
    };
    const messages =
      "messages" in payload
        ? payload.messages
        : "input" in payload
          ? payload.input
          : undefined;
    if (typeof messages === "string") content(messages);
    if (!Array.isArray(messages)) return;
    for (const item of messages) {
      if (["user", "assistant", "tool"].includes(item?.role))
        content(item.content);
      else if (item?.type === "function_call_output") content(item.output);
    }
  }

  private restore(text: string, spans?: Span[]): string {
    let shift = 0;
    return text.replace(
      aliasPattern,
      (tag: string, kind: string, offset: number) => {
        if (!this.visibleTags.has(tag)) return tag;
        const original = this.filter.replyAliases.get(tag);
        if (original === undefined) return tag;
        const growth = original.length - tag.length;
        this.expansionLeft -= Math.max(0, growth);
        if (this.expansionLeft < 0 || (spans && --this.spansLeft < 0))
          throw new LlmError(
            "Restored reply exceeds the text limit",
            "UNSUPPORTED_CONTENT",
          );
        const start = offset + shift;
        spans?.push([start, start + original.length, kind]);
        shift += growth;
        return original;
      },
    );
  }

  *flush(): Generator<StreamChunk> {
    for (const [index, text] of this.pending)
      yield { type: "text-delta", index, text };
    this.pending.clear();
  }

  *push(chunk: StreamChunk): Generator<StreamChunk> {
    if (!this.visibleTags.size) {
      yield chunk;
      return;
    }
    if (chunk.type === "text-delta") {
      this.received.set(
        chunk.index,
        (this.received.get(chunk.index) ?? 0) + chunk.text.length,
      );
      const text = (this.pending.get(chunk.index) ?? "") + chunk.text;
      const bracket = text.lastIndexOf("[");
      let end = text.length;
      if (bracket >= 0 && this.filter.isReplyAliasPrefix(text.slice(bracket))) {
        end = bracket;
        this.pending.set(chunk.index, text.slice(bracket));
      } else {
        this.pending.delete(chunk.index);
      }
      if (end > 0) yield { ...chunk, text: this.restore(text.slice(0, end)) };
      return;
    }
    if (chunk.type === "block-end" && chunk.block.type === "text") {
      const tail = this.pending.get(chunk.index) ?? "";
      const displayed = (this.received.get(chunk.index) ?? 0) - tail.length;
      this.received.delete(chunk.index);
      this.pending.delete(chunk.index);
      // Some endpoints supply the last part only in the completed text event.
      const remainder = chunk.block.text.slice(displayed);
      if (remainder)
        yield {
          type: "text-delta",
          index: chunk.index,
          text: this.restore(remainder),
        };
      const spans: Span[] = [];
      const text = this.restore(chunk.block.text, spans);
      if (spans.length)
        this.restoredBlocks.set(chunk.index, { digest: digest(text), spans });
      yield { ...chunk, block: { ...chunk.block, text } };
      return;
    }
    if (chunk.type === "usage" || chunk.type === "finish") yield* this.flush();
    if (
      chunk.type === "finish" &&
      chunk.replayState?.blocks &&
      this.restoredBlocks.size
    ) {
      const blocks = chunk.replayState.blocks.map((block, i) => {
        const privacySpans = this.restoredBlocks.get(i);
        return privacySpans && typeof block === "object" && block !== null
          ? { ...block, privacySpans }
          : block;
      });
      yield { ...chunk, replayState: { ...chunk.replayState, blocks } };
      return;
    }
    yield chunk;
  }
}

/** Reissue aliases on the next request, including a bare amount originally found in JSON.
 * The replay envelope holds offsets and an integrity check. Only the local chat holds the originals.
 */
export function remaskReply(
  text: string,
  metadata: unknown,
  filter: PrivacyFilter,
): string {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("privacySpans" in metadata)
  )
    return text;
  const record = metadata.privacySpans;
  const invalid = (): never => {
    throw new LlmError(
      "The saved reply does not match its masking metadata",
      "UNSUPPORTED_CONTENT",
    );
  };
  if (
    !record ||
    typeof record !== "object" ||
    !("digest" in record) ||
    record.digest !== digest(text) ||
    !("spans" in record) ||
    !Array.isArray(record.spans) ||
    record.spans.length > 32768
  )
    return invalid();
  const parts: string[] = [];
  let offset = 0;
  for (const span of record.spans) {
    if (!Array.isArray(span) || span.length !== 3) return invalid();
    const [start, end, kind] = span as unknown[];
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < offset ||
      end <= start ||
      end > text.length ||
      typeof kind !== "string" ||
      !["AMOUNT", "CLIENT", "CUSTOM", "EMAIL", "PHONE"].includes(kind)
    )
      return invalid();
    const original = text.slice(start, end);
    if (kind === "AMOUNT") filter.learnAmount(original);
    if (kind === "CLIENT") filter.learnName(original);
    parts.push(text.slice(offset, start), filter.alias(kind, original));
    offset = end;
  }
  return parts.join("") + text.slice(offset);
}
