import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_MEMORY_OWNER,
  type MemoryOwner,
} from "../src/host/resolver.js";
import { createDomainMemoryTool } from "../src/host/tools/domain-memory.js";
import type { DomainDefinition, MemoryRecord } from "../src/types.js";
import { domainOf } from "./helpers/fakes.js";
import {
  AGENT,
  PAYMENTS,
  call,
  harnessOf,
  propertiesOf,
  renderText,
  type Harness,
} from "./tools.helpers.js";

/** An expert run in progress, with the memory owner the caller was attributed. */
function expertHarness(
  definition: DomainDefinition = PAYMENTS,
  memoryOwner: MemoryOwner = DEPLOYMENT_MEMORY_OWNER,
): Harness {
  const harness = harnessOf([definition, domainOf("inventory")]);
  harness.tracker.register({
    domainId: definition.id,
    childSessionId: "session-1",
    callerSessionId: "root",
    callerDomain: null,
    path: [definition.id],
    depth: 1,
    background: false,
    maxParallel: 3,
    memoryOwner,
  });
  return harness;
}

/** A record already in one namespace, as the operator left it. */
function recordOf(namespace: string, key: string, text: string): MemoryRecord {
  return { namespace, key, text, tags: [], createdAt: 1, updatedAt: 1 };
}

