import { describe, expect, it } from "vitest";
import { createDomainMemoryTool } from "../src/host/tools/domain-memory.js";
import type { DomainDefinition } from "../src/types.js";
import { domainOf } from "./helpers/fakes.js";
import {
  AGENT,
  PAYMENTS,
  call,
  harnessOf,
  propertiesOf,
  renderText,
} from "./tools.helpers.js";

describe("tools: domain_memory", () => {
  function expertHarness(definition: DomainDefinition = PAYMENTS) {
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
    });
    return harness;
  }

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
    ).rejects.toThrowError(/\[TASK_REJECTED\]/u);
    await expect(call(tool, { action: "forget" }, AGENT)).rejects.toThrowError(
      /\[TASK_REJECTED\]/u,
    );
  });

  it("forgets one key and reports whether it existed", async () => {
    const harness = expertHarness();
    const tool = createDomainMemoryTool(harness.dependencies);
    await call(tool, { action: "write", key: "k", text: "t" }, AGENT);
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
