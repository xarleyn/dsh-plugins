import { describe, expect, it } from "vitest";
import {
  buildSleevHeaders,
  EXPERIMENTAL_DSH_HARNESS_ID,
} from "../src/host/optimizer/sleev/headers.js";

describe("Sleev routing headers", () => {
  it("builds a known-provider route without custom-upstream metadata", () => {
    expect(
      buildSleevHeaders({
        kind: "provider",
        provider: "openai",
        harnessId: EXPERIMENTAL_DSH_HARNESS_ID,
      }),
    ).toEqual({
      "sleev-provider": "openai",
      "sleev-harness": "pi",
    });
  });

  it("builds a custom-upstream route without a provider header", () => {
    expect(
      buildSleevHeaders({
        kind: "custom",
        baseUrl: "https://gateway.example/v1",
        harnessId: "future-dsh-id",
      }),
    ).toEqual({
      "sleev-base-url": "https://gateway.example/v1",
      "sleev-harness": "future-dsh-id",
    });
  });

  it("rejects malformed and header-injection values", () => {
    expect(() =>
      buildSleevHeaders({
        kind: "provider",
        provider: "openai\r\nevil: value",
        harnessId: "pi",
      }),
    ).toThrow(/line break/);
    expect(() =>
      buildSleevHeaders({
        kind: "custom",
        baseUrl: "file:///secret",
        harnessId: "pi",
      }),
    ).toThrow(/HTTP or HTTPS/);
  });
});
