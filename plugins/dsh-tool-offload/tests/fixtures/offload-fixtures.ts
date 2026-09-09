/**
 * Shared test fixtures: bounded filler text, fake tool executions/results,
 * fake parent agents, a scripted fake worker runner, and a capturing logger
 * for "no raw content in logs" assertions (SPEC §32).
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";

import { resolveToolOffloadConfig, type ToolOffloadConfig } from "../../src/config.js";
import type { PluginLoggerLike } from "../../src/logging.js";
import type { ResolvedToolOffloadConfig } from "../../src/config.js";
import type { WorkerOutcome, WorkerRunRequest, WorkerRunnerLike } from "../../src/worker/runner.js";

const FILLER = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu\n";

/** Deterministic filler text of at least `targetBytes` UTF-8 bytes. */
export function makeText(targetBytes: number): string {
  const lines = Math.max(1, Math.ceil(targetBytes / FILLER.length));
  return FILLER.repeat(lines).slice(0, Math.max(targetBytes, FILLER.length));
}

/** Deterministic log-like filler with warn/error patterns. */
export function makeLog(targetBytes: number): string {
  const line = "2026-09-09T12:00:00Z WARN  worker pool saturated; retrying (error=ETIMEDOUT)\n";
  const lines = Math.max(1, Math.ceil(targetBytes / line.length));
  return line.repeat(lines).slice(0, Math.max(targetBytes, line.length));
}

/** Prompt-injection fixture (SPEC §32.4). */
export async function injectionFixture(): Promise<string> {
  return readFile(fileURLToPath(new URL("./injection.txt", import.meta.url)), "utf8");
}

export function fakeExec(name: string, overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    callId: "call-1",
    rootCallId: "call-1",
    name,
    arguments: {},
    token: Symbol("token") as ToolExecution["token"],
    signal: new AbortController().signal,
    ...overrides,
  } as ToolExecution;
}

export function successResult(text: string): ToolExecutionResult {
  return { isError: false, value: { text }, content: [{ type: "text", text }] } as ToolExecutionResult;
}

export function errorResult(text: string): ToolExecutionResult {
  return {
    isError: true,
    error: { message: text },
    content: [{ type: "text", text }],
  } as unknown as ToolExecutionResult;
}

/** Fake parent agent with a structural session; `origin` defaults to a local session. */
export function fakeAgent(options: { origin?: string; id?: string; userMessage?: string } = {}): NonNullable<ToolExecution["agent"]> {
  const events: unknown[] = [];
  if (options.userMessage !== undefined) {
    events.push({
      type: "user/message",
      data: {
        source: { kind: "user" },
        content: [{ type: "text", text: options.userMessage }],
      },
    });
  }
  return {
    session: {
      id: options.id ?? "session-1",
      header: { origin: options.origin ?? "local" },
      events,
    },
  } as unknown as NonNullable<ToolExecution["agent"]>;
}

export type RecordedWorkerRequest = WorkerRunRequest;

/** Scripted fake runner: returns queued outcomes and records every request. */
export class FakeRunner implements WorkerRunnerLike {
  readonly requests: RecordedWorkerRequest[] = [];
  private queue: WorkerOutcome[] = [];

  respond(...outcomes: WorkerOutcome[]): this {
    this.queue.push(...outcomes);
    return this;
  }

  async run(request: WorkerRunRequest): Promise<WorkerOutcome> {
    this.requests.push(request);
    const outcome = this.queue.shift();
    if (outcome) return outcome;
    if (request.signal.aborted) return { kind: "aborted" };
    return { kind: "completed", outputText: "compact answer", stopReason: "completed" };
  }
}

export interface CapturedLogRecord {
  readonly event: string;
  readonly fields: Record<string, unknown> | undefined;
}

export class CapturingLogger implements PluginLoggerLike {
  readonly records: CapturedLogRecord[] = [];

  debug(event: string, fields?: Record<string, unknown>): void {
    this.records.push({ event, fields });
  }

  info(event: string, fields?: Record<string, unknown>): void {
    this.records.push({ event, fields });
  }

  warn(event: string, fields?: Record<string, unknown>): void {
    this.records.push({ event, fields });
  }

  error(event: string, fields?: Record<string, unknown>): void {
    this.records.push({ event, fields });
  }

  events(...names: string[]): CapturedLogRecord[] {
    return this.records.filter((record) => names.includes(record.event));
  }
}

/** Resolved config with test-sized thresholds; `routing.thresholds` stays small unless overridden. */
export function testConfig(overrides: ToolOffloadConfig = {}): ResolvedToolOffloadConfig {
  const { routing, ...rest } = overrides;
  return resolveToolOffloadConfig({
    ...rest,
    routing: {
      thresholds: { minBytes: 1_024, minEstimatedTokens: 256 },
      ...routing,
    },
  });
}

export const acceptNext = async () => ({ kind: "accept" }) as const;
