import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import type { CallResult } from "../shared/telemetry.js";

/** Lifecycle callbacks used by the transparent stream wrapper. */
export interface StreamObservation {
  observeUsage(usage: Extract<StreamChunk, { type: "usage" }>["usage"]): void;
  finish(result: CallResult): void;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

/**
 * Observe usage and terminal state while yielding every downstream chunk once,
 * unchanged and without buffering. Early consumer return is recorded as abort.
 */
export async function* observeStream(
  downstream: AsyncIterable<StreamChunk>,
  observation: StreamObservation,
): AsyncIterable<StreamChunk> {
  let terminal = false;
  try {
    for await (const chunk of downstream) {
      if (chunk.type === "usage") observation.observeUsage(chunk.usage);
      if (chunk.type === "finish") {
        terminal = true;
        if (chunk.reason.kind === "aborted") {
          observation.finish({ kind: "aborted" });
        } else if (chunk.reason.kind === "error") {
          observation.finish({
            kind: "error",
            ...(chunk.reason.failure.code.length === 0
              ? {}
              : { code: chunk.reason.failure.code }),
          });
        } else {
          observation.finish({ kind: "success" });
        }
      }
      yield chunk;
    }
    if (!terminal) {
      terminal = true;
      observation.finish({ kind: "error", code: "STREAM_INCOMPLETE" });
    }
  } catch (error: unknown) {
    if (!terminal) {
      terminal = true;
      const code = errorCode(error);
      observation.finish({
        kind: "error",
        ...(code === undefined ? {} : { code }),
      });
    }
    throw error;
  } finally {
    if (!terminal) observation.finish({ kind: "aborted" });
  }
}
