import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-runtime/client";
import type { QaMessage } from "../types.js";

function visibleContentText(content: readonly unknown[]): string {
  return content
    .flatMap((block) => {
      if (typeof block !== "object" || block === null) return [];
      return Reflect.get(block, "type") === "text" &&
        typeof Reflect.get(block, "text") === "string"
        ? [Reflect.get(block, "text") as string]
        : [];
    })
    .join("");
}

function visibleAssistantText(
  blocks: readonly { readonly kind: string; readonly text?: string }[],
): string {
  return blocks
    .filter(
      (block): block is { readonly kind: "text"; readonly text: string } =>
        block.kind === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/** Project only end-user-safe text from the public DSH conversation snapshot. */
export function projectTranscript(
  snapshot: ConversationSnapshot,
  options: { readonly showToolActivity?: boolean } = {},
): readonly QaMessage[] {
  const messages: QaMessage[] = [];
  for (const node of snapshot.nodes) {
    if (node.kind === "user" || node.kind === "steering") {
      const text = visibleContentText(node.content);
      if (text !== "") {
        messages.push({
          id: `${node.kind}:${node.seq}`,
          role: "user",
          text,
          status: "committed",
          timestamp: node.time,
        });
      }
      continue;
    }
    if (node.kind === "assistant") {
      const text = visibleAssistantText(node.blocks);
      if (text !== "") {
        messages.push({
          id: `assistant:${node.messageId ?? node.seq}`,
          role: "assistant",
          text,
          status: "committed",
          timestamp: node.time,
        });
      }
      continue;
    }
    if (node.kind === "turn-error") {
      messages.push({
        id: `turn-error:${node.seq}`,
        role: "system",
        text: "The assistant could not complete this response.",
        status: "error",
        timestamp: node.time,
      });
      continue;
    }
    if (node.kind === "turn-max-tokens") {
      messages.push({
        id: `turn-max-tokens:${node.seq}`,
        role: "system",
        text: "The response reached its length limit.",
        status: "info",
        timestamp: node.time,
      });
    }
  }

  if (snapshot.partial !== null) {
    const text = visibleAssistantText(snapshot.partial.blocks);
    if (text !== "") {
      messages.push({
        id: `assistant:partial:${snapshot.partial.turn}:${snapshot.partial.step}`,
        role: "assistant",
        text,
        status: "streaming",
      });
    }
  }
  if (
    options.showToolActivity === true &&
    snapshot.runningCalls.length > 0 &&
    snapshot.partial === null
  ) {
    messages.push({
      id: "tool-activity",
      role: "system",
      text: "Working…",
      status: "info",
    });
  }
  return messages;
}
