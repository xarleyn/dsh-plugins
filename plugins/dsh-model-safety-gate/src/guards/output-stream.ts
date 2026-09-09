/**
 * The output stream guard (design SPEC §10–§15, §33).
 *
 * Wraps the `llm/stream` AsyncIterable. Modes:
 *  - `observe`: everything passes through; window checks run for audit only.
 *  - `interrupt`: chunks pass through; a detected violation stops the
 *    generation (an unsafe prefix may already be visible).
 *  - `buffered` (default): text/reasoning chunks are quarantined per channel
 *    until their rolling-window snapshot passes; blocked windows and their
 *    pending buffer never reach downstream; the active turn is cancelled so
 *    the abort reaches the provider.
 *
 * Stream invariants (§33): quarantined content is released in original order
 * together with its stashed `block-start`, so no half block structure is ever
 * emitted; `usage`/`finish` flush pending content through a final check.
 */

import type { ResolvedSafetyGateConfig } from "../config.js";
import type { CheckPipeline } from "../pipeline.js";
import { isDeltaChunk, blockedFinish, type DeltaChunk, type StreamChunk, type StreamFailure } from "../stream/chunks.js";
import { ChannelQuarantine, ReleasedTail, PassThroughMonitor } from "../stream/quarantine.js";
import { cancelTurn, type AgentLookup } from "../stream/cancellation.js";
import type { ContentChannel, SafetyDecision, SafetyErrorCode } from "../types.js";

export interface OutputStreamGuardOptions {
  readonly config: ResolvedSafetyGateConfig;
  readonly pipeline: CheckPipeline;
  readonly agentLookup: AgentLookup;
  readonly sessionId: string | null;
  readonly turn: number | null;
  readonly step: number | null;
}

type OutputChannel = Extract<ContentChannel, "text" | "reasoning">;

interface BlockChannelState {
  readonly channel: OutputChannel;
  readonly index: number;
  readonly quarantine: ChannelQuarantine;
  readonly monitor: PassThroughMonitor;
  readonly tail: ReleasedTail;
}

