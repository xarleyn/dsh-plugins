import { describe, expect, it } from "vitest";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
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
 * as the differ's `paused`, and while `paused` stands the differ credits no chat
 * at all — a running row leaves it `unwatched`, an idle one `stale`. The flag
 * goes back off with the connection, which is sooner than the host list is read
 * again, so the readings are what carry the gap over the frames whose rows have
 * not caught up.
 */
function controllerOn(link: Source<Record<string, unknown> | undefined>) {
  const world = harness(["saved"]);
  world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
  return {
    world,
    controller: new QaSessionController({
      ...world,
      config: resolveConfig(),
      connection: link as unknown as QaSessionControllerOptions["connection"],
    }),
  };
}

/** The sidebar's own rows, all of them running or all of them idle. */
function rows(running: boolean): SessionListState {
  return {
    ids: ["saved"] as never[],
    byId: {
      saved: {
        id: "saved",
        displayTitle: "saved",
        running,
        blank: true,
        updatedAt: 1,
      },
    } as SessionListState["byId"],
    phase: "ready",
    projectionsBySession: {},
  };
}

/** The phases the page was handed, in the order it was handed them. */
function watchPhases(controller: QaSessionController) {
  const frames: string[] = [];
  const stop = controller.subscribe(() =>
    frames.push(controller.getSnapshot().phase),
  );
  return { frames, stop };
}

describe("QA controller across a dropped link", () => {
  it("emits a reconnecting frame from the connection notification itself", async () => {
    const link = new Source<Record<string, unknown> | undefined>({});
    const { controller } = controllerOn(link);
    await controller.ensureSession();
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready" });

    const { frames, stop } = watchPhases(controller);
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
    const { controller } = controllerOn(link);
    await controller.ensureSession();

    const { frames, stop } = watchPhases(controller);
    // A second generation of a link that stayed up must not silence the reader:
    // only a link that went down and came back earns that.
    link.set({});
    expect(frames).not.toContain("reconnecting");
    stop();
    controller.dispose();
  });

  // A reconnect reaches the page over two subscriptions, not one: the link
  // coming back is the controller's own, while the host list arrives from a
  // re-pull the client starts once that link is up. Nothing orders the two, so
  // both orders are set here by hand (#479), and what each one owes the differ
  // is pinned at the seam where the page picks them up.
  it("hands the page the returned link before the list has been read again", async () => {
    const link = new Source<Record<string, unknown> | undefined>({});
    const { controller, world } = controllerOn(link);
    await controller.ensureSession();
    // A run is under way when the link goes, so the rows the page holds are the
    // ones an offline ending would leave behind.
    world.list.set(rows(true));
    link.set(undefined);
    expect(controller.getSnapshot()).toMatchObject({ phase: "reconnecting" });

    const { frames, stop } = watchPhases(controller);
    link.set({});
    // The live frame goes out on the strength of the link alone: the rows still
    // say what the gap left them saying, and nothing published here says
    // otherwise. This is the frame the differ has to refuse to credit.
    expect(frames.at(-1)).not.toBe("reconnecting");
    expect(world.list.getSnapshot()).toEqual(rows(true));
    // The Host's answer is a separate edge, and it lands later.
    world.list.set(rows(false));
    expect(frames.at(-1)).not.toBe("reconnecting");
    stop();
    controller.dispose();
  });

  it("keeps the gap named while the list arrives over a down link", async () => {
    const link = new Source<Record<string, unknown> | undefined>({});
    const { controller, world } = controllerOn(link);
    await controller.ensureSession();
    world.list.set(rows(true));
    link.set(undefined);

    const { frames, stop } = watchPhases(controller);
    // The other order: the refreshed list reaches the page while it still
    // reports itself reconnecting. A list edge is not a link edge — it must not
    // retire the frame that names the gap, or the silence the readings are built
    // out of would end before the link is back.
    world.list.set(rows(false));
    expect(controller.getSnapshot()).toMatchObject({ phase: "reconnecting" });
    expect(frames).not.toContain("ready");
    // The link's own edge is what ends the gap, and it is the last of the two.
    link.set({});
    expect(frames.at(-1)).not.toBe("reconnecting");
    stop();
    controller.dispose();
  });
});
