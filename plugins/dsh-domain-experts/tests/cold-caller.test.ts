import { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import { DomainExpertsService } from "../src/index.js";
import type { DomainExpertsStorage } from "../src/host/storage.js";
import { DEPLOYMENT_MEMORY_OWNER } from "../src/host/resolver.js";
import { RunTracker } from "../src/host/execution.js";
import type { DomainDefinition } from "../src/types.js";
import {
  agentOf,
  domainOf,
  domainTableOf,
  fakeSubagents,
  memoryRecordTableOf,
} from "./helpers/fakes.js";
import { call, execOf } from "./tools.helpers.js";

const CHILD = agentOf({
  id: "resumed",
  origin: "subagent",
  parentSession: "root",
  depth: 1,
});
const TARGET = domainOf("inventory");
const CALLER = domainOf("payments");

function fixture(
  options: {
    caller?: DomainDefinition;
    label?: string;
    missingRow?: boolean;
    listingFailure?: boolean;
    pendingListing?: boolean;
    duplicateRow?: boolean;
    descriptorFromStart?: boolean;
  } = {},
) {
  const tables = {
    domains: domainTableOf([
      ["payments", options.caller ?? CALLER],
      ["inventory", TARGET],
    ]),
    memory: memoryRecordTableOf(),
  };
  // This unit and descriptor outlive each service, modelling a process restart.
  const unit = {
    name: "domain_experts",
    table: (name: keyof typeof tables) => tables[name],
    close: () => Promise.resolve(),
  } as unknown as DomainExpertsStorage;
  const runtime = fakeSubagents(
    options.descriptorFromStart ? { continuable: true, runId: "resumed" } : {},
  );
  const lookups: string[] = [];
  const lookupSignals: AbortSignal[] = [];
  function open() {
    const ctx = new Context();
    const tools = new Map<string, ToolDefinition>();
    ctx.provide("tools", {
      register: (tool: ToolDefinition) => {
        tools.set(tool.name, tool);
        return () => tools.delete(tool.name);
      },
    });
    ctx.provide("agents", { get: () => undefined, list: () => [] });
    ctx.provide("subagents", {
      ...runtime,
      listChildren: (parent: string, signal: AbortSignal) => {
        lookups.push(parent);
        lookupSignals.push(signal);
        if (options.pendingListing) return new Promise<never>(() => undefined);
        if (options.listingFailure)
          return Promise.reject(new Error("catalog unavailable"));
        return Promise.resolve(
          options.missingRow
            ? []
            : (options.duplicateRow ? [1, 2] : [1]).map(() => ({
                id: options.descriptorFromStart ? "resumed-bg" : "resumed",
                label: options.descriptorFromStart
                  ? runtime.continued[0]?.label
                  : (options.label ?? "domain-expert:payments"),
              })),
        );
      },
    });
    ctx.provide("storageDomain", { open: () => Promise.resolve(unit) });
    const service = new DomainExpertsService(ctx, { defaultMaxParallel: 3 });
    return { ctx, service, tool: tools.get("domain_expert")! };
  }
  return { open, runtime, lookups, lookupSignals, tables };
}

describe("cold caller: policy on the real host service", () => {
  it("recovers the creation label of a background run started by an earlier service", async () => {
    const f = fixture({
      descriptorFromStart: true,
      caller: domainOf("payments", {
        delegation: { ...CALLER.delegation, allowCrossDomain: false },
      }),
    });
    const first = f.open();
    const receipt = await call(
      first.tool,
      { domain: "payments", task: "inspect settlement", background: true },
      agentOf({ id: "root" }),
    );
    expect(receipt["childSessionId"]).toBe("resumed-bg");
    expect(f.runtime.continued).toEqual([{ label: "domain-expert:payments" }]);
    await first.service["stores"].close();
    const second = f.open();
    expect(second.service["tracker"].size).toBe(0);
    await expect(
      call(
        second.tool,
        { domain: "inventory", task: "inspect stock" },
        agentOf({
          id: "resumed-bg",
          origin: "subagent",
          parentSession: "root",
          depth: 1,
        }),
      ),
    ).rejects.toThrow("[DELEGATION_DENIED]");
    expect(f.runtime.started).toEqual([]);
    await second.service["stores"].close();
  });
  it.each([
    ["cross-domain disabled", { allowCrossDomain: false }, "inventory"],
    ["mode disabled", { crossDomainMode: "disabled" as const }, "inventory"],
    ["target excluded", { targets: ["shipping"] }, "inventory"],
    ["self delegation", {}, "payments"],
  ])("refuses %s after restart", async (_name, delegation, target) => {
    const f = fixture({
      caller: domainOf("payments", {
        delegation: { ...CALLER.delegation, ...delegation },
      }),
    });
    const first = f.open();
    await first.service.listDomains();
    await first.service["stores"].close();
    const resumed = f.open();
    await expect(
      call(resumed.tool, { domain: target, task: "inspect stock" }, CHILD),
    ).rejects.toThrow("[DELEGATION_DENIED]");
    expect(f.runtime.started).toEqual([]);
    await resumed.service["stores"].close();
  });

  it("refuses a disabled caller even if its old policy permitted delegation", async () => {
    const f = fixture({ caller: { ...CALLER, enabled: false } });
    const h = f.open();
    await expect(
      call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD),
    ).rejects.toThrow("[DELEGATION_DENIED]");
    expect(f.runtime.started).toEqual([]);
    await h.service["stores"].close();
  });

  it.each([
    { missingRow: true },
    { listingFailure: true },
    { label: "domain-expert:" },
    { label: "domain-expert: invalid" },
    { duplicateRow: true },
  ])("refuses unknown identity %j", async (options) => {
    const f = fixture(options);
    const h = f.open();
    await expect(
      call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD),
    ).rejects.toThrow("[EXPERT_NOT_CALLER]");
    expect(f.runtime.started).toEqual([]);
    await h.service["stores"].close();
  });

  it("refuses a deleted caller without treating it as a root", async () => {
    const f = fixture();
    await f.tables.domains.delete("payments");
    const h = f.open();
    await expect(
      call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD),
    ).rejects.toThrow("[DELEGATION_DENIED]");
    expect(f.runtime.started).toEqual([]);
    await h.service["stores"].close();
  });

  it("forwards cancellation and never starts a child after a stalled lookup", async () => {
    const f = fixture({ pendingListing: true });
    const h = f.open();
    const controller = new AbortController();
    const pending = h.tool.execute(
      { domain: "inventory", task: "inspect stock" },
      { ...execOf(CHILD), signal: controller.signal },
    );
    // Let the lazy storage open and the catalog read start.
    while (f.lookups.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error("cancelled lookup"));
    await expect(pending).rejects.toThrow("cancelled lookup");
    expect(f.lookupSignals[0]?.aborted).toBe(true);
    expect(f.runtime.started).toEqual([]);
    await h.service["stores"].close();
  });

  it("refuses when a catalog never answers within the lookup budget", async () => {
    const f = fixture({ pendingListing: true });
    const h = f.open();
    await expect(
      call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD),
    ).rejects.toThrow("[EXPERT_NOT_CALLER]");
    expect(f.lookupSignals[0]?.aborted).toBe(true);
    expect(f.runtime.started).toEqual([]);
    await h.service["stores"].close();
  }, 10_000);

  it("keeps cold-resumed memory fail-closed rather than guessing an account", async () => {
    const f = fixture();
    const h = f.open();
    await call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD);
    await expect(
      call(h.service["tools"].get("domain_memory")!, { action: "read" }, CHILD),
    ).rejects.toThrow("[EXPERT_NOT_CALLER]");
    await h.service["stores"].close();
  });

  it("uses the live tracker without a catalog read", async () => {
    const f = fixture({ listingFailure: true });
    const h = f.open();
    h.service["tracker"].register({
      domainId: "payments",
      childSessionId: "resumed",
      callerSessionId: "root",
      callerDomain: null,
      path: ["shipping", "payments"],
      depth: 1,
      background: true,
      maxParallel: 3,
      memoryOwner: DEPLOYMENT_MEMORY_OWNER,
    });
    await call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD);
    expect(f.lookups).toEqual([]);
    expect(h.service.recentAudits(1).entries[0]?.delegatePath).toEqual([
      "shipping",
      "payments",
      "inventory",
    ]);
    await h.service["stores"].close();
  });

  it("keeps disabled direct reads out of the Remote inspector", async () => {
    const f = fixture({
      caller: domainOf("payments", {
        delegation: {
          ...CALLER.delegation,
          allowCrossDomain: false,
          crossDomainMode: "direct-read",
          directRead: ["domain/inventory"],
        },
      }),
    });
    const h = f.open();
    const profile = await h.service.resolveScope("payments");
    expect(profile.profile?.memory.map((entry) => entry.namespace)).toEqual([
      "domain/payments",
    ]);
    const inspection = await h.service.inspectMemory(
      "payments",
      "domain/inventory",
      10,
    );
    expect(inspection.code).toBe("MEMORY_SCOPE_DENIED");
    await h.service["stores"].close();
  });

  it("refuses a subagent with no durable parent", async () => {
    const f = fixture();
    const h = f.open();
    await expect(
      call(
        h.tool,
        { domain: "inventory", task: "inspect stock" },
        agentOf({ id: "lost", origin: "subagent" }),
      ),
    ).rejects.toThrow("[EXPERT_NOT_CALLER]");
    expect(f.runtime.started).toEqual([]);
    await h.service["stores"].close();
  });

  it("preserves positively identified ordinary subagents and root calls", async () => {
    const f = fixture({ label: "ordinary-review" });
    const h = f.open();
    await call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD);
    await call(
      h.tool,
      { domain: "inventory", task: "inspect stock" },
      agentOf({ id: "root" }),
    );
    expect(f.runtime.started).toHaveLength(2);
    expect(f.lookups).toEqual(["root"]);
    await h.service["stores"].close();
  });

  it("records the recovered caller in the audit and keeps its policy live", async () => {
    const f = fixture();
    const h = f.open();
    await call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD);
    expect(h.service.recentAudits(1).entries[0]).toMatchObject({
      callerDomain: "payments",
      delegatePath: ["payments", "inventory"],
    });
    await f.tables.domains.put("payments", {
      ...CALLER,
      delegation: { ...CALLER.delegation, allowCrossDomain: false },
    });
    await expect(
      call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD),
    ).rejects.toThrow("[DELEGATION_DENIED]");
    expect(f.runtime.started).toHaveLength(1);
    await h.service["stores"].close();
  });

  it("keeps the recovered caller's own parallel limit", async () => {
    const f = fixture({
      caller: domainOf("payments", {
        delegation: { ...CALLER.delegation, maxParallel: 1 },
      }),
    });
    const h = f.open();
    h.service["tracker"].register({
      domainId: "inventory",
      childSessionId: "in-flight",
      callerSessionId: "resumed",
      callerDomain: "payments",
      path: ["payments", "inventory"],
      depth: 2,
      background: true,
      maxParallel: 3,
      memoryOwner: DEPLOYMENT_MEMORY_OWNER,
    });
    await expect(
      call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD),
    ).rejects.toThrow("[PARALLELISM_EXCEEDED]");
    expect(f.runtime.started).toEqual([]);
    await h.service["stores"].close();
  });

  it("applies the same guard after tracker eviction", async () => {
    const f = fixture({
      caller: domainOf("payments", {
        delegation: { ...CALLER.delegation, allowCrossDomain: false },
      }),
    });
    const h = f.open();
    const tracker = new RunTracker(1);
    const run = {
      domainId: "payments",
      childSessionId: "resumed",
      callerSessionId: "root",
      callerDomain: null,
      path: ["payments"],
      depth: 1,
      background: true,
      maxParallel: 1,
      memoryOwner: DEPLOYMENT_MEMORY_OWNER,
    };
    tracker.register(run);
    tracker.register({ ...run, childSessionId: "newer" });
    expect(tracker.find("resumed")).toBeUndefined();
    // Replace the process-local index without touching the durable descriptor.
    Object.defineProperty(h.service, "tracker", { value: tracker });
    await expect(
      call(h.tool, { domain: "inventory", task: "inspect stock" }, CHILD),
    ).rejects.toThrow("[DELEGATION_DENIED]");
    expect(f.runtime.started).toEqual([]);
    await h.service["stores"].close();
  });
});