export function guardOutputStream(
  upstream: AsyncIterable<StreamChunk>,
  options: OutputStreamGuardOptions,
): AsyncIterable<StreamChunk> {
  const { config, pipeline } = options;
  const mode = config.output.mode;
  if (!config.output.enabled) return upstream;
  const quarantining = mode === "buffered";

  return (async function* () {
    const channels = new Map<string, BlockChannelState>();
    // Wrapped in a ref so closure writes are visible without CFA narrowing.
    const stoppedRef: { value: { failure: StreamFailure; preventedChars: number } | null } = { value: null };

    const keyOf = (channel: OutputChannel, index: number): string => `${channel}:${index}`;

    const createState = (channel: OutputChannel, index: number): BlockChannelState => ({
      channel,
      index,
      quarantine: new ChannelQuarantine({
        checkEveryChars: config.output.checkEveryChars,
        windowChars: config.output.windowChars,
        lookbehindChars: config.output.lookbehindChars,
        minCheckIntervalMs: config.output.minCheckIntervalMs,
        maxBufferedChars: config.output.maxBufferedChars,
      }),
      monitor: new PassThroughMonitor({
        checkEveryChars: config.output.checkEveryChars,
        lookbehindChars: config.output.lookbehindChars,
        minCheckIntervalMs: config.output.minCheckIntervalMs,
      }),
      tail: new ReleasedTail(config.output.lookbehindChars),
    });

    const stop = (code: SafetyErrorCode, message: string, preventedChars: number): void => {
      if (stoppedRef.value !== null) return;
      stoppedRef.value = { failure: { message, code }, preventedChars };
    };

    const check = async (state: BlockChannelState, content: string): Promise<SafetyDecision> => {
      const result = await pipeline.run({
        content,
        channel: state.channel,
        direction: "output",
        classifierTrigger: "always",
        sessionId: options.sessionId,
        turn: options.turn,
        step: options.step,
      });
      return result.decision;
    };

    /** Final-check and flush pending quarantined content. Returns null on block. */
    const finalizePending = async (state: BlockChannelState): Promise<StreamChunk[] | null> => {
      if (!state.quarantine.hasPending) return [];
      const decision = await check(state, state.quarantine.snapshotText(state.tail.tail()));
      state.quarantine.markChecked(Date.now());
      if (decision === "block") {
        stop(codeFor(state.channel), `blocked ${state.channel} output by safety policy`, state.quarantine.size);
        return null;
      }
      return collectFlush(state);
    };

    const collectFlush = (state: BlockChannelState): StreamChunk[] => {
      const flushed = state.quarantine.flush();
      const chunks: StreamChunk[] = [];
      if (flushed.blockStart !== null) chunks.push(flushed.blockStart as StreamChunk);
      for (const text of flushed.texts) {
        // The lookbehind tail must cover every released char, not just the
        // newest chunk — otherwise a phrase split across two release points
        // escapes the next window snapshot (SPEC §12).
        state.tail.append(text);
        chunks.push(makeDelta(state.channel, state.index, text));
      }
      return chunks;
    };

    const finalizeAll = async (): Promise<StreamChunk[] | null> => {
      const out: StreamChunk[] = [];
      for (const state of channels.values()) {
        const chunks = await finalizePending(state);
        if (chunks === null) return null;
        out.push(...chunks);
      }
      return out;
    };

    for await (const chunk of upstream) {
      if (stoppedRef.value !== null) break;

      if (chunk.type === "block-start") {
        if (isGuardedBlockType(chunk.blockType) && config.output[channelFor(chunk.blockType)]) {
          const channel = channelFor(chunk.blockType);
          const state = createState(channel, chunk.index);
          channels.set(keyOf(channel, chunk.index), state);
          if (quarantining) {
            state.quarantine.stashBlockStart(chunk);
          } else {
            yield chunk;
          }
        } else {
          yield chunk;
        }
        continue;
      }

      if (isDeltaChunk(chunk)) {
        const channel: OutputChannel = chunk.type === "text-delta" ? "text" : "reasoning";
        const state = channels.get(keyOf(channel, chunk.index));
        if (state === undefined) {
          yield chunk;
          continue;
        }

        if (!quarantining) {
          // observe/interrupt: content is already visible, monitor for audit
          // (observe) and detection (interrupt).
          yield chunk;
          const due = state.monitor.append(chunk.text, Date.now());
          if (due === "check") {
            const decision = await check(state, state.monitor.windowText());
            state.monitor.markChecked(Date.now());
            if (decision === "block" && mode === "interrupt") {
              stop(codeFor(channel), `blocked ${channel} output by safety policy`, 0);
              break;
            }
          }
          continue;
        }

        const verdict = state.quarantine.append(chunk.text, Date.now());
        if (verdict === "overflow") {
          pipeline.metrics.recordBufferOverflow();
          stop("SAFETY_BUFFER_OVERFLOW", "quarantine buffer overflow; failing closed", state.quarantine.size);
          break;
        }
        if (verdict === "buffer") continue;

        state.quarantine.classifierRunning = true;
        const decision = await check(state, state.quarantine.snapshotText(state.tail.tail()));
        state.quarantine.markChecked(Date.now());
        state.quarantine.classifierRunning = false;

        if (decision === "block") {
          stop(codeFor(channel), `blocked ${channel} output by safety policy`, state.quarantine.size);
          break;
        }
        for (const flushed of collectFlush(state)) yield flushed;
        continue;
      }

      if (chunk.type === "block-end") {
        let blockedHere = false;
        for (const state of channels.values()) {
          if (state.index !== chunk.index) continue;
          if (!quarantining && state.monitor.hasUnchecked()) {
            const decision = await check(state, state.monitor.windowText());
            state.monitor.markChecked(Date.now());
            if (decision === "block" && mode === "interrupt") {
              stop(codeFor(state.channel), `blocked ${state.channel} output by safety policy`, 0);
              blockedHere = true;
              break;
            }
            continue;
          }
          const flushed = await finalizePending(state);
          if (flushed === null) {
            blockedHere = true;
            break;
          }
          for (const pending of flushed) yield pending;
        }
        if (blockedHere || stoppedRef.value !== null) break;
        yield chunk;
        continue;
      }

      if (chunk.type === "usage" || chunk.type === "finish") {
        if (!quarantining) {
          // observe/interrupt: run the final window check over unchecked tail
          // content so audit captures violations spanning the last chunks.
          for (const state of channels.values()) {
            if (!state.monitor.hasUnchecked()) continue;
            const decision = await check(state, state.monitor.windowText());
            state.monitor.markChecked(Date.now());
            if (decision === "block" && mode === "interrupt") {
              stop(codeFor(state.channel), `blocked ${state.channel} output by safety policy`, 0);
              break;
            }
          }
        } else {
          const flushed = await finalizeAll();
          if (flushed === null) break;
          for (const pending of flushed) yield pending;
        }
        if (stoppedRef.value !== null) break;
        yield chunk;
        continue;
      }

      // tool-call-delta and anything else pass through; tool calls are gated
      // on tools/pre-execute where arguments are complete (SPEC §17).
      yield chunk;
    }

    const stopped = stoppedRef.value;
    if (stopped !== null) {
      pipeline.metrics.recordQuarantinedChars(stopped.preventedChars);
      pipeline.metrics.recordPreventedOutput(stopped.preventedChars);
      cancelTurn(options.agentLookup, options.sessionId, `Blocked by dsh-model-safety-gate: ${stopped.failure.code}`);
      yield blockedFinish(stopped.failure);
    }
  })();
}

function isGuardedBlockType(blockType: unknown): blockType is "text" | "reasoning" {
  return blockType === "text" || blockType === "reasoning";
}

function channelFor(blockType: "text" | "reasoning"): OutputChannel {
  return blockType;
}

function makeDelta(channel: OutputChannel, index: number, text: string): DeltaChunk {
  return channel === "text" ? { type: "text-delta", index, text } : { type: "reasoning-delta", index, text };
}

function codeFor(channel: OutputChannel): SafetyErrorCode {
  return channel === "reasoning" ? "SAFETY_REASONING_BLOCKED" : "SAFETY_OUTPUT_BLOCKED";
}
