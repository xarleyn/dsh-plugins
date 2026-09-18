import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ToolDependencies } from "../src/host/tools/shared.js";
import { DomainRegistry } from "../src/host/registry.js";
import {
  createBuiltinMemoryProvider,
  type MemoryTable,
} from "../src/host/memory/builtin.js";
import { MemoryProviderRegistry } from "../src/host/memory/registry.js";
import { delegationVerdictOf, parallelBudgetOf } from "../src/host/policy.js";
import { RunTracker } from "../src/host/execution.js";
import type {
  DomainDefinition,
  DomainExpertResult,
  DomainListing,
} from "../src/types.js";
import {
  agentOf,
  domainOf,
  domainTableOf,
  fixedClock,
  memoryRecordTableOf,
  recordingLogger,
} from "./helpers/fakes.js";

type RenderValue = Parameters<ToolDefinition["output"]["render"]>[1];
type RenderArgs = Parameters<ToolDefinition["output"]["render"]>[0];

export const PAYMENTS = domainOf("payments", {
  name: "Payments",
  description: "Settlement.",
});
export const INVENTORY = domainOf("inventory", {
  name: "Inventory",
  description: "Stock levels.",
  delegation: {
    ...domainOf("inventory").delegation,
    crossDomainMode: "disabled",
  },
});

export function execOf(agent: Agent): ToolRunContext {
  return {
    callId: "call-1",
    rootCallId: "call-1",
    name: "test",
    arguments: {},
    agent,
    signal: new AbortController().signal,
    token: Symbol("token"),
  } as unknown as ToolRunContext;
}

export async function call(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  agent: Agent,
): Promise<Record<string, unknown>> {
  return (await tool.execute(args, execOf(agent))) as Record<string, unknown>;
}

export function renderText(
  tool: ToolDefinition,
  args: unknown,
  value: unknown,
): string {
  return tool.output
    .render(args as RenderArgs, value as RenderValue)
    .map((block) => ("text" in block ? block.text : ""))
    .join("\n");
}

/** The argument JSON Schema the harness will validate against. */
export function propertiesOf(
  tool: ToolDefinition,
): Record<string, { readonly enum?: readonly string[] }> {
  const properties = tool.parameters["properties"];
  return (properties ?? {}) as Record<
    string,
    { readonly enum?: readonly string[] }
  >;
}

export interface Harness {
  readonly dependencies: ToolDependencies;
  readonly runs: {
    readonly domainId: string;
    readonly callerDomain: string | null;
    readonly task: string;
    readonly background: boolean;
  }[];
  readonly tracker: RunTracker;
  readonly memoryTable: MemoryTable;
  readonly warnings: string[];
}

export function harnessOf(
  definitions: readonly DomainDefinition[] = [PAYMENTS, INVENTORY],
  options: { readonly failWith?: unknown } = {},
): Harness {
  const clock = fixedClock();
  const domains = new DomainRegistry(
    domainTableOf(
      definitions.map((definition) => [definition.id, definition] as const),
    ),
    clock,
  );
  const memoryTable = memoryRecordTableOf() as unknown as MemoryTable;
  const memoryProviders = new MemoryProviderRegistry();
  memoryProviders.register(createBuiltinMemoryProvider(memoryTable, clock));
  const tracker = new RunTracker();
  const runs: Harness["runs"] = [];
  const warnings: string[] = [];

  const dependencies: ToolDependencies = {
    list: async (): Promise<readonly DomainListing[]> =>
      domains
        .list()
        .filter((definition) => definition.enabled)
        .map((definition) => ({
          id: definition.id,
          name: definition.name,
          description: definition.description,
        })),
    requireDefinition: async (id) => domains.requireEnabled(id),
    run: (input) => {
      if (options.failWith !== undefined)
        return Promise.reject(options.failWith);
      runs.push({
        domainId: input.definition.id,
        callerDomain: input.callerDomain,
        task: input.request.task,
        background: input.request.background,
      });
      return Promise.resolve({
        domainId: input.definition.id,
        expert: input.definition.name,
        status: input.request.background ? "delegated" : "completed",
        summary: `answer from ${input.definition.id}`,
        findings: [
          {
            claim: "the batch aborts",
            evidence: ["services/payments/batch.ts:41"],
            confidence: "high",
          },
        ],
        conflicts: [],
        assumptions: [],
        followUps: [],
        diagnostic: "",
        childSessionId: "child-1",
        durationMs: 1_234,
        structured: true,
      } satisfies DomainExpertResult);
    },
    activeRun: (sessionId) => tracker.find(sessionId),
    delegationVerdict: (callerDomainId, targetDomainId) =>
      delegationVerdictOf(
        domains.get(callerDomainId),
        callerDomainId,
        domains.get(targetDomainId),
        targetDomainId,
      ),
    parallelBudget: (callerSessionId) =>
      parallelBudgetOf(
        tracker.countForCaller(callerSessionId),
        tracker.find(callerSessionId)?.maxParallel ?? 3,
      ),
    memory: () => memoryProviders.require("builtin"),
    logger: recordingLogger({ events: [] }),
  };
  // Capture refusals so a test can assert the log side of a denial.
  const original = dependencies.logger;
  const logger = {
    info: original.info,
    warn: (event: string) => {
      warnings.push(event);
      original.warn(event);
    },
  };

  return {
    dependencies: { ...dependencies, logger },
    runs,
    tracker,
    memoryTable,
    warnings,
  };
}

export const AGENT = agentOf({ id: "session-1", cwd: "/repo" });
