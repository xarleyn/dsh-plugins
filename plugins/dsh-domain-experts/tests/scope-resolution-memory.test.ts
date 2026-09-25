import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_MEMORY_OWNER,
  memoryOwnerOf,
  resolveExpert,
} from "../src/host/resolver.js";
import type { DomainDefinition } from "../src/types.js";
import { domainOf } from "./helpers/fakes.js";
import { PAYMENTS, fixtureOf, resolve } from "./scope-resolution.helpers.js";

describe("scope resolution: memory namespaces", () => {
  it("grants read/write on the private namespace and read-only on shared ones", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.memory.map((entry) => [entry.namespace, entry.access]),
    ).toEqual([
      ["domain/payments", "read-write"],
      ["shared/product", "read-only"],
    ]);
    expect(profile.scope.memory).toEqual({
      namespace: "domain/payments",
      sharedNamespaces: ["shared/product"],
    });
  });

  it("adds explicitly configured foreign namespaces in direct-read mode only", async () => {
    const base = domainOf("payments", {
      ...PAYMENTS,
      delegation: {
        ...PAYMENTS.delegation,
        crossDomainMode: "direct-read",
        directRead: ["domain/inventory"],
      },
    });
    const fixture = fixtureOf([base]);
    const profile = await resolve(fixture, base);
    expect(profile.memory.map((entry) => entry.namespace)).toEqual([
      "domain/payments",
      "shared/product",
      "domain/inventory",
    ]);

    const expertOnly = {
      ...base,
      delegation: { ...base.delegation, crossDomainMode: "expert-only" },
    };
    const second = await resolve(fixture, expertOnly as DomainDefinition);
    expect(second.memory.map((entry) => entry.namespace)).toEqual([
      "domain/payments",
      "shared/product",
    ]);
  });

  it("degrades when the configured memory provider is absent", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolveExpert(
      { ...fixture.dependencies, memoryProviderId: "openviking" },
      {
        definition: PAYMENTS,
        workspaceDir: "",
        callerDomain: null,
        depth: 1,
        memoryOwner: DEPLOYMENT_MEMORY_OWNER,
      },
    );
    expect(profile.degradations.map((item) => item.code)).toContain(
      "MEMORY_PROVIDER_MISSING",
    );
  });
});

describe("scope resolution: per-account memory", () => {
  const OWNER = { mode: "per-user", userId: "user-a" } as const;

  it("writes the account namespace and keeps the domain tier readable", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS, null, 1, OWNER);
    expect(
      profile.memory.map((entry) => [entry.namespace, entry.access]),
    ).toEqual([
      ["domain/payments/u/user-a", "read-write"],
      ["domain/payments", "read-only"],
      ["shared/product", "read-only"],
    ]);
    expect(profile.scope.memory).toEqual({
      namespace: "domain/payments/u/user-a",
      sharedNamespaces: ["domain/payments", "shared/product"],
    });
  });

  it("recalls the domain tier into an account's persona", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    await fixture.memoryProviders
      .require("builtin")
      .remember("domain/payments", "cutoff", "Settlement closes at 14:00.");
    const profile = await resolveExpert(
      fixture.dependencies,
      {
        definition: PAYMENTS,
        workspaceDir: "",
        callerDomain: null,
        depth: 1,
        memoryOwner: OWNER,
      },
      {
        task: "When does settlement close?",
        context: "",
        output: "",
        mode: "answer",
        background: false,
      },
    );
    expect(profile.persona).toContain(
      "[domain/payments/cutoff] Settlement closes at 14:00.",
    );
  });

  it("keeps one account's namespace out of another's read list", async () => {
    const definition = domainOf("payments", {
      ...PAYMENTS,
      memory: {
        namespace: "domain/payments",
        sharedReadOnly: ["domain/payments/u/user-b", "shared/product"],
      },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition, null, 1, OWNER);
    expect(profile.memory.map((entry) => entry.namespace)).toEqual([
      "domain/payments/u/user-a",
      "domain/payments",
      "shared/product",
    ]);
  });

  it("treats a name that cannot be a namespace segment as no account", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS, null, 1, {
      mode: "per-user",
      userId: "../../etc/passwd",
    });
    expect(
      profile.memory.map((entry) => [entry.namespace, entry.access]),
    ).toEqual([
      ["domain/payments", "read-write"],
      ["shared/product", "read-only"],
    ]);
  });

  it("says what an unattributed run of an account-scoped deployment gets", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS, null, 1, {
      mode: "per-user",
      userId: undefined,
    });
    const own = profile.memory.find((entry) => entry.access === "read-write");
    expect(own?.namespace).toBe("domain/payments");
    expect(own?.note).toContain("refused");
    expect(own?.note).toContain("domain/payments/u/<account>");
  });

  it("hands a delegated run the account of the run that spawned it", () => {
    expect(memoryOwnerOf(false, undefined, "user-a")).toEqual(
      DEPLOYMENT_MEMORY_OWNER,
    );
    expect(memoryOwnerOf(true, undefined, "user-a")).toEqual({
      mode: "per-user",
      userId: "user-a",
    });
    expect(
      memoryOwnerOf(true, { mode: "per-user", userId: "user-b" }, undefined),
    ).toEqual({ mode: "per-user", userId: "user-b" });
    // Attributed nowhere: per-user mode with no account, which is the state a
    // write refuses rather than one that records into the common tier.
    expect(memoryOwnerOf(true, undefined, undefined)).toEqual({
      mode: "per-user",
      userId: undefined,
    });
  });
});
