import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import type { MemoryTable } from "../src/host/memory/shared.js";
import type { DomainExpertsStorage } from "../src/host/storage.js";
import { DomainExpertsService } from "../src/index.js";
import {
  emptyDomainDraft,
  type DomainDefinition,
  type MemoryRecord,
} from "../src/types.js";
import {
  domainTableOf,
  memoryRecordTableOf,
  memoryTable,
} from "./helpers/fakes.js";
import { productionShapedRecords } from "./helpers/memory-fixture.js";

/**
 * Wiring under a real Cordis context.
 *
 * Every other test drives a module directly; this one proves the contract the
 * host actually depends on — the service registers as `ctx.domainExperts`,
 * registers its tools through `ctx.tools`, and answers every Remote method with
 * a result envelope instead of throwing, including when storage is broken.
 */

function fakeStorage(): DomainExpertsStorage {
  const tables: Record<string, unknown> = {
    domains: domainTableOf(),
    memory: memoryRecordTableOf(),
  };
  return {
    name: "domain_experts",
    table: (name: string) => tables[name],
    close: () => Promise.resolve(),
  } as unknown as DomainExpertsStorage;
}

function storageWith(
  ...definitions: readonly DomainDefinition[]
): DomainExpertsStorage {
  const tables: Record<string, unknown> = {
    domains: domainTableOf(definitions.map((entry) => [entry.id, entry])),
    memory: memoryRecordTableOf(),
  };
  return {
    name: "domain_experts",
    table: (name: string) => tables[name],
    close: () => Promise.resolve(),
  } as unknown as DomainExpertsStorage;
}

interface Harness {
  readonly ctx: Context;
  readonly service: DomainExpertsService;
  readonly registered: string[];
}

function harnessOf(
  options: {
    readonly storage?: () => Promise<DomainExpertsStorage>;
    readonly config?: Record<string, unknown>;
  } = {},
): Harness {
  const ctx = new Context();
  const registered: string[] = [];
  ctx.provide("tools", {
    register: (definition: { name: string }) => {
      registered.push(definition.name);
      return () => {
        const index = registered.indexOf(definition.name);
        if (index >= 0) registered.splice(index, 1);
      };
    },
  });
  ctx.provide("agents", { get: () => undefined, list: () => [] });
  ctx.provide("subagents", {
    getProvider: () => undefined,
    start: () => Promise.reject(new Error("no provider")),
  });
  ctx.provide("storageDomain", {
    open: options.storage ?? (() => Promise.resolve(fakeStorage())),
  });
  const service = new DomainExpertsService(ctx, options.config ?? {});
  return { ctx, service, registered };
}

const DEFINITION: DomainDefinition = {
  ...emptyDomainDraft("payments", 1_000),
  name: "Payments",
  description: "Payment processing and settlement.",
  scope: {
    filesystem: {
      primary: ["services/payments/**"],
      sharedReadOnly: [],
      denied: [],
    },
    documentation: { include: [], exclude: [] },
    providers: {},
  },
};

describe("wiring: host contract", () => {
  it("registers itself as ctx.domainExperts and reaches the tool registry", () => {
    const harness = harnessOf();
    expect(harness.service.name).toBe("domainExperts");
    expect(harness.ctx.get("domainExperts") === undefined).toBe(false);
    expect(harness.registered.join(",")).toBe(
      "domain_expert,domain_experts_list,domain_memory",
    );
  });

  it("registers no tools when the plugin is disabled", () => {
    const harness = harnessOf({ config: { enabled: false } });
    expect(harness.registered).toEqual([]);
  });
});

