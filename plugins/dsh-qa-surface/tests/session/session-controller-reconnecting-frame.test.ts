import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  QaSessionController,
  type QaSessionControllerOptions,
} from "../../src/client/QaSessionController.js";
import { harness, Source } from "../helpers/session-fakes.js";

/**
 * The frame a dropped link is owed. Turn notices gate on having seen a run
 * start, and `docs/CONFIGURATION.md` extends that silence across a gap in the
 * link — which only holds while the page is handed a frame naming the gap. This
 * is where that frame comes from: `QaSurface` reads `phase === "reconnecting"`
 * as the differ's `paused`, and while `paused` stands the differ leaves every
 * chat it holds `unwatched`.
 */
function controllerOn(link: Source<Record<string, unknown> | undefined>) {
  const world = harness(["saved"]);
  world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
  return new QaSessionController({
    ...world,
    config: resolveConfig(),
    connection: link as unknown as QaSessionControllerOptions["connection"],
  });
}

describe("QA controller across a dropped link", () => {
  it("emits a reconnecting frame from the connection notification itself", async () => {
    const link = new Source<Record<string, unknown> | undefined>({});
    const controller = controllerOn(link);
    await controller.ensureSession();
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready" });

    const frames: string[] = [];
    const stop = controller.subscribe(() =>
      frames.push(controller.getSnapshot().phase),
    );
    link.set(undefined);

    // Synchronous with the link going down, so nothing can reach the page
    // ahead of it: a refreshed list is something only a live link sends.
    expect(frames).toEqual(["reconnecting"]);

    link.set({});
    expect(frames.at(-1)).not.toBe("reconnecting");
    stop();
    controller.dispose();
  });

  it("invents no gap on a link that never dropped", async () => {
    const link = new Source<Record<string, unknown> | undefined>({});
    const controller = controllerOn(link);
    await controller.ensureSession();

    const frames: string[] = [];
    const stop = controller.subscribe(() =>
      frames.push(controller.getSnapshot().phase),
    );
    // A second generation of a link that stayed up must not silence the reader:
    // only a link that went down and came back earns that.
    link.set({});
    expect(frames).not.toContain("reconnecting");
    stop();
    controller.dispose();
  });
});
