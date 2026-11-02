import { describe, expect, it, vi } from "vitest";
import { coalesceBrowserRefresh } from "../src/client/refresh-queue.js";

describe("Browser refresh queue", () => {
  it("coalesces poll ticks and preserves a forced refresh after a mutation", async () => {
    let release!: () => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const refresh = coalesceBrowserRefresh(read);
    const first = refresh(false);
    expect(refresh(false)).toBe(first);
    expect(refresh(true)).toBe(first);
    expect(refresh(true)).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(read.mock.calls).toEqual([[false], [true]]);
    await refresh(false);
    expect(read.mock.calls).toEqual([[false], [true], [false]]);
  });
});
