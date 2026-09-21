import { describe, expect, it } from "vitest";

import { resolveQaBrowserConfig } from "../src/config.js";
import { QaBrowserError } from "../src/errors.js";
import { BrowserNetworkPolicy } from "../src/host/policy.js";
import { QaBrowserSessionManager } from "../src/host/session-manager.js";

import { FakeProvider } from "./session-manager.helpers.js";

describe("QaBrowserSessionManager", () => {
  it("re-resolves the host inside validateRequest and refuses divergence", async () => {
    const config = resolveQaBrowserConfig({
      security: { network: { allowHosts: ["*.example"] } },
    });
    const provider = new FakeProvider();
    const manager = new QaBrowserSessionManager({
      config,
      provider,
      policy: new BrowserNetworkPolicy(config.security.network, {
        lookup: (async (hostname: string) =>
          hostname === "public.example"
            ? [{ address: "203.0.113.10", family: 4 }]
            : []) as never,
      }),
      startIdleTimer: false,
    });
    await manager.ensureSession("rebinding");
    const validateRequest =
      [...provider.contexts.values()][0]?.options?.validateRequest ??
      (() => Promise.resolve());
    await expect(
      validateRequest("https://public.example/", { kind: "document" }),
    ).resolves.toBeUndefined();
    await manager.dispose();

    // A flapping DNS answers every resolve differently, which is the rebinding
    // move the pre-dial re-resolve exists to catch.
    let resolutions = 0;
    const provider2 = new FakeProvider();
    const manager2 = new QaBrowserSessionManager({
      config,
      provider: provider2,
      policy: new BrowserNetworkPolicy(config.security.network, {
        lookup: (async () => {
          resolutions += 1;
          return [
            {
              address: resolutions % 2 === 1 ? "203.0.113.10" : "10.0.0.5",
              family: 4,
            },
          ];
        }) as never,
      }),
      startIdleTimer: false,
    });
    await manager2.ensureSession("flapping");
    const gate = [...provider2.contexts.values()][0]?.options?.validateRequest;
    await expect(
      gate!("https://public.example/", { kind: "document" }),
    ).rejects.toMatchObject({
      code: "BROWSER_HOST_BLOCKED",
    } satisfies Partial<QaBrowserError>);
    await manager2.dispose();
  });
});

describe("policy refusals the panel can show", () => {
  /** A deployment whose DNS sends the internal name into an RFC1918 range. */
  function refusalHarness() {
    const config = resolveQaBrowserConfig({
      security: { network: { allowHosts: ["public.example"] } },
    });
    const provider = new FakeProvider();
    const manager = new QaBrowserSessionManager({
      config,
      provider,
      policy: new BrowserNetworkPolicy(config.security.network, {
        lookup: (async (hostname: string) =>
          hostname.includes("intranet")
            ? [{ address: "10.1.2.3", family: 4 }]
            : [{ address: "203.0.113.10", family: 4 }]) as never,
      }),
      startIdleTimer: false,
    });
    return { manager, provider };
  }

  /** The provider's pre-dial gate of the context a session just created. */
  function requestGate(provider: FakeProvider) {
    const gate = [...provider.contexts.values()][0]?.options?.validateRequest;
    if (gate === undefined) throw new Error("the context exposed no gate");
    return gate;
  }

  it("remembers a refused navigation and forgets it on the next page", async () => {
    const { manager } = refusalHarness();
    await manager.ensureSession("panel");
    const [tab] = await manager.listTabs("panel");
    expect(manager.policyRefusals("panel")).toEqual([]);

    await expect(
      manager.navigate("panel", tab!.id, {
        url: "https://intranet.example.corp/wiki",
      }),
    ).rejects.toMatchObject({ code: "BROWSER_HOST_BLOCKED" });

    // The panel needs the two facts it can act on: which host, and which
    // setting lifts the block. The refusal text carries the second one.
    const [refusal] = manager.policyRefusals("panel");
    expect(refusal).toMatchObject({
      code: "BROWSER_HOST_BLOCKED",
      kind: "document",
      host: "intranet.example.corp",
      count: 1,
    });
    expect(refusal?.message).toContain("security.network.allowHosts");
    expect(refusal?.host).not.toContain("/");

    await manager.navigate("panel", tab!.id, {
      url: "https://public.example/docs",
    });
    expect(manager.policyRefusals("panel")).toEqual([]);
    await manager.dispose();
  });

  it("separates a refused request from a refused page and counts repeats", async () => {
    const { manager, provider } = refusalHarness();
    await manager.ensureSession("partial");
    const gate = requestGate(provider);
    const resource = { kind: "resource" } as const;

    await expect(
      gate("https://api.intranet.example.corp/items", resource),
    ).rejects.toMatchObject({
      code: "BROWSER_HOST_BLOCKED",
    } satisfies Partial<QaBrowserError>);
    await expect(
      gate("https://api.intranet.example.corp/items?page=2", resource),
    ).rejects.toMatchObject({
      code: "BROWSER_HOST_BLOCKED",
    } satisfies Partial<QaBrowserError>);
    // The page itself loaded from an allowed host, so the entry a reader must
    // not confuse with it is a request; a retried endpoint stays one entry.
    expect(manager.policyRefusals("partial")).toMatchObject([
      {
        kind: "resource",
        host: "api.intranet.example.corp",
        count: 2,
      },
    ]);

    await expect(
      gate("https://intranet.example.corp/report", { kind: "document" }),
    ).rejects.toMatchObject({
      code: "BROWSER_HOST_BLOCKED",
    } satisfies Partial<QaBrowserError>);
    expect(manager.policyRefusals("partial")).toMatchObject([
      { kind: "resource", host: "api.intranet.example.corp", count: 2 },
      { kind: "document", host: "intranet.example.corp", count: 1 },
    ]);
    await manager.dispose();
  });

  it("stops growing the notice at a bounded number of hosts", async () => {
    const { manager, provider } = refusalHarness();
    await manager.ensureSession("many");
    const gate = requestGate(provider);

    for (let index = 0; index < 12; index += 1) {
      await expect(
        gate(`https://host-${String(index)}.intranet.example.corp/app.js`, {
          kind: "resource",
        }),
      ).rejects.toMatchObject({
        code: "BROWSER_HOST_BLOCKED",
      } satisfies Partial<QaBrowserError>);
    }

    // A page failing on more destinations than a banner can explain keeps the
    // first eight: the earliest failures are the ones worth an operator's
    // attention, and a list that keeps reshuffling as the page fails reads as
    // noise instead of a cause.
    const refusals = manager.policyRefusals("many");
    expect(refusals).toHaveLength(8);
    expect(refusals[0]).toMatchObject({ host: "host-0.intranet.example.corp" });
    expect(refusals[7]).toMatchObject({ host: "host-7.intranet.example.corp" });
    await manager.dispose();
  });

  it("shows nothing for a session the manager does not hold", async () => {
    const { manager } = refusalHarness();
    await manager.ensureSession("quiet");
    expect(manager.policyRefusals("never-started")).toEqual([]);
    await manager.dispose();
  });
});
