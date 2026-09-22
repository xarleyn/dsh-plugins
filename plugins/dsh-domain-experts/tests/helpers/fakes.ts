import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
  SubagentStartRequest,
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
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
};

export const NO_CAPABILITIES: SubagentCapabilities = {
  agentOptions: false,
  outputSchema: false,
  depthLimit: false,
  toolFilter: false,
  persona: false,
};

/** Minimal session header the plugin reads. */
export function agentOf(options: {
  readonly id: string;
  readonly cwd?: string;
  readonly depth?: number;
  readonly origin?: "subagent";
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
      },
    },
  } as unknown as Agent;
}

export interface StartedRun {
  readonly provider: string;
  readonly request: SubagentStartRequest;
}

export interface FakeSubagentsOptions {
  readonly name?: string;
  readonly capabilities?: SubagentCapabilities;
  readonly text?: string;
  readonly stopReason?: string;
  readonly diagnostic?: string;
  readonly failWith?: unknown;
  /**
   * Refuse the first `start` only, then behave normally: the shape a runtime
   * refusal takes when the caller retries without the names it named.
   */
  readonly failOnce?: unknown;
  readonly runId?: string;
  readonly continuable?: boolean;
}

export interface FakeSubagents extends SubagentsFace {
  readonly started: StartedRun[];
  readonly continued: { readonly label: string }[];
  readonly disposed: string[];
}

/** A subagent runtime stand-in that records what it was asked to do. */
export function fakeSubagents(
  options: FakeSubagentsOptions = {},
): FakeSubagents {
  const started: StartedRun[] = [];
  const continued: { readonly label: string }[] = [];
  const disposed: string[] = [];
  const name = options.name ?? "spawn";
  const runId = options.runId ?? "child-session";
  let attempts = 0;
  const face: FakeSubagents = {
    started,
    continued,
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
    start(
      providerName: string,
      request: SubagentStartRequest,
    ): Promise<SubagentRun> {
      if (options.failWith !== undefined)
        return Promise.reject(options.failWith);
      if (options.failOnce !== undefined && attempts === 0) {
        attempts += 1;
        return Promise.reject(options.failOnce);
      }
      attempts += 1;
      started.push({ provider: providerName, request });
      const result = {
        output: [{ type: "text", text: options.text ?? "plain answer" }],
        stopReason: options.stopReason ?? "completed",
        ...(options.diagnostic === undefined
          ? {}
          : { diagnostic: options.diagnostic }),
      };
      return Promise.resolve({
        id: runId,
        localAgent: undefined,
        result: Promise.resolve(result),
        dispose: () => {
          disposed.push(runId);
          return Promise.resolve();
        },
      } as unknown as SubagentRun);
    },
    ...(options.continuable === false
      ? {}
      : {
          startContinuable: () => {
            continued.push({ label: "continuable" });
            return Promise.resolve({ childId: `${runId}-bg`, messageId: "m1" });
          },
        }),
  } as FakeSubagents;
  return face;
}
