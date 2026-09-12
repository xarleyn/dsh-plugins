import { describe, expect, it } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";

type RenderValue = Parameters<ToolDefinition["output"]["render"]>[1];
type RenderArgs = Parameters<ToolDefinition["output"]["render"]>[0];
import { createDomainExpertTool } from "../src/host/tools/domain-expert.js";
import { createDomainMemoryTool } from "../src/host/tools/domain-memory.js";
import { createListDomainsTool } from "../src/host/tools/list-domains.js";
import type { ToolDependencies } from "../src/host/tools/shared.js";
import { DomainRegistry } from "../src/host/registry.js";
import { createBuiltinMemoryProvider, type MemoryTable } from "../src/host/memory/builtin.js";
import { MemoryProviderRegistry } from "../src/host/memory/registry.js";
import { delegationVerdictOf, parallelBudgetOf } from "../src/host/policy.js";
import { RunTracker } from "../src/host/execution.js";
import { DomainExpertsError } from "../src/host/errors.js";
import { parseDomainDefinition } from "../src/host/schema.js";
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

const PAYMENTS = domainOf("payments", { name: "Payments", description: "Settlement." });
const INVENTORY = domainOf("inventory", {
  name: "Inventory",
  description: "Stock levels.",
  delegation: { ...domainOf("inventory").delegation, crossDomainMode: "disabled" },
});

