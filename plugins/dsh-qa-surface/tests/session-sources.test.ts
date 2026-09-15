/** Host source bundles: what the bridge keeps, republishes and reports. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { QaHostSourceBridge } from "../src/client/session-sources.js";
import type { QaTurnSources } from "../src/types.js";

const BUNDLE: QaTurnSources = {
  version: 1,
  sessionId: "saved",
  turn: 1,
  sources: [],
  complete: true,
};

type SourceAnswer =
  | { readonly ok: true; readonly value: readonly QaTurnSources[] }
  | { readonly ok: false; readonly error: unknown };

function bridgeFor(
  sources: (token: string, sessionId: string) => Promise<SourceAnswer>,
) {
  return new QaHostSourceBridge(
    {
      sources,
      readSourceFile: async () => ({ ok: false as const, error: undefined }),
    } as never,
    () => "token",
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("host source bridge", () => {
  it("publishes a changed payload once and merges it over the projection", async () => {
    const sources = vi.fn(async () => ({ ok: true as const, value: [BUNDLE] }));
    const bridge = bridgeFor(sources);
    let published = 0;
    const onChanged = () => {
      published += 1;
    };

    await bridge.refresh("saved", onChanged);
    await bridge.refresh("saved", onChanged);
    // One payload, one republish: the second fetch found the same bytes.
    expect(published).toBe(1);
    expect(sources).toHaveBeenCalledWith("token", "saved");
    expect(bridge.merge([])).toEqual([BUNDLE]);
    // The host bundle wins the turn it shares with the projection.
    expect(
      bridge.merge([{ ...BUNDLE, sessionId: "projected" }])[0]?.sessionId,
    ).toBe("saved");
  });

  it("reports a refused fetch once per distinct refusal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let answer: SourceAnswer = { ok: false, error: { code: "policy" } };
    const sources = vi.fn(async () => answer);
    const bridge = bridgeFor(sources);

    await bridge.refresh("saved", () => undefined);
    await bridge.refresh("saved", () => undefined);
    expect(warn).toHaveBeenCalledTimes(1);

    // A different refusal is a different fact and is reported in its turn.
    answer = { ok: false, error: { code: "auth" } };
    await bridge.refresh("saved", () => undefined);
    expect(warn).toHaveBeenCalledTimes(2);

    // Recovering and failing again with the same reason reports once more.
    answer = { ok: true, value: [] };
    await bridge.refresh("saved", () => undefined);
    answer = { ok: false, error: { code: "auth" } };
    await bridge.refresh("saved", () => undefined);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("drops the chat's bundles and its refusal on reset", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridge = bridgeFor(async () => ({
      ok: false as const,
      error: { code: "policy" },
    }));
    await bridge.refresh("saved", () => undefined);
    expect(bridge.merge([])).toEqual([]);

    bridge.reset();
    expect(bridge.merge([])).toEqual([]);
    // The next chat starts with a clean slate: the same refusal speaks again.
    await bridge.refresh("other", () => undefined);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
