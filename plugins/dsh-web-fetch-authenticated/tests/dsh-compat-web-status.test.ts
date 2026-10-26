/**
 * The `dsh-compat` observation over the non-public `WebRuntime` shape
 * (INVESTIGATE.md §8): the status card reports the pinned `ctx.web` fetch
 * provider id when it can be read structurally and reads “not pinned”
 * otherwise. The Host changed where the pinned id lives in `0.2.1` — the
 * helper must keep following the Host's own resolution precedence
 * (volatile config field, then environment, then the pre-`0.2.1` field).
 */

import { describe, expect, test } from "vitest";
import { observedFetchProviderId } from "../src/dsh-compat/web-status.js";

describe("observedFetchProviderId", () => {
  test("reads the 0.2.1 volatile config field ahead of the environment fallback", () => {
    const web = {
      config: { fetchProvider: { get: () => "authenticated" } },
      fetchProviderEnv: "default-fetch",
    };
    expect(observedFetchProviderId(web)).toBe("authenticated");
  });

  test("falls back to the boot environment value when config is unpinned", () => {
    const web = {
      config: { fetchProvider: { get: () => undefined } },
      fetchProviderEnv: "authenticated",
    };
    expect(observedFetchProviderId(web)).toBe("authenticated");
  });

  test("reads the pre-0.2.1 private field when the volatile shape is absent", () => {
    expect(observedFetchProviderId({ fetchProviderId: "authenticated" })).toBe(
      "authenticated",
    );
  });

  test("foreign or unpinned shapes read as not pinned", () => {
    expect(observedFetchProviderId(undefined)).toBeUndefined();
    expect(observedFetchProviderId(null)).toBeUndefined();
    expect(observedFetchProviderId(42)).toBeUndefined();
    expect(observedFetchProviderId({})).toBeUndefined();
    expect(
      observedFetchProviderId({
        config: { fetchProvider: { get: () => "" } },
        fetchProviderEnv: "",
        fetchProviderId: "",
      }),
    ).toBeUndefined();
  });
});