function execOf(agent: Agent): ToolRunContext {
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

async function call(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  agent: Agent,
): Promise<Record<string, unknown>> {
  return (await tool.execute(args, execOf(agent))) as Record<string, unknown>;
}

function renderText(tool: ToolDefinition, args: unknown, value: unknown): string {
  return tool.output
    .render(args as RenderArgs, value as RenderValue)
    .map((block) => ("text" in block ? block.text : ""))
    .join("\n");
}


/** The argument JSON Schema the harness will validate against. */
function propertiesOf(tool: ToolDefinition): Record<string, { readonly enum?: readonly string[] }> {
  const properties = tool.parameters["properties"];
  return (properties ?? {}) as Record<string, { readonly enum?: readonly string[] }>;
}

interface Harness {
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

function harnessOf(
  definitions: readonly DomainDefinition[] = [PAYMENTS, INVENTORY],
  options: { readonly failWith?: unknown } = {},
): Harness {
  const clock = fixedClock();
  const domains = new DomainRegistry(
    domainTableOf(definitions.map((definition) => [definition.id, definition] as const)),
    clock,
  );
  const memoryTable = memoryRecordTableOf() as unknown as MemoryTable;
  const memoryProviders = new MemoryProviderRegistry();
  memoryProviders.register(createBuiltinMemoryProvider(memoryTable, clock));
  const tracker = new RunTracker();
  const runs: Harness["runs"] = [];
  const warnings: string[] = [];

  const dependencies: ToolDependencies = {
    list: (): readonly DomainListing[] =>
      domains
        .list()
        .filter((definition) => definition.enabled)
        .map((definition) => ({
          id: definition.id,
          name: definition.name,
          description: definition.description,
        })),
    requireDefinition: (id) => domains.requireEnabled(id),
    run: (input) => {
      if (options.failWith !== undefined) return Promise.reject(options.failWith);
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
          { claim: "the batch aborts", evidence: ["services/payments/batch.ts:41"], confidence: "high" },
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

  return { dependencies: { ...dependencies, logger }, runs, tracker, memoryTable, warnings };
}

const AGENT = agentOf({ id: "session-1", cwd: "/repo" });

describe("tools: domain_experts_list", () => {
  it("returns enabled domains and nothing else", async () => {
    const harness = harnessOf([PAYMENTS, domainOf("platform", { enabled: false })]);
    const tool = createListDomainsTool(harness.dependencies);
    const value = await call(tool, {}, AGENT);
    expect(value["count"]).toBe(1);
    const domains = value["domains"] as Record<string, unknown>[];
    expect(domains).toHaveLength(1);
    expect(Object.keys(domains[0] ?? {}).sort()).toEqual(["description", "id", "name"]);
    expect(JSON.stringify(value)).not.toContain("scope");
    expect(JSON.stringify(value)).not.toContain("domain/payments");
  });

  it("renders a readable list", async () => {
    const harness = harnessOf([PAYMENTS]);
    const tool = createListDomainsTool(harness.dependencies);
    const value = await call(tool, {}, AGENT);
    expect(renderText(tool, {}, value)).toContain("payments: Payments — Settlement.");
  });

  it("renders an explicit empty state", async () => {
    const harness = harnessOf([]);
    const tool = createListDomainsTool(harness.dependencies);
    const value = await call(tool, {}, AGENT);
    expect(renderText(tool, {}, value)).toBe("No domain experts are enabled in this deployment.");
  });
});

describe("tools: domain_expert", () => {
  it("runs a domain for a top-level caller with no caller domain", async () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    const value = await call(tool, { domain: "payments", task: "why is it stale" }, AGENT);
    expect(harness.runs).toEqual([
      { domainId: "payments", callerDomain: null, task: "why is it stale", background: false },
    ]);
    expect(value["status"]).toBe("completed");
    expect(value["summary"]).toBe("answer from payments");
    expect(value["durationMs"]).toBe(1234);
    expect(renderText(tool, {}, value)).toContain("domain=payments status=completed");
  });

  it("treats a call from another expert as a delegation", async () => {
    const harness = harnessOf();
    harness.tracker.register({
      domainId: "payments",
      childSessionId: "session-1",
      callerSessionId: "root",
      callerDomain: null,
      path: ["payments"],
      depth: 1,
      background: false,
      maxParallel: 3,
    });
    const tool = createDomainExpertTool(harness.dependencies);
    await call(tool, { domain: "inventory", task: "stock rules" }, AGENT);
    expect(harness.runs[0]?.callerDomain).toBe("payments");
  });

  it("refuses a delegation the caller's policy forbids", async () => {
    const harness = harnessOf();
    harness.tracker.register({
      domainId: "inventory",
      childSessionId: "session-1",
      callerSessionId: "root",
      callerDomain: null,
      path: ["inventory"],
      depth: 1,
      background: false,
      maxParallel: 3,
    });
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(tool, { domain: "payments", task: "x" }, AGENT).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("[DELEGATION_DENIED]");
    expect((error as Error).message).toContain("cross-domain access disabled");
    expect(harness.runs).toEqual([]);
    expect(harness.warnings).toContain("domain-expert/refused");
  });

  it("refuses delegating to your own domain", async () => {
    const harness = harnessOf();
    harness.tracker.register({
      domainId: "payments",
      childSessionId: "session-1",
      callerSessionId: "root",
      callerDomain: null,
      path: ["payments"],
      depth: 1,
      background: false,
      maxParallel: 3,
    });
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(tool, { domain: "payments", task: "x" }, AGENT).catch(
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain("your own domain");
  });

  it("refuses to exceed the parallel expert budget", async () => {
    const harness = harnessOf();
    for (const id of ["a", "b", "c"]) {
      harness.tracker.register({
        domainId: "payments",
        childSessionId: id,
        callerSessionId: "session-1",
        callerDomain: null,
        path: ["payments"],
        depth: 1,
        background: false,
        maxParallel: 3,
      });
    }
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(tool, { domain: "payments", task: "x" }, AGENT).catch(
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain("[PARALLELISM_EXCEEDED]");
    expect((error as Error).message).toContain("allows 3 parallel expert calls");
  });

  it("reports a missing domain with its code and the known ids", async () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(tool, { domain: "ghost", task: "x" }, AGENT).catch(
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain("[DOMAIN_NOT_FOUND]");
    expect((error as Error).message).toContain("inventory, payments");
  });

  it("reports a disabled domain with its own code", async () => {
    const harness = harnessOf([domainOf("payments", { enabled: false })]);
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(tool, { domain: "payments", task: "x" }, AGENT).catch(
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain("[DOMAIN_DISABLED]");
  });

  it("declares the mode vocabulary so an unknown one is refused before execution", () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    expect(propertiesOf(tool)["mode"]?.enum).toEqual(["investigate", "answer", "review"]);
  });

  it("passes the background flag through", async () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    await call(tool, { domain: "payments", task: "x", background: true }, AGENT);
    expect(harness.runs[0]?.background).toBe(true);
  });

  it("refuses without a calling agent", async () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await tool
      .execute({ domain: "payments", task: "x" }, { ...execOf(AGENT), agent: undefined })
      .catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("requires a calling agent");
  });

  it("declares a render and a presentation for every call", () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    expect(typeof tool.output.render).toBe("function");
    expect(tool.presentCall?.({ domain: "payments", task: "t" })?.title).toContain("payments");
  });
});

describe("tools: domain_memory", () => {
  function expertHarness(definition: DomainDefinition = PAYMENTS) {
    const harness = harnessOf([
      definition,
      domainOf("inventory"),
    ]);
    harness.tracker.register({
      domainId: definition.id,
      childSessionId: "session-1",
      callerSessionId: "root",
      callerDomain: null,
      path: [definition.id],
      depth: 1,
      background: false,
      maxParallel: 3,
    });
    return harness;
  }

  it("refuses outside an expert run", async () => {
    const harness = harnessOf();
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(tool, { action: "read" }, AGENT).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[EXPERT_NOT_CALLER]");
  });

  it("writes to the private namespace and reads it back", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const written = await call(
      tool,
      { action: "write", key: "cutoff", text: "Settlement closes at 14:00.", tags: ["batch"] },
      AGENT,
    );
    expect(written["affected"]).toBe(1);
    const read = await call(tool, { action: "read", text: "settlement" }, AGENT);
    const records = read["records"] as Record<string, unknown>[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ namespace: "domain/payments", key: "cutoff" });
  });

  it("derives a key when none is given", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const written = await call(tool, { action: "write", text: "Batch cutoff noted." }, AGENT);
    const records = written["records"] as Record<string, unknown>[];
    expect(String(records[0]?.["key"])).toContain("batch-cutoff-noted");
  });

  it("refuses a foreign namespace read", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(tool, { action: "read", namespace: "domain/inventory" }, AGENT).catch(
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain("[MEMORY_SCOPE_DENIED]");
    expect((error as Error).message).toContain("domain/payments");
  });

  it("allows reading a configured shared namespace", async () => {
    const definition = domainOf("payments", {
      memory: { namespace: "domain/payments", sharedReadOnly: ["shared/product"] },
    });
    const harness = expertHarness(definition);
    const tool = createDomainMemoryTool(harness.dependencies);
    const value = await call(tool, { action: "read", namespace: "shared/product" }, AGENT);
    expect(value["namespaces"]).toContain("shared/product (read-only)");
  });

  it("refuses a write to a read-only namespace", async () => {
    const definition = domainOf("payments", {
      memory: { namespace: "domain/payments", sharedReadOnly: ["shared/product"] },
    });
    const harness = expertHarness(definition);
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(
      tool,
      { action: "write", key: "k", text: "t", namespace: "shared/product" },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[MEMORY_SCOPE_DENIED]");
    expect((error as Error).message).toContain("read-only");
  });

  it("refuses an empty write and a forget without a key", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    await expect(call(tool, { action: "write", key: "k", text: "  " }, AGENT)).rejects.toThrowError(
      /\[TASK_REJECTED\]/u,
    );
    await expect(call(tool, { action: "forget" }, AGENT)).rejects.toThrowError(
      /\[TASK_REJECTED\]/u,
    );
  });

  it("forgets one key and reports whether it existed", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    await call(tool, { action: "write", key: "k", text: "t" }, AGENT);
    await expect(call(tool, { action: "forget", key: "k" }, AGENT)).resolves.toMatchObject({
      affected: 1,
    });
    await expect(call(tool, { action: "forget", key: "k" }, AGENT)).resolves.toMatchObject({
      affected: 0,
    });
  });

  it("lists namespaces and records", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    await call(tool, { action: "write", key: "k", text: "remembered" }, AGENT);
    const value = await call(tool, { action: "list" }, AGENT);
    expect(value["namespaces"]).toEqual(["domain/payments (read/write)"]);
    expect(renderText(tool, {}, value)).toContain("remembered");
  });

  it("declares the action vocabulary so an unknown one is refused", () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    expect(propertiesOf(tool)["action"]?.enum).toEqual(["read", "write", "forget", "list"]);
  });
});

describe("tools: definition shape", () => {
  it("gives every tool a name, a description and a render", () => {
    const harness = harnessOf();
    for (const tool of [
      createListDomainsTool(harness.dependencies),
      createDomainExpertTool(harness.dependencies),
      createDomainMemoryTool(harness.dependencies),
    ]) {
      expect(tool.name).toMatch(/^domain_/u);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(typeof tool.output.render).toBe("function");
      expect(tool.output.schema).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("keeps normalizing a definition the tools will receive", () => {
    expect(parseDomainDefinition({ id: "payments" }, 1).memory.namespace).toBe("domain/payments");
  });

  it("raises a typed domain error for a bad definition before any run", () => {
    const harness = harnessOf();
    expect(() => harness.dependencies.requireDefinition("ghost")).toThrowError(
      DomainExpertsError,
    );
  });
});
