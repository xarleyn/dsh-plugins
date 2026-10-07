import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { harness } from "../helpers/session-fakes.js";

/**
 * A QA session is born on the server, through this plugin's own Remote, while
 * `sessions.retain` is answered by the catalog this browser holds. The create can
 * therefore answer before the row that lists the session reaches the browser, and
 * a retain asked in that window is refused with `sessions.retain: unknown
 * session` — which used to be reported as a chat that could not start, on a stand
 * that had in fact created it.
 */
describe("QA session controller: a retain that raced the session catalog", () => {
  /** Route every creation through the server, leaving its row unlisted. */
  function laggingCatalog(world: ReturnType<typeof harness>) {
    const created: string[] = [];
    world.createSession.mockImplementation(async () => {
      const id = String(await world.serverSession());
      created.push(id);
      return { ok: true as const, value: id };
    });
    return created;
  }

  it("opens the first chat once the pull it asks for lists the session", async () => {
    const world = harness();
    const created = laggingCatalog(world);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    await controller.ensureSession();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "created-1",
      canSend: true,
      error: null,
    });
    // The refused retain and the one the catalog made possible: the id is
    // retained twice, and held once.
    expect(
      world.retain.mock.calls.filter(([id]) => String(id) === created[0]),
    ).toHaveLength(2);
    const held = world.references.filter((ref) => ref.sessionId === created[0]);
    expect(held).toHaveLength(1);
    expect(held[0]?.release).not.toHaveBeenCalled();
    // And the chat answers: the session the stand created is the one on screen.
    expect(await controller.send("Первый вопрос")).toBe(true);
    expect(world.faces.get("created-1")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Первый вопрос" }],
      "queue",
    );
    controller.dispose();
  });

  it("opens the first chat on the Host push alone, without a fresh pull", async () => {
    const world = harness();
    const created = laggingCatalog(world);
    // The row can also arrive on its own, before any pull this surface asked
    // for; the wait must accept whichever of the two comes first.
    world.refresh.mockImplementation(async () => undefined);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const opening = controller.ensureSession();
    const push = setInterval(() => {
      if (created.length === 0) return;
      clearInterval(push);
      world.publishRow(created[0]!);
    }, 2);
    await opening;

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "created-1",
      error: null,
    });
    clearInterval(push);
    controller.dispose();
  });

  it("keeps the Host's refusal as the reason a chat never started", async () => {
    const world = harness();
    laggingCatalog(world);
    // Neither the pull nor a push brings the row: the session was never listed,
    // and the chat has to be reported for what the Host said about it.
    world.refresh.mockImplementation(async () => undefined);
    const refusals: string[] = [];
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        refusals.push(args.map((arg) => String(arg)).join(" "));
      });
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      timeoutMs: 40,
    });

    await controller.ensureSession();

    logged.mockRestore();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: expect.stringMatching(/Не удалось начать чат/u),
      canSend: false,
    });
    // The refusal the Host gave is what the surface logs, not the wait's own
    // timeout: an operator reading the console has to see the same sentence the
    // stand was observed failing with.
    expect(refusals.join("\n")).toMatch(
      /sessions\.retain: unknown session created-1/u,
    );
    // One creation only, so a chat that never started does not leave a second
    // session behind for the next attempt to orphan as well.
    expect(world.createSession).toHaveBeenCalledOnce();
    expect(world.stored.has("dsh-qa-surface.session:v1:/qa:session")).toBe(
      false,
    );
    controller.dispose();
  });
});
