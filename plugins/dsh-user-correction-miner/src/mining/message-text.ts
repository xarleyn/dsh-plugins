import type { ContentBlock, Message, UserMessage } from "@deepseek-ai/dsh-llm";

function blockText(block: ContentBlock): string[] {
  if (block.type === "text") return [block.text];
  if (block.type === "tool-result") return block.content.flatMap(blockText);
  return [];
}

export function messageText(message: Pick<Message, "content">): string {
  return message.content.flatMap(blockText).join("\n").trim();
}

export function isDirectUserMessage(message: UserMessage): boolean {
  return message.source.kind === "user";
}
