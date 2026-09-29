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
import { until } from "../helpers/settle.js";

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
    // The reference this adoption retained while it looked for its session came
    // back: a Host session counted against by a chat nobody is in stays bound
    // forever, and nothing else in the page will ever let it go.
    const orphaned = world.references.filter((ref) => ref.sessionId === late);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]?.release).toHaveBeenCalledOnce();
    // The chat on screen keeps the reference it holds.
    const live = world.references.filter((ref) => ref.sessionId === "other");
    expect(live).toHaveLength(1);
    expect(live[0]?.release).not.toHaveBeenCalled();
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
    await controller.ensureSession();
    // The newest creation is the head of the list the harness publishes, so this
    // says "the chat bootstrap opened a session of its own" without naming it.
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: String(world.list.getSnapshot().ids[0]),
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
    let stalled = "";
    let releaseAttestation!: (
      value: Awaited<ReturnType<typeof world.secureSession>>,
    ) => void;
    world.createSession.mockImplementationOnce(async () => {
      stalled = String(await world.create());
      return { ok: true as const, value: stalled };
    });
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

  it("attests nothing on behalf of the adoption the visitor left behind", async () => {
    // The proof of policy is the last wait an adoption takes, and it is not a
    // read-only one: it asks about the session the controller holds, and writes
    // that answer back as whether the chat may send and what error stands over
    // the composer. An adoption that is no longer the one on screen has to leave
    // all of it to the chat that replaced it.
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

    // Parked in the wait for its session to open, subscriptions already taken:
    // the only step left when that session arrives is the attestation.
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
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "other",
      canSend: true,
    });
    // From here the only proof this page needs is the live chat's own.
    world.secureSession.mockClear();

    // The abandoned session takes as long as it likes to open.
    const stalledFace = world.faces.get(stalled);
    stalledFace?.source.set({
      ...stalledFace.source.getSnapshot(),
      openState: "open",
    });
    expect(await sending).toBe(false);
    expect(world.secureSession).not.toHaveBeenCalled();
    const liveKey = controller.getSnapshot().chatKey;
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
    expect(world.faces.get(stalled)?.prompt).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps the draft sendable when a role change retires the binding mid-wait", async () => {
    // The one departure between chats that used to leave the generation alone is
    // the draft: "Новый чат" and a role change retire the binding and hand the
    // screen to nothing. A first send parked in its waits measured itself against
    // the generation only, so it resumed as the owner of a chat it no longer was,
    // and the send that asked for it reported a materialized draft that had never
    // been adopted — after which every question in that draft was answered with
    // "chat not open" for as long as the page lived.
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

    // Parked past the binding, in the wait for the session to open.
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

    // Leaving the admin preview is a role change, and a role change is a draft.
    await controller.selectSubrole("role-b");
    const draft = controller.getSnapshot();
    expect(draft).toMatchObject({ sessionId: null, canSend: true });

    const abandoned = world.references.filter(
      (ref) => ref.sessionId === stalled,
    );
    expect(abandoned).toHaveLength(1);
    // From here the draft has no session, so the only proof this page needs is
    // the one its own next question pays for.
    world.secureSession.mockClear();

    // The session the abandoned chat was waiting for opens. It proves nothing:
    // the step back has to be visible to the send that asked for it.
    const stalledFace = world.faces.get(stalled);
    stalledFace?.source.set({
      ...stalledFace.source.getSnapshot(),
      openState: "open",
    });
    expect(await sending).toBe(false);
    expect(world.secureSession).not.toHaveBeenCalled();
    expect(abandoned[0]?.release).toHaveBeenCalledOnce();
    // The draft the role change started is the chat on screen still: same
    // identity, no session, and sendable.
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: null,
      chatKey: draft.chatKey,
      canSend: true,
      error: null,
    });

    // And its next question is delivered — into the role the visitor switched to,
    // not into the session the abandoned question had been waiting for.
    expect(await controller.send("Второй вопрос")).toBe(true);
    expect(world.createSession.mock.calls.at(-1)?.[1]).toBe("role-b");
    const reopened = controller.getSnapshot().sessionId;
    expect(reopened).not.toBeNull();
    expect(reopened).not.toBe(stalled);
    expect(world.faces.get(String(reopened))?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Второй вопрос" }],
      "queue",
    );
    expect(world.faces.get(stalled)?.prompt).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps a draft a given-up-on question cannot take over", async () => {
    // The other half of the same departure: an adoption parked while it is still
    // looking for its session has taken nothing, so nothing about the binding
    // tells it the screen moved. Only the generation does, and the draft is the
    // path that used to leave it untouched — arriving late, that question would
    // bind its session under the identity of the draft the visitor had just
    // started, and list a chat nobody asked for.
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

    const late = "not-listed-yet";
    world.createSession.mockImplementationOnce(async () => ({
      ok: true as const,
      value: late,
    }));
    const sending = controller.send("Первый вопрос");
    await until(() =>
      world.retain.mock.calls.some(([id]) => String(id) === late),
    );

    // The header's "Новый чат", taken while that question is still looking.
    await controller.startDraft();
    const draft = controller.getSnapshot();

    relist(world, late);
    expect(await sending).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: null,
      chatKey: draft.chatKey,
      canSend: true,
      error: null,
    });
    // It never became a chat of this browser, and the reference it retained
    // while looking for the binding came back.
    expect(controller.chatIds()).not.toContain(late);
    const orphaned = world.references.filter((ref) => ref.sessionId === late);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]?.release).toHaveBeenCalledOnce();

    // The draft is still a draft, and its question rides a session of its own.
    expect(await controller.send("Второй вопрос")).toBe(true);
    const opened = controller.getSnapshot().sessionId;
    expect(opened).not.toBeNull();
    expect(opened).not.toBe(late);
    expect(world.faces.get(String(opened))?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Второй вопрос" }],
      "queue",
    );
    expect(world.faces.get(late)?.prompt).not.toHaveBeenCalled();
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
