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
      validateRequest("https://public.example/"),
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
    await expect(gate!("https://public.example/")).rejects.toMatchObject({
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
          hostname === "intranet.example.corp"
            ? [{ address: "10.1.2.3", family: 4 }]
            : [{ address: "203.0.113.10", family: 4 }]) as never,
      }),
      startIdleTimer: false,
    });
    return { manager, provider };
  }

  it("remembers the refusal and forgets it after an allowed navigation", async () => {
    const { manager } = refusalHarness();
    await manager.ensureSession("panel");
    const [tab] = await manager.listTabs("panel");
    expect(manager.policyRefusal("panel")).toBeNull();

    await expect(
      manager.navigate("panel", tab!.id, {
        url: "https://intranet.example.corp/wiki",
      }),
    ).rejects.toMatchObject({ code: "BROWSER_HOST_BLOCKED" });

    // The panel needs the two facts it can act on: which host, and which
    // setting lifts the block. The refusal text carries the second one.
    const refusal = manager.policyRefusal("panel");
    expect(refusal).toMatchObject({
      code: "BROWSER_HOST_BLOCKED",
      host: "intranet.example.corp",
    });
    expect(refusal?.message).toContain("security.network.allowHosts");
    expect(refusal?.host).not.toContain("/");

    await manager.navigate("panel", tab!.id, {
      url: "https://public.example/docs",
    });
    expect(manager.policyRefusal("panel")).toBeNull();
    await manager.dispose();
  });

  it("records the redirect the provider itself refuses", async () => {
    const { manager, provider } = refusalHarness();
    await manager.ensureSession("redirect");
    const gate = [...provider.contexts.values()][0]?.options?.validateRequest;
    await expect(
      gate!("https://intranet.example.corp/report"),
    ).rejects.toMatchObject({
      code: "BROWSER_HOST_BLOCKED",
    } satisfies Partial<QaBrowserError>);
    expect(manager.policyRefusal("redirect")).toMatchObject({
      code: "BROWSER_HOST_BLOCKED",
      host: "intranet.example.corp",
    });
    await manager.dispose();
  });

  it("shows nothing for a session the manager does not hold", async () => {
    const { manager } = refusalHarness();
    await manager.ensureSession("quiet");
    expect(manager.policyRefusal("never-started")).toBeNull();
    await manager.dispose();
  });
});
