import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { apply, inject } from "../src/client/index.js";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("client entrypoint", () => {
  it("declares only the locale runtime dependency", () => {
    expect(inject).toEqual(["locale"]);
    expect(typeof apply).toBe("function");
  });

  it("returns an idempotent callable disposer", () => {
    const dispose = apply({} as Context, {
      document: null,
      logger: createLogger(),
    });
    expect(typeof dispose).toBe("function");
    expect(() => dispose()).not.toThrow();
    expect(() => dispose()).not.toThrow();
  });
});
