import { describe, expect, test, vi } from "vitest";
import { resolveConfig } from "../src/config.js";
import { authenticatedFetch } from "../src/transport/fetch.js";
import { configWith, fixtureRule } from "./helpers.js";

describe("pre-request deadline", () => {
  test.each(["dns", "secret"])(
    "bounds stalled %s resolution and does not continue after cancellation",
    async (phase) => {
      const source = fixtureRule("http://127.0.0.1:1", {
        limits: { timeoutMs: 20 },
      });
      const config = resolveConfig(
        configWith([
          {
            ...source,
            match: { ...source.match, hosts: ["fetch.example.com"] },
          },
        ]),
      );
      const rule = config.rules[0]!;
      let release!: (value: string[]) => void;
      const pending = new Promise<string[]>((resolve) => {
        release = resolve;
      });
      const secrets = vi.fn(async () => new Promise<never>(() => {}));
      await expect(
        authenticatedFetch({
          url: new URL("http://fetch.example.com:1/secure/resource"),
          rule,
          rules: config.rules,
          globals: { maxUrlLength: 2048, userAgent: "synthetic-test" },
          resolveSecrets: secrets,
          resolveAddresses: async () =>
            phase === "dns" ? pending : ["127.0.0.1"],
        }),
      ).rejects.toMatchObject({ code: "AUTH_FETCH_TIMEOUT" });
      release(["127.0.0.1"]);
      await Promise.resolve();
      expect(secrets).toHaveBeenCalledTimes(phase === "dns" ? 0 : 1);
    },
  );

  test("caller cancellation interrupts DNS and preserves the abort code", async () => {
    const config = resolveConfig(
      configWith([fixtureRule("http://127.0.0.1:1")]),
    );
    const caller = new AbortController();
    const operation = authenticatedFetch({
      url: new URL("http://fetch.example.com:1/secure/resource"),
      rule: config.rules[0]!,
      rules: config.rules,
      globals: { maxUrlLength: 2048, userAgent: "synthetic-test" },
      signal: caller.signal,
      resolveSecrets: async () => ({}),
      resolveAddresses: async () => new Promise(() => {}),
    });
    caller.abort();
    await expect(operation).rejects.toMatchObject({ code: "WEB_ABORTED" });
  });
});
