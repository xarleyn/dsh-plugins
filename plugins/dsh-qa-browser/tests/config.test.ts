import path from "node:path";

import { describe, expect, it } from "vitest";

import { QA_BROWSER_DEFAULTS, resolveQaBrowserConfig } from "../src/config.js";

describe("resolveQaBrowserConfig", () => {
  it("uses the secure runtime defaults from the specification", () => {
    expect(resolveQaBrowserConfig()).toEqual(QA_BROWSER_DEFAULTS);
  });

  it("normalizes policy lists and clamps resource limits", () => {
    const config = resolveQaBrowserConfig({
      runtime: {
        actionTimeoutMs: 1,
        navigationTimeoutMs: 999_999,
        idleTimeoutMinutes: 0,
      },
      session: { maxTabs: 500 },
      security: {
        network: {
          allowedSchemes: ["HTTPS:", "https", " http "],
          allowHosts: ["LOCALHOST", "localhost"],
        },
      },
    });

    expect(config.runtime).toMatchObject({
      actionTimeoutMs: 250,
      navigationTimeoutMs: 180_000,
      idleTimeoutMs: 60_000,
    });
    expect(config.session.maxTabs).toBe(32);
    expect(config.security.network.allowedSchemes).toEqual(["https", "http"]);
    expect(config.security.network.allowHosts).toEqual(["localhost"]);
  });

  it("rejects relative executable paths", () => {
    expect(() =>
      resolveQaBrowserConfig({
        runtime: { executablePath: path.join("relative", "chrome") },
      }),
    ).toThrow(/must be absolute/u);
  });
});