describe("wiring: remote contract", () => {
  it("round-trips a domain through the Remote envelopes", async () => {
    const harness = harnessOf();

    const empty = await harness.service.listDomains();
    expect(empty.ok).toBe(true);
    expect(empty.domains).toEqual([]);

    const created = await harness.service.createDomain(DEFINITION);
    expect(created.ok).toBe(true);
    expect(created.domain?.id).toBe("payments");

    const listed = await harness.service.listDomains();
    expect(listed.domains.map((summary) => summary.id)).toEqual(["payments"]);
    expect(listed.domains[0]).toMatchObject({
      primaryPaths: 1,
      enabled: true,
      // The visible tools, not the configured ones: an expert always keeps the
      // plugin's own tools, so a card reading "0 tools" would be wrong.
      tools: 2,
    });

    const fetched = await harness.service.getDomain("payments");
    expect(fetched.domain?.name).toBe("Payments");

    const disabled = await harness.service.setDomainEnabled("payments", false);
    expect(disabled.domain?.enabled).toBe(false);

    const removed = await harness.service.deleteDomain("payments");
    expect(removed.deleted).toBe(true);
    expect((await harness.service.listDomains()).domains).toEqual([]);
  });

  it("refuses an invalid definition with a field-level code", async () => {
    const harness = harnessOf();
    const refused = await harness.service.createDomain({
      ...DEFINITION,
      id: "Payments",
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("DOMAIN_INVALID");
    expect(refused.message).toContain("id");
  });

  it("refuses a duplicate id and a missing domain", async () => {
    const harness = harnessOf();
    await harness.service.createDomain(DEFINITION);
    const duplicate = await harness.service.createDomain(DEFINITION);
    expect(duplicate.code).toBe("DOMAIN_EXISTS");
    expect((await harness.service.getDomain("ghost")).domain).toBeNull();
    const updated = await harness.service.updateDomain({
      ...DEFINITION,
      id: "ghost",
    });
    expect(updated.code).toBe("DOMAIN_NOT_FOUND");
  });

  it("previews a draft and reports its issues", async () => {
    const harness = harnessOf();
    const inspection = await harness.service.inspectDraft({
      ...DEFINITION,
      scope: {
        ...DEFINITION.scope,
        filesystem: { primary: ["../escape"], sharedReadOnly: [], denied: [] },
      },
    });
    expect(inspection.ok).toBe(true);
    expect(inspection.issues.map((issue) => issue.field)).toEqual([
      "scope.filesystem.primary",
    ]);
  });

  it("resolves a scope for the inspector without running the expert", async () => {
    const harness = harnessOf();
    await harness.service.createDomain(DEFINITION);
    const resolved = await harness.service.resolveScope("payments");
    expect(resolved.ok).toBe(true);
    expect(resolved.profile?.resources[0]).toMatchObject({
      path: "services/payments/**",
      class: "primary",
      enforcement: "advisory",
    });
    expect(resolved.profile?.memory[0]?.namespace).toBe("domain/payments");
    expect(resolved.profile?.persona).toContain(
      "You are the designated expert",
    );
  });

  it("lists the catalog and the built-in namespaces", async () => {
    const harness = harnessOf();
    const catalog = harness.service.catalog();
    expect(catalog.ok).toBe(true);
    expect(catalog.scopeProviders.map((provider) => provider.id)).toEqual([
      "filesystem",
    ]);
    expect(catalog.memoryProviders.map((provider) => provider.id)).toEqual([
      "builtin",
    ]);
    expect(catalog.tools.map((tool) => tool.name)).toEqual([
      "domain_expert",
      "domain_experts_list",
      "domain_memory",
    ]);
  });

  it("inspects memory and refuses a foreign namespace", async () => {
    const harness = harnessOf();
    await harness.service.createDomain(DEFINITION);
    const own = await harness.service.inspectMemory("payments", "", 50);
    expect(own.ok).toBe(true);
    expect(own.namespaces.map((view) => view.namespace)).toEqual([
      "domain/payments",
    ]);

    const foreign = await harness.service.inspectMemory(
      "payments",
      "domain/inventory",
      50,
    );
    expect(foreign.ok).toBe(false);
    expect(foreign.code).toBe("MEMORY_SCOPE_DENIED");

    const cleared = await harness.service.clearMemory("payments", "");
    expect(cleared.ok).toBe(true);
    const refused = await harness.service.clearMemory(
      "payments",
      "domain/inventory",
    );
    expect(refused.code).toBe("MEMORY_SCOPE_DENIED");
  });

  it("refuses a test run without a live session instead of throwing", async () => {
    const harness = harnessOf();
    await harness.service.createDomain(DEFINITION);
    const outcome = await harness.service.testExpert(
      "payments",
      "why is it stale",
      "",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("TASK_REJECTED");
    expect(outcome.message).toContain("live session");
  });

  it("reports provenance for the extension seams", () => {
    const harness = harnessOf();
    const dispose = harness.service.registerWorker({
      id: "code_worker",
      title: "Code worker",
      capabilities: ["read-files"],
      enforces: ["filesystem"],
      tool: "code_worker",
    });
    expect(
      harness.service.catalog().workers.map((worker) => worker.id),
    ).toEqual(["code_worker"]);
    dispose();
    expect(harness.service.catalog().workers).toEqual([]);
  });

  it("reports an audit ring on demand", () => {
    const harness = harnessOf();
    expect(harness.service.recentAudits(10)).toEqual({
      ok: true,
      code: "",
      message: "",
      entries: [],
    });
  });
});

describe("wiring: degraded storage", () => {
  it("answers STORAGE_UNAVAILABLE instead of throwing at load", async () => {
    const harness = harnessOf({
      storage: () =>
        Promise.reject(new Error("backend-not-found: no kv backend")),
    });
    const listed = await harness.service.listDomains();
    expect(listed.ok).toBe(false);
    expect(listed.code).toBe("STORAGE_UNAVAILABLE");
    expect(listed.message).toContain("backend-not-found");

    // The tools stay registered, so the failure is visible where it happened.
    expect(harness.registered).toHaveLength(3);

    const fetched = await harness.service.getDomain("payments");
    expect(fetched.code).toBe("STORAGE_UNAVAILABLE");

    const resolved = await harness.service.resolveScope("payments");
    expect(resolved.code).toBe("STORAGE_UNAVAILABLE");
    expect(resolved.profile).toBeNull();

    // The tool dependency awaits the open, so it reports the underlying cause
    // instead of an endless "not open yet".
    await expect(
      harness.service["requireDefinition"]("payments"),
    ).rejects.toThrowError(/Domain storage could not be opened/u);

    // Memory answers with the same code, because its backing table is deferred
    // rather than absent: the provider is registered for the plugin's lifetime.
    const memory = await harness.service.inspectMemory("payments", "", 10);
    expect(memory.code).toBe("STORAGE_UNAVAILABLE");
    expect(
      harness.service.catalog().memoryProviders.map((provider) => provider.id),
    ).toEqual(["builtin"]);
  });

  it("lets the first tool call after a start wait for the lazy storage open", async () => {
    // The open is lazy: before this fix, the first tool call raced it and was
    // refused "not open yet" even though storage was about to open fine.
    let release!: () => void;
    const harness = harnessOf({
      storage: () =>
        new Promise<DomainExpertsStorage>((resolve) => {
          release = () => resolve(storageWith(DEFINITION));
        }),
    });

    const pending = harness.service["requireDefinition"]("payments");
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(pending).resolves.toMatchObject({ id: "payments" });
  });
});

describe("wiring: sqlite memory", () => {
  const files: string[] = [];
  const services: DomainExpertsService[] = [];

  function dbPath(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "dsh-memory-wiring-"));
    files.push(dir);
    return path.join(dir, "domain-experts-memory.db");
  }

  /** A service wired to a unit holding these records, on its own database. */
  function harnessHolding(
    records: readonly MemoryRecord[],
    config: Record<string, unknown>,
  ): {
    readonly harness: Harness;
    readonly table: MemoryTable;
  } {
    const table = memoryTable<MemoryRecord>(
      records.map((record) => [`${record.namespace}::${record.key}`, record]),
    );
    const tables: Record<string, unknown> = {
      domains: domainTableOf([["payments", DEFINITION]]),
      memory: table,
    };
    const storage = {
      name: "domain_experts",
      table: (name: string) => tables[name],
      close: () => Promise.resolve(),
    } as unknown as DomainExpertsStorage;
    const harness = harnessOf({
      storage: () => Promise.resolve(storage),
      config,
    });
    services.push(harness.service);
    return { harness, table: table as unknown as MemoryTable };
  }

  afterEach(() => {
    // A provider holds its file open, and a test that failed mid-way never
    // reached the cleanup at its own end.
    for (const service of services.splice(0)) service["sqliteMemory"]?.close();
    for (const dir of files.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves a domain's memory from the database the unit was imported into", async () => {
    const { harness, table } = harnessHolding(productionShapedRecords(), {
      defaultMemoryProvider: "sqlite",
      memoryDbPath: dbPath(),
    });

    // Any Remote method opens the storage, and the one-time import rides with it.
    await harness.service.listDomains();
    expect(
      harness.service.catalog().memoryProviders.map((provider) => provider.id),
    ).toEqual(["builtin", "sqlite"]);

    const before = await harness.service.inspectMemory("payments", "", 50);
    expect(before.ok).toBe(true);
    expect(before.namespaces).toEqual([
      { namespace: "domain/payments", access: "read-write", records: 2 },
    ]);
    expect(before.records.map((record) => record.key)).toEqual([
      "settlement-window-v2",
      "settlement-window",
    ]);

    const written = await harness.service["memoryProviders"]
      .require("sqlite")
      .remember(
        "domain/payments",
        "cutoff",
        "Кutoff переехал вместе с памятью.",
        ["review"],
      );
    const after = await harness.service.inspectMemory("payments", "", 50);
    expect(after.records.map((record) => record.key)).toEqual([
      "cutoff",
      "settlement-window-v2",
      "settlement-window",
    ]);
    expect(after.records[0]?.text).toBe(written.text);

    // The unit still holds its copy — that is the rollback path, not litter —
    // and the new write did not go back into it.
    expect([...table.entries()]).toHaveLength(30);
    expect([...table.entries()].some(([key]) => key.endsWith("::cutoff"))).toBe(
      false,
    );
  });

  it("creates no database for a deployment that keeps memory in the unit", async () => {
    const filePath = dbPath();
    const { harness } = harnessHolding(productionShapedRecords(), {});

    await harness.service.listDomains();
    await harness.service.inspectMemory("payments", "", 10);

    expect(existsSync(filePath)).toBe(false);
    expect(
      harness.service.catalog().memoryProviders.map((provider) => provider.id),
    ).toEqual(["builtin"]);
  });

  it("refuses the deployment rather than serving from a half-copied database", async () => {
    // A unit a person edited by hand: a timestamp where the copy stores an
    // integer. The import's own verification fails, and the plugin reports
    // storage unavailable instead of answering from a partial database.
    const broken: MemoryRecord = {
      namespace: "domain/payments",
      key: "cutoff",
      text: "note",
      tags: [],
      createdAt: "1758000000000" as unknown as number,
      updatedAt: 2,
    };
    const table = memoryTable<MemoryRecord>([
      ["domain/payments::cutoff", broken],
    ]);
    const tables: Record<string, unknown> = {
      domains: domainTableOf([["payments", DEFINITION]]),
      memory: table,
    };
    const harness = harnessOf({
      storage: () =>
        Promise.resolve({
          name: "domain_experts",
          table: (name: string) => tables[name],
          close: () => Promise.resolve(),
        } as unknown as DomainExpertsStorage),
      config: {
        defaultMemoryProvider: "sqlite",
        memoryDbPath: dbPath(),
      },
    });
    services.push(harness.service);

    const listed = await harness.service.listDomains();
    expect(listed.ok).toBe(false);
    expect(listed.code).toBe("STORAGE_UNAVAILABLE");
    expect(listed.message).toMatch(/failed verification/u);
    expect([...table.entries()]).toHaveLength(1);
  });
});
