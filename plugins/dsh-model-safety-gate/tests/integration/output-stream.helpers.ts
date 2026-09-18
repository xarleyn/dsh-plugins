import type { AgentLookup } from "../../src/stream/cancellation.js";
import type { StreamChunk } from "../../src/stream/chunks.js";

export function chunkStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

export async function collect(
  stream: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

export function textChunks(
  text: string,
  size: number,
  startIndex = 0,
): StreamChunk[] {
  const chunks: StreamChunk[] = [
    { type: "block-start", index: startIndex, blockType: "text" },
  ];
  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push({
      type: "text-delta",
      index: startIndex,
      text: text.slice(offset, offset + size),
    });
  }
  chunks.push({
    type: "block-end",
    index: startIndex,
    block: { type: "text", text: "" },
  });
  return chunks;
}

export const baseConfig = {
  output: {
    enabled: true,
    mode: "buffered" as const,
    text: true,
    reasoning: true,
    checkEveryChars: 24,
    windowChars: 128,
    lookbehindChars: 48,
    minCheckIntervalMs: 0,
    maxBufferedChars: 512,
  },
};

export function makeLookup(calls: string[]): {
  lookup: AgentLookup;
  agent: { id: string; cancel: (cause: unknown, options?: unknown) => void };
} {
  const agent = {
    id: "session-1",
    cancel: (cause: unknown, options?: unknown) => {
      calls.push(`cancel:${JSON.stringify(cause)}:${JSON.stringify(options)}`);
    },
  };
  return {
    lookup: (sessionId) => (sessionId === "session-1" ? agent : undefined),
    agent,
  };
}
