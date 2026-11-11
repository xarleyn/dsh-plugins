import { describe, expect, it, vi } from "vitest";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { harness } from "../helpers/session-fakes.js";

describe("draft source persistence before prompting", () => {
  it("waits for source persistence before allowing the first prompt", async () => {
    const world = harness();
    let finish!: () => void;
    const prepareSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      prepareSession,
    });
    await controller.ensureSession();
    expect(prepareSession).not.toHaveBeenCalled();
    const send = controller.send("Read selected source");
    await vi.waitFor(() =>
      expect(prepareSession).toHaveBeenCalledWith("created-1"),
    );
    expect(world.faces.get("created-1")?.prompt).not.toHaveBeenCalled();
    finish();
    expect(await send).toBe(true);
    expect(world.faces.get("created-1")?.prompt).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it("retries the same created session after a failed source save without prompting", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const world = harness();
    let fail = true;
    const prepareSession = vi.fn(async () => {
      if (fail) throw new Error("save unavailable");
    });
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      prepareSession,
    });
    try {
      await controller.ensureSession();
      expect(await controller.send("Read selected source")).toBe(false);
      expect(world.faces.get("created-1")?.prompt).not.toHaveBeenCalled();
      fail = false;
      expect(await controller.send("Retry selected source")).toBe(true);
      expect(world.createSession).toHaveBeenCalledOnce();
      expect(prepareSession.mock.calls).toEqual([["created-1"], ["created-1"]]);
    } finally {
      controller.dispose();
      errors.mockRestore();
    }
  });
});
