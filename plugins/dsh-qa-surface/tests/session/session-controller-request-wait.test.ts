import { afterEach, describe, expect, it, vi } from "vitest";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { QaQueueStatus } from "../../src/types.js";
import { harness } from "../helpers/session-fakes.js";
const waiting: QaQueueStatus = {
  limit: 2,
  active: 2,
  full: true,
  managed: true,
  waiting: true,
  position: 1,
  estimatedWaitMs: null,
};
async function ready(read: () => Promise<{ ok: true; value: QaQueueStatus }>) {
  const world = harness(["saved", "other"]);
  world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig({ session: { maxActiveRequests: 2 } }),
    queueStatus: async () => ({ ok: true, value: waiting }),
    requestStatus: read,
  });
  await controller.ensureSession();
  return { ...world, controller };
}
function running(
  world: Awaited<ReturnType<typeof ready>>,
  id: string,
  value = true,
) {
  const face = world.faces.get(id)!;
  face.source.set({ ...face.source.getSnapshot(), running: value });
}
async function settle() {
  for (let n = 0; n < 12; n++) await Promise.resolve();
}
describe("server waiting in the session controller", () => {
  afterEach(() => vi.useRealTimers());
  it("sends to a full managed queue instead of retaining a rejected draft", async () => {
    const read = vi.fn(async () => ({ ok: true as const, value: waiting }));
    const world = await ready(read);
    expect(await world.controller.send("queue fixture")).toBe(true);
    expect(world.faces.get("saved")!.prompt).toHaveBeenCalledOnce();
    running(world, "saved");
    await settle();
    expect(world.controller.getSnapshot().requestQueue).toMatchObject({
      managed: true,
      waiting: true,
      position: 1,
    });
    expect(read).toHaveBeenCalledWith("", "saved");
    running(world, "saved", false);
    expect(world.controller.getSnapshot().requestQueue).toBeNull();
    world.controller.dispose();
  });
  it("restores the server position for an already waiting chat and removes it on admission", async () => {
    const read = vi.fn(async () => ({ ok: true as const, value: waiting }));
    const world = await ready(read);
    vi.useFakeTimers();
    running(world, "saved");
    await settle();
    expect(world.controller.getSnapshot().requestQueue?.position).toBe(1);
    read.mockResolvedValue({
      ok: true,
      value: { ...waiting, waiting: false, position: null },
    });
    await vi.advanceTimersByTimeAsync(2500);
    expect(world.controller.getSnapshot().requestQueue).toBeNull();
    world.controller.dispose();
  });
  it("ignores an old chat's delayed position after switching to another chat", async () => {
    let finish!: (value: { ok: true; value: QaQueueStatus }) => void;
    const read = vi.fn(
      () =>
        new Promise<{ ok: true; value: QaQueueStatus }>((yes) => {
          finish = yes;
        }),
    );
    const world = await ready(read);
    running(world, "saved");
    await settle();
    await world.controller.switchTo("other");
    finish({ ok: true, value: waiting });
    await settle();
    expect(world.controller.getSnapshot().sessionId).toBe("other");
    expect(world.controller.getSnapshot().requestQueue).toBeNull();
    world.controller.dispose();
  });
});