describe("tools: domain_memory", () => {
  it("refuses outside an expert run", async () => {
    const harness = harnessOf();
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(tool, { action: "read" }, AGENT).catch(
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain("[EXPERT_NOT_CALLER]");
  });

  it("writes to the private namespace and reads it back", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const written = await call(
      tool,
      {
        action: "write",
        key: "cutoff",
        text: "Settlement closes at 14:00.",
        tags: ["batch"],
      },
      AGENT,
    );
    expect(written["affected"]).toBe(1);
    const read = await call(
      tool,
      { action: "read", text: "settlement" },
      AGENT,
    );
    const records = read["records"] as Record<string, unknown>[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      namespace: "domain/payments",
      key: "cutoff",
    });
  });

  it("refuses a note that records no finding, and stores nothing", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(
      tool,
      { action: "write", key: "noise", text: "ок" },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[MEMORY_NOISE_REFUSED]");
    // The refusal has to be readable as an instruction: a model that only sees
    // "rejected" re-phrases the same noise and writes it again.
    expect((error as Error).message).toContain("acknowledgement");
    const listed = await call(tool, { action: "list" }, AGENT);
    expect(listed["records"]).toEqual([]);
  });

  it("derives a key when none is given", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const written = await call(
      tool,
      { action: "write", text: "Batch cutoff noted." },
      AGENT,
    );
    const records = written["records"] as Record<string, unknown>[];
    expect(String(records[0]?.["key"])).toContain("batch-cutoff-noted");
  });

  it("refuses a foreign namespace read", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(
      tool,
      { action: "read", namespace: "domain/inventory" },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[MEMORY_SCOPE_DENIED]");
    expect((error as Error).message).toContain("domain/payments");
  });

  it("allows reading a configured shared namespace", async () => {
    const definition = domainOf("payments", {
      memory: {
        namespace: "domain/payments",
        sharedReadOnly: ["shared/product"],
      },
    });
    const harness = expertHarness(definition);
    const tool = createDomainMemoryTool(harness.dependencies);
    const value = await call(
      tool,
      { action: "read", namespace: "shared/product" },
      AGENT,
    );
    expect(value["namespaces"]).toContain("shared/product (read-only)");
  });

  it("refuses a write to a read-only namespace", async () => {
    const definition = domainOf("payments", {
      memory: {
        namespace: "domain/payments",
        sharedReadOnly: ["shared/product"],
      },
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
    await expect(
      call(tool, { action: "write", key: "k", text: "  " }, AGENT),
    ).rejects.toThrowError(/\[MEMORY_NOISE_REFUSED\]/u);
    await expect(call(tool, { action: "forget" }, AGENT)).rejects.toThrowError(
      /\[TASK_REJECTED\]/u,
    );
  });

  it("forgets one key and reports whether it existed", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    await call(
      tool,
      { action: "write", key: "k", text: "Settlement closes at 14:00." },
      AGENT,
    );
    await expect(
      call(tool, { action: "forget", key: "k" }, AGENT),
    ).resolves.toMatchObject({
      affected: 1,
    });
    await expect(
      call(tool, { action: "forget", key: "k" }, AGENT),
    ).resolves.toMatchObject({
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
    expect(propertiesOf(tool)["action"]?.enum).toEqual([
      "read",
      "write",
      "forget",
      "list",
    ]);
  });
});

describe("tools: domain_memory per account", () => {
  const OWNER: MemoryOwner = { mode: "per-user", userId: "user-a" };

  function accountHarness(memoryOwner: MemoryOwner = OWNER) {
    return expertHarness(
      domainOf("payments", {
        memory: {
          namespace: "domain/payments",
          sharedReadOnly: ["shared/product"],
        },
      }),
      memoryOwner,
    );
  }

  it("records a note in the account's own namespace", async () => {
    const harness = accountHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const written = await call(
      tool,
      { action: "write", key: "cutoff", text: "Settlement closes at 14:00." },
      AGENT,
    );
    const records = written["records"] as Record<string, unknown>[];
    expect(records[0]?.["namespace"]).toBe("domain/payments/u/user-a");
    expect(written["message"]).toContain("domain/payments/u/user-a/cutoff");
  });

  it("keeps one account's note out of another account's read", async () => {
    const writer = accountHarness();
    await call(
      createDomainMemoryTool(writer.dependencies),
      { action: "write", key: "cutoff", text: "Settlement closes at 14:00." },
      AGENT,
    );

    const other = accountHarness({ mode: "per-user", userId: "user-b" });
    const value = await call(
      createDomainMemoryTool(other.dependencies),
      { action: "read", text: "settlement" },
      AGENT,
    );
    expect(value["records"]).toEqual([]);
  });

  it("reads the domain namespace it can no longer write", async () => {
    const harness = accountHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    await harness.memoryTable.put(
      "domain/payments::guarantee",
      recordOf("domain/payments", "guarantee", "Settlement is idempotent."),
    );
    const value = await call(
      tool,
      { action: "read", text: "idempotent" },
      AGENT,
    );
    const records = value["records"] as Record<string, unknown>[];
    expect(records.map((record) => record["namespace"])).toEqual([
      "domain/payments",
    ]);
    expect(value["namespaces"]).toContain("domain/payments (read-only)");
    expect(value["namespaces"]).toContain(
      "domain/payments/u/user-a (read/write)",
    );
  });

  it("refuses a write aimed at the domain's common namespace", async () => {
    const harness = accountHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(
      tool,
      {
        action: "write",
        key: "tools",
        text: "There is no jira tool.",
        namespace: "domain/payments",
      },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[MEMORY_SCOPE_DENIED]");
    expect((error as Error).message).toContain("only true for this caller");
  });

  it("refuses to record from a run nobody claimed", async () => {
    const harness = accountHarness({ mode: "per-user", userId: undefined });
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(
      tool,
      { action: "write", key: "tools", text: "There is no jira tool." },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[MEMORY_SCOPE_DENIED]");
    expect((error as Error).message).toContain("not attributed to an account");
    expect([...harness.memoryTable.entries()]).toEqual([]);
    // Reading the common tier stays available: the run is not blind, it just
    // cannot teach every later account something it saw once.
    await expect(call(tool, { action: "read" }, AGENT)).resolves.toMatchObject({
      action: "read",
    });
  });

  it("refuses another account's namespace by name", async () => {
    const harness = accountHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    const error = await call(
      tool,
      { action: "read", namespace: "domain/payments/u/user-b" },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[MEMORY_SCOPE_DENIED]");
  });
});
