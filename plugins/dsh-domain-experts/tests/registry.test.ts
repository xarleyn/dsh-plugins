import { describe, expect, it } from "vitest";
import { DomainRegistry } from "../src/host/registry.js";
import { DomainExpertsError } from "../src/host/errors.js";
import { domainOf, domainTableOf, fixedClock } from "./helpers/fakes.js";

function registryOf(seed = [domainOf("inventory"), domainOf("payments")]) {
  const clock = fixedClock();
  return { registry: new DomainRegistry(domainTableOf(seed.map((d) => [d.id, d] as const)), clock), clock };
}

describe("registry: read", () => {
  it("lists domains ordered by display name", () => {
    const { registry } = registryOf([
      domainOf("beta", { name: "Beta" }),
      domainOf("alpha", { name: "Alpha" }),
    ]);
    expect(registry.list().map((domain) => domain.id)).toEqual(["alpha", "beta"]);
  });

  it("finds a domain by id and reports a missing one with the known ids", () => {
    const { registry } = registryOf();
    expect(registry.get("payments")?.name).toBe("payments");
    expect(registry.get("nope")).toBeUndefined();
    expect(() => registry.require("nope")).toThrowError(/Known domains: inventory, payments/u);
  });

  it("refuses a disabled domain through requireEnabled", () => {
    const { registry } = registryOf([domainOf("payments", { enabled: false })]);
    expect(() => registry.requireEnabled("payments")).toThrowError(DomainExpertsError);
    try {
      registry.requireEnabled("payments");
    } catch (error) {
      expect((error as DomainExpertsError).code).toBe("DOMAIN_DISABLED");
    }
  });

  it("reports summaries", () => {
    const { registry } = registryOf([domainOf("payments")]);
    expect(registry.summaries()[0]).toMatchObject({ id: "payments", primaryPaths: 0 });
  });
});

describe("registry: create", () => {
  it("stamps both timestamps and normalizes the record", async () => {
    const { registry } = registryOf([]);
    const created = await registry.create({ id: "payments", scope: { filesystem: { primary: ["./services//payments"] } } });
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.scope.filesystem.primary).toEqual(["services/payments"]);
    expect(registry.get("payments")).toEqual(created);
  });

  it("refuses a duplicate id", async () => {
    const { registry } = registryOf([domainOf("payments")]);
    await expect(registry.create({ id: "payments" })).rejects.toMatchObject({
      code: "DOMAIN_EXISTS",
    });
  });

  it("refuses an invalid definition", async () => {
    const { registry } = registryOf([]);
    await expect(registry.create({ id: "Payments" })).rejects.toMatchObject({
      code: "DOMAIN_INVALID",
    });
  });
});

describe("registry: update", () => {
  it("keeps the original creation time and advances the update time", async () => {
    const seed = domainOf("payments");
    const { registry, clock } = registryOf([seed]);
    const first = await registry.update({ ...seed, name: "Payments renamed" });
    expect(first.createdAt).toBe(seed.createdAt);
    expect(first.updatedAt).toBeGreaterThan(seed.updatedAt);
    const second = await registry.update({ ...first, name: "Payments renamed again" });
    expect(second.createdAt).toBe(seed.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(clock()).toBeGreaterThan(second.updatedAt);
  });

  it("refuses to update a domain that does not exist", async () => {
    const { registry } = registryOf([]);
    await expect(registry.update({ id: "payments" })).rejects.toMatchObject({
      code: "DOMAIN_NOT_FOUND",
    });
  });

  it("cannot rename through an update", async () => {
    const { registry } = registryOf([domainOf("payments")]);
    await expect(
      registry.update({ id: "payments", name: "Renamed" }),
    ).resolves.toMatchObject({ id: "payments", name: "Renamed" });
    expect(registry.list()).toHaveLength(1);
  });
});

describe("registry: enable and remove", () => {
  it("toggles enabled without touching other fields", async () => {
    const { registry } = registryOf([domainOf("payments", { description: "keep me" })]);
    const disabled = await registry.setEnabled("payments", false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.description).toBe("keep me");
    const again = await registry.setEnabled("payments", false);
    expect(again).toBe(disabled);
  });

  it("removes a domain and reports whether it existed", async () => {
    const { registry } = registryOf([domainOf("payments")]);
    await expect(registry.remove("payments")).resolves.toBe(true);
    await expect(registry.remove("payments")).resolves.toBe(false);
    expect(registry.list()).toEqual([]);
  });
});

describe("registry: draft inspection", () => {
  it("returns the parsed definition and its issues", () => {
    const { registry } = registryOf([]);
    const inspection = registry.inspectDraft({
      id: "payments",
      scope: { filesystem: { primary: ["../escape"] } },
    });
    expect(inspection.definition?.id).toBe("payments");
    expect(inspection.issues.map((issue) => issue.severity)).toEqual(["error"]);
  });

  it("reports a structural failure as a message rather than throwing", () => {
    const { registry } = registryOf([]);
    const inspection = registry.inspectDraft({
      id: "payments",
      delegation: { maxDepth: "deep" },
    });
    expect(inspection.definition?.delegation.maxDepth).toBe(3);
    expect(inspection.message).toBe("");
  });
});
