import { describe, expect, it, vi } from "vitest";
import { startVisibilityAwarePolling } from "../src/client/index.js";

describe("client polling", () => {
  it("pauses while hidden and refreshes immediately when visible", () => {
    let hidden = true;
    let visibilityListener: (() => void) | undefined;
    let intervalHandler: (() => void) | undefined;
    const documentTarget = {
      get hidden() { return hidden; },
      addEventListener: vi.fn((_type: "visibilitychange", listener: () => void) => {
        visibilityListener = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const windowTarget = {
      setInterval: vi.fn((handler: () => void) => {
        intervalHandler = handler;
        return 17;
      }),
      clearInterval: vi.fn(),
    };
    const refresh = vi.fn();

    const stop = startVisibilityAwarePolling(refresh, 2_000, documentTarget, windowTarget);
    expect(refresh).not.toHaveBeenCalled();

    intervalHandler?.();
    expect(refresh).not.toHaveBeenCalled();

    hidden = false;
    visibilityListener?.();
    expect(refresh).toHaveBeenCalledOnce();

    intervalHandler?.();
    expect(refresh).toHaveBeenCalledTimes(2);

    hidden = true;
    visibilityListener?.();
    intervalHandler?.();
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
    expect(windowTarget.clearInterval).toHaveBeenCalledWith(17);
    expect(documentTarget.removeEventListener)
      .toHaveBeenCalledWith("visibilitychange", visibilityListener);
  });
});
