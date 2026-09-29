import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { QA_SESSION_IDLE_STATE } from "../../src/client/types.js";
import { harness } from "../helpers/session-fakes.js";
import { until } from "../helpers/settle.js";

/**
 * A draft does not spend a session until its first prompt: the moment that chat
 * gets a session is also the moment its identity is decided, and a question the
 * Host never admitted has to stay in the composer that typed it.
 */
describe("QA session controller: the chat a first send belongs to", () => {
  it("keeps the chat identity across the session a draft creates on first send", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const draftKey = controller.getSnapshot().chatKey;

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
    // The draft's session is already bound while its proof is pending. This is
    // the moment the surface used to hand the composer a new key, which
    // discarded a question nothing had accepted yet.
    await until(() => controller.getSnapshot().sessionId === "created-2");
    expect(controller.getSnapshot()).toMatchObject({
      chatKey: draftKey,
      pendingMessage: { text: "Первый вопрос" },
    });

    releaseAttestation({
      ok: true,
      value: {
        sessionId: "created-2",
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
    expect(await sending).toBe(true);
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Первый вопрос" }],
      "queue",
    );
    expect(controller.getSnapshot().chatKey).toBe(draftKey);
    // A real move to another chat does change the identity: that composer must
    // not carry the previous conversation's text.
    await controller.switchTo("created-1");
    expect(controller.getSnapshot().chatKey).not.toBe(draftKey);
    controller.dispose();
  });

  it("never hands two chats the same identity, however often the surface rebuilds the controller", async () => {
    // The surface re-creates this controller whenever the account, the config
    // or the route changes, and reads `QA_SESSION_IDLE_STATE` while no
    // controller exists yet. Each of those snapshots has to be a chat of its
    // own: two of them sharing an identity is how one chat's unsent text and
    // staged attachments walked into the chat that took its place.
    const world = harness();
    const first = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await first.ensureSession();
    expect(first.getSnapshot().sessionId).toBe("created-1");
    const firstKey = first.getSnapshot().chatKey;
    expect(firstKey).not.toBe(QA_SESSION_IDLE_STATE.chatKey);
    first.dispose();

    const second = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await second.ensureSession();
    // The chat the first controller left behind, reopened by the second one.
    expect(second.getSnapshot().sessionId).toBe("created-1");
    expect(second.getSnapshot().chatKey).not.toBe(firstKey);
    second.dispose();
  });

  it("keeps a retried first send in the chat whose session never got a binding", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const draftKey = controller.getSnapshot().chatKey;

    // The Host created and listed the session, but its binding never appeared,
    // so bind() falls short of adopting it. The identity has to go on naming no
    // session: were it handed the session this attempt could not open, the
    // retry below — which creates a different id — would read as another chat
    // and rebuild the composer around the very question being retried.
    let unbound = "";
    world.createSession.mockImplementationOnce(async () => {
      unbound = String(await world.create());
      world.bindings.delete(unbound);
      return { ok: true as const, value: unbound };
    });
    expect(await controller.send("Первый вопрос")).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      chatKey: draftKey,
      sessionId: null,
      error: expect.stringMatching(/Не удалось начать чат/u),
    });

    expect(await controller.send("Первый вопрос")).toBe(true);
    // The draft's own chat, still the one the composer belongs to. The session
    // the retry brought back is the head of the list the harness publishes: a
    // fresh creation always goes in front, so no numbering is baked in here.
    expect(controller.getSnapshot().chatKey).toBe(draftKey);
    const retried = String(world.list.getSnapshot().ids[0]);
    expect(controller.getSnapshot().sessionId).toBe(retried);
    expect(world.faces.get(retried)?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Первый вопрос" }],
      "queue",
    );
    expect(world.faces.get(unbound)?.prompt).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps a retried first send in the chat whose session never opened", async () => {
    // The other half of a failed adoption: the Host listed the session and gave
    // its binding out, and only the open refused. Holding a session that never
    // opened is holding nothing — the identity must name no session and the
    // surface must not claim that chat id either.
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const draftKey = controller.getSnapshot().chatKey;
    let neverOpened = "";
    world.createSession.mockImplementationOnce(async () => {
      neverOpened = String(await world.create());
      const face = world.faces.get(neverOpened);
      face?.source.set({
        ...face.source.getSnapshot(),
        openState: "error",
      });
      return { ok: true as const, value: neverOpened };
    });

    expect(await controller.send("Первый вопрос")).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      chatKey: draftKey,
      sessionId: null,
      error: expect.stringMatching(/Не удалось начать чат/u),
    });

    expect(await controller.send("Первый вопрос")).toBe(true);
    // The retry's own session, taken from the head of the list the harness
    // publishes rather than from a number it happens to be on right now.
    const retried = String(world.list.getSnapshot().ids[0]);
    expect(controller.getSnapshot()).toMatchObject({
      chatKey: draftKey,
      sessionId: retried,
    });
    expect(world.faces.get(retried)?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Первый вопрос" }],
      "queue",
    );
    expect(world.faces.get(neverOpened)?.prompt).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps the chat whose fresh session was refused by policy attestation", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const draftKey = controller.getSnapshot().chatKey;
    world.secureSession.mockImplementationOnce(async () => ({
      ok: false as const,
      error: { code: "policy-unavailable" },
    }));

    // The refused session keeps its transcript for the caller that inspects it,
    // but it owns nothing: were the identity handed to it, the next session this
    // surface bound — another chat restored underneath the draft — would read as
    // a move between chats, and the composer would be rebuilt over the question
    // the stand has not admitted.
    expect(await controller.send("Первый вопрос")).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      chatKey: draftKey,
      error: expect.stringMatching(/Настройки помощника недоступны/u),
    });

    await controller.ensureSession();
    expect(controller.getSnapshot()).toMatchObject({
      chatKey: draftKey,
      sessionId: "created-1",
    });
    controller.dispose();
  });
});
