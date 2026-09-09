// @vitest-environment jsdom

import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { apply, inject } from "../src/client/index.js";

describe("client entrypoint", () => {
  it("provides a browser-local service and removes it on disposal", () => {
    const removeService = vi.fn();
    const provide = vi.fn(() => removeService);
    const dispose = apply({ provide } as unknown as Context, {
      document,
      observeMutations: false,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(inject).toEqual([]);
    expect(provide).toHaveBeenCalledWith("uiRepair", expect.anything());
    dispose();
    dispose();
    expect(removeService).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without a DOM", () => {
    const provide = vi.fn();
    const dispose = apply({ provide } as unknown as Context, { document: null });
    dispose();
    expect(provide).not.toHaveBeenCalled();
  });
});
