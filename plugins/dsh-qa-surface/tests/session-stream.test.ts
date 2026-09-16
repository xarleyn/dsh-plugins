import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSessionController } from "../src/client/QaSessionController.js";
import { harness } from "./helpers/session-fakes.js";

describe("stream update coalescing", () => {
  it("projects running-turn frames at most once per stream interval", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      streamIntervalMs: 25,
    });
    await controller.ensureSession();
    let publishes = 0;
    controller.subscribe(() => {
      publishes += 1;
    });
    const saved = world.faces.get("saved");
    const partialText = (text: string) => ({
      ...saved?.source.getSnapshot(),
      running: true,
      partial: { turn: 0, step: 0, blocks: [{ kind: "text", text }] },
    });
    // Turn start: the first frame of a window projects at once.
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    expect(publishes).toBe(1);
    // Further frames inside the window are absorbed.
    saved?.source.set(partialText("a") as never);
    saved?.source.set(partialText("ab") as never);
    expect(publishes).toBe(1);
    // After the window passes, the next frame projects again.
    await new Promise((resolve) => setTimeout(resolve, 40));
    saved?.source.set(partialText("abc") as never);
    expect(publishes).toBe(2);
    // Turn completion projects immediately, so the final state never waits.
    saved?.source.set({ ...saved.source.getSnapshot(), running: false });
    expect(publishes).toBe(3);
    controller.dispose();
  });

  it("projects every frame when stream spacing is disabled", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      streamIntervalMs: 0,
    });
    await controller.ensureSession();
    let publishes = 0;
    controller.subscribe(() => {
      publishes += 1;
    });
    const saved = world.faces.get("saved");
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    expect(publishes).toBe(2);
    controller.dispose();
  });
});
