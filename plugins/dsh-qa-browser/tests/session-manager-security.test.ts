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
