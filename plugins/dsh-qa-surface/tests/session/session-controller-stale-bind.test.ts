import { describe, expect, it } from "vitest";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import {
  conversationBinding,
  harness,
  sessionFace,
  type QaSessionTestWorld,
} from "../helpers/session-fakes.js";

/**
 * A first send waits for its session twice: for the Host to list it, and for
 * that session to open and pass the policy check. Every one of those waits
 * outlives the click that moves to another chat, and an adoption that finishes
 * after the move belongs to nobody: it has to leave the identity and the binding
 * of the chat on screen alone.
 */
describe("QA session controller: an adoption the visitor left behind", () => {
  it("keeps the chat on screen when a first send finds its session late", async () => {
    const world = harness(["other"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: { policy: "new-on-load" },
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();

    // The Host answered the creation but has not listed the session yet, so
    // bind() is parked in the wait for the list — it has taken nothing, which is
    // also the moment a chat switch is harmless. The late arrival below is what
    // used to make it a takeover.
    const late = "not-listed-yet";
    world.createSession.mockImplementationOnce(async () => ({
      ok: true as const,
      value: late,
    }));
    const sending = controller.send("Первый вопрос");
    // The reference is retained as bind() starts looking for the session, which
    // is the hand-off into the wait this test is about: the switch below has to
    // land while the adoption is still parked in it.
    await until(() =>
      world.retain.mock.calls.some(([id]) => String(id) === late),
    );

    // The visitor gives up on the question that will not start and opens another
    // chat, which takes an identity of its own and binds its own session.
    await controller.switchTo("other");
    const liveKey = controller.getSnapshot().chatKey;
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "other",
      chatKey: liveKey,
      canSend: true,
    });

    // The Host finally lists the session this send was waiting for. Its binding
    // is not the chat on screen, so the adoption has to notice and step back.
    relist(world, late);
    expect(await sending).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "other",
      chatKey: liveKey,
      canSend: true,
      error: null,
    });
    // The chat on screen is still a chat: the next question rides its session
    // instead of being told there is no chat to send into.
    expect(await controller.send("Второй вопрос")).toBe(true);
    expect(world.faces.get("other")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Второй вопрос" }],
      "queue",
    );
    expect(world.faces.get(late)?.prompt).not.toHaveBeenCalled();
    // And it still owns its identity: had the abandoned adoption cleared the
    // name, the next chat this surface bootstraps would have inherited it.
    // (`harness(["other"])` starts its creation sequence at one, so the
    // bootstrap above took `created-2` and this one takes `created-3`.)
    await controller.ensureSession();
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "created-3",
    });
    expect(controller.getSnapshot().chatKey).not.toBe(liveKey);
    controller.dispose();
  });

  it("keeps the chat on screen when a first send cannot open the session it took", async () => {
    const world = harness(["other"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();

    // The other half of the race: the session is listed and bound, and this
    // adoption has already taken its subscriptions — only the open is still
    // waiting. `target("chat")` is subscribed as the binding is adopted, so its
    // first call is the proof this bind is parked past that point.
    let stalled = "";
    world.createSession.mockImplementationOnce(async () => {
      stalled = String(await world.create());
      const face = world.faces.get(stalled);
      face?.source.set({ ...face.source.getSnapshot(), openState: "opening" });
      return { ok: true as const, value: stalled };
    });
    const sending = controller.send("Первый вопрос");
    await until(
      () => (world.bindings.get(stalled)?.target.mock.calls.length ?? 0) > 0,
    );

    await controller.switchTo("other");
    const liveKey = controller.getSnapshot().chatKey;

    // The abandoned session finally reports what the stand thinks of it. The
    // rollback of that failure is this adoption's own; the live chat's binding
    // and identity are not it to undo.
    const stalledFace = world.faces.get(stalled);
    stalledFace?.source.set({
      ...stalledFace.source.getSnapshot(),
      openState: "error",
    });
    expect(await sending).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "other",
      chatKey: liveKey,
      canSend: true,
      error: null,
    });
    expect(await controller.send("Второй вопрос")).toBe(true);
    expect(world.faces.get("other")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Второй вопрос" }],
      "queue",
    );
    controller.dispose();
  });

  it("keeps the identity of the chat on screen when a refused attestation reaches it late", async () => {
    const world = harness(["other"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: { policy: "new-on-load" },
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const stalled = "created-3";
    let releaseAttestation!: (
      value: Awaited<ReturnType<typeof world.secureSession>>,
    ) => void;
    world.secureSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAttestation = resolve;
        }),
    );
    const sending = controller.send("Первый вопрос");
    // The third wait: the session is bound and open, and only its proof is in
    // flight. Attestation answers for the session it found bound, so a binding
    // that has been replaced reports `stale` and this adoption fails.
    await until(() => controller.getSnapshot().sessionId === stalled);

    await controller.switchTo("other");
    const liveKey = controller.getSnapshot().chatKey;
    releaseAttestation({
      ok: true,
      value: {
        sessionId: stalled,
        enabled: true,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxModeMatches: true,
        approvalIsNever: true,
        permissionPreset: "qa-read-only",
        toolPolicyLoaded: true,
        toolAllowList: [],
      },
    });
    expect(await sending).toBe(false);
    // The refused attempt names nothing of its own, and it may not take the name
    // from the chat that is on screen either: were the identity left naming no
    // session, the next chat this surface bootstraps would inherit the chat the
    // visitor is looking at.
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).not.toBe("other");
    expect(controller.getSnapshot().chatKey).not.toBe(liveKey);
    controller.dispose();
  });
});

/** Publish one session the Host had not listed yet, with a binding to match. */
function relist(world: QaSessionTestWorld, id: string): void {
  world.faces.set(id, sessionFace(id));
  world.bindings.set(id, conversationBinding(id));
  const snapshot = world.list.getSnapshot();
  world.list.set({
    ...snapshot,
    ids: [id as never, ...snapshot.ids],
    byId: {
      ...snapshot.byId,
      [id]: {
        id,
        displayTitle: id,
        running: false,
        blank: true,
        updatedAt: 2,
      },
    } as SessionListState["byId"],
  });
}

/**
 * Let the controller's async chain reach its next waiting point: one macrotask
 * per attempt, so every promise it parked in the meantime has settled.
 */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (predicate()) return;
  }
  throw new Error("the controller never reached that state");
}
