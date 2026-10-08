import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { harness } from "../helpers/session-fakes.js";
import { until } from "../helpers/settle.js";

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

  it("opens the chat on the push alone when the re-read it asked for is refused", async () => {
    // The catalog pull is the extra chance at the row, not the only one: a Host
    // that refuses it (a transport answer it rethrows, not a business one) must
    // not turn a repairable race into a failed chat, and its rejection must not
    // reach the browser as an unhandled one beside the plate.
    const world = harness();
    const created: string[] = [];
    world.createSession.mockImplementation(async () => {
      const id = String(await world.serverSession());
      created.push(id);
      return { ok: true as const, value: id };
    });
    const refusals: string[] = [];
    world.refresh.mockImplementation(async () => {
      refusals.push("session.list: transport down");
      throw new Error("session.list: transport down");
    });
    const raced: string[] = [];
    const logged = vi
      .spyOn(console, "warn")
      .mockImplementation((...args: unknown[]) => {
        raced.push(args.map((arg) => String(arg)).join(" "));
      });
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
    logged.mockRestore();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "created-1",
      error: null,
    });
    // The refused pull is said out loud — a chat lost in this shape reads as a
    // slow catalog and is really an unreadable one — and it is the retain's own
    // refusal that never had to be reported.
    expect(refusals).toHaveLength(1);
    expect(raced.join("\n")).toMatch(/session catalog refresh refused/u);
    expect(raced.join("\n")).toMatch(/raced the session catalog/u);
    clearInterval(push);
    controller.dispose();
  });

  it("reports a refusal of a listed session as the refusal it is", async () => {
    // The Host also refuses a retain for a session its catalog does name — a
    // route, a policy, a generation that ended. That is not the race, so the
    // surface must not print a race beside it, must not ask the catalog to
    // re-read itself, and must hand the caller the answer it was given.
    const world = harness();
    const id = String(await world.serverSession());
    world.publishRow(id);
    world.retain.mockImplementationOnce(() => {
      throw new Error("sessions.retain: session is not available here");
    });
    const lines: string[] = [];
    const logged = vi
      .spyOn(console, "warn")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => String(arg)).join(" "));
      });
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      timeoutMs: 40,
    });

    await controller.switchTo(id);
    logged.mockRestore();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: expect.stringMatching(/Не удалось открыть этот чат/u),
    });
    expect(lines.join("\n")).toBe("");
    expect(world.refresh).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("waits for the Client Session behind a row the catalog already lists", async () => {
    // The other half of the same window, which the fake used to skip: the row
    // is here and the reference is held, while the Client Session the binding
    // needs has not arrived — `bind()` waits on `reference.ready` for it, and a
    // chat that opens after that answer is still a chat that opened.
    const world = harness();
    world.deferClientSession();
    const id = String(await world.serverSession());
    world.publishRow(id);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    const opening = controller.switchTo(id);
    await until(() =>
      world.retain.mock.calls.some(([retained]) => String(retained) === id),
    );
    expect(world.faces.has(id)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: "creating" });

    world.materializeSession(id);
    await opening;

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: id,
      canSend: true,
      error: null,
    });
    expect(await controller.send("Вопрос")).toBe(true);
    expect(world.faces.get(id)?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Вопрос" }],
      "queue",
    );
    controller.dispose();
  });
});
