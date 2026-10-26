import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentCapabilities,
  SubagentProvider,
} from "@deepseek-ai/dsh-subagent";
import type { DomainDefinition, MemoryRecord } from "../../src/types.js";
import { emptyDomainDraft } from "../../src/types.js";
import type { DomainTable, MemoryRecordTable } from "../../src/host/storage.js";
import type { LogSink, SubagentsFace } from "../../src/host/execution.js";

/** A storage table good enough for the registry and the memory provider. */
export function memoryTable<T>(seed: Iterable<readonly [string, T]> = []): {
  get(key: string): T | undefined;
  entries(): IterableIterator<[string, T]>;
  keys(): IterableIterator<string>;
  readonly size: number;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  update(key: string, fn: (current: T) => T): Promise<T>;
} {
  const store = new Map<string, T>(seed);
  return {
    get: (key) => store.get(key),
    entries: () => store.entries(),
    keys: () => store.keys(),
    get size() {
      return store.size;
    },
    put: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => Promise.resolve(store.delete(key)),
    update: (key, fn) => {
      const current = store.get(key);
      if (current === undefined) {
        return Promise.reject(new Error("missing-key"));
      }
      const next = fn(current);
      store.set(key, next);
      return Promise.resolve(next);
    },
  };
}

export function domainTableOf(
  seed: Iterable<readonly [string, DomainDefinition]> = [],
): DomainTable {
  return memoryTable(seed) as unknown as DomainTable;
}

export function memoryRecordTableOf(): MemoryRecordTable {
  return memoryTable<MemoryRecord>() as unknown as MemoryRecordTable;
}

/** Deterministic clock. */
export { fixedClock } from "@yadsh/dsh-test-kit";

export interface RecordedLog {
  readonly events: { readonly level: string; readonly event: string }[];
}

export function recordingLogger(sink: RecordedLog): LogSink {
  const push = (level: string) => (event: string) => {
    sink.events.push({ level, event });
  };
  return { info: push("info"), warn: push("warn") };
}

/** A definition with the given id and optional overrides. */
export function domainOf(
  id: string,
  overrides: Partial<DomainDefinition> = {},
): DomainDefinition {
  const base = emptyDomainDraft(id, 1_000);
  return {
    ...base,
    name: id,
    ...overrides,
    scope: { ...base.scope, ...overrides.scope },
    memory: { ...base.memory, ...overrides.memory },
    tools: { ...base.tools, ...overrides.tools },
    delegation: { ...base.delegation, ...overrides.delegation },
    persona: { ...base.persona, ...overrides.persona },
    model: { ...base.model, ...overrides.model },
  };
}

export const FULL_CAPABILITIES: SubagentCapabilities = {
  agentOptions: true,
  agentPreset: true,
  outputSchema: true,
  depthLimit: true,
};

export const NO_CAPABILITIES: SubagentCapabilities = {
  agentOptions: false,
  agentPreset: false,
  outputSchema: false,
  depthLimit: false,
};

/** Minimal session header the plugin reads. */
export function agentOf(options: {
  readonly id: string;
  readonly cwd?: string;
  readonly depth?: number;
  readonly origin?: "subagent";
  readonly parentSession?: string;
  readonly createdAt?: number;
}): Agent {
  return {
    id: options.id,
    session: {
      header: {
        version: 1,
        id: options.id,
        createdAt: options.createdAt ?? 1_000,
        isSeeded: false,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.depth === undefined
          ? {}
          : { delegationDepth: options.depth }),
        ...(options.origin === undefined ? {} : { origin: options.origin }),
        ...(options.parentSession === undefined
          ? {}
          : { parentSession: options.parentSession }),
      },
    },
  } as unknown as Agent;
}

export interface FakeSubagentsOptions {
  readonly structured?: unknown;
  readonly name?: string;
  readonly capabilities?: SubagentCapabilities;
  readonly text?: string;
  readonly stopReason?: string;
  readonly diagnostic?: string;
  readonly failWith?: unknown;
  readonly runId?: string;
}

export interface FakeSubagents extends SubagentsFace {
  /** Every activation the plugin asked the runtime to start, in order. */
  readonly started: readonly SubagentActivationSpec[];
  readonly disposed: string[];
}

/** A subagent runtime stand-in that records what it was asked to do. */
export function fakeSubagents(
  options: FakeSubagentsOptions = {},
): FakeSubagents {
  const started: SubagentActivationSpec[] = [];
  const disposed: string[] = [];
  const name = options.name ?? "spawn";
  const runId = options.runId ?? "child-session";
  const face: FakeSubagents = {
    started,
    disposed,
    getProvider(providerName: string): SubagentProvider | undefined {
      if (providerName !== name) return undefined;
      return {
        name,
        capabilities: options.capabilities ?? FULL_CAPABILITIES,
        inheritsParentContext: true,
        start: () => Promise.reject(new Error("not used")),
      } as unknown as SubagentProvider;
    },
    startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation> {
      if (options.failWith !== undefined)
        return Promise.reject(options.failWith);
      started.push(spec);
      const result = {
        ...(options.structured === undefined
          ? {}
          : { structured: options.structured }),
        output: [{ type: "text", text: options.text ?? "plain answer" }],
        stopReason: options.stopReason ?? "completed",
        ...(options.diagnostic === undefined
          ? {}
          : { diagnostic: options.diagnostic }),
      };
      return Promise.resolve({
        childId: runId,
        messageId: "m1",
        result: Promise.resolve(result),
        dispose: () => {
          disposed.push(runId);
          return Promise.resolve();
        },
      } as unknown as SubagentActivation);
    },
  };
  return face;
}
