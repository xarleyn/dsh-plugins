import { describe, expect, it, vi } from "vitest";
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
    // The adoption asks the Host for a reference to its session as soon as the
    // create answers, which is the hand-off into the wait this test is about:
    // the switch below has to land while the adoption is still parked in it.
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
    // The Host will not hand out a reference to a Session its catalog has not
    // listed, so an adoption parked in that wait holds nothing to give back: the
    // late arrival finds no reference of this adoption's still counting against a
    // Session nobody is in. (A bind that got its reference and then lost the
    // screen is the case below, where the reference does have to come back.)
    const orphaned = world.references.filter((ref) => ref.sessionId === late);
    expect(orphaned).toHaveLength(0);
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
    const createdBefore = world.createSession.mock.calls.length;
    await controller.ensureSession();
    // A page that starts over under this policy takes a draft of its own, with
    // its own identity, and spends no session on it.
    expect(controller.getSnapshot()).toMatchObject({ sessionId: null });
    expect(world.createSession.mock.calls.length).toBe(createdBefore);
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
    // It never became a chat of this browser, and it never got a reference to
    // give back either: the Host refuses one until its catalog lists the Session.
    expect(controller.chatIds()).not.toContain(late);
    const orphaned = world.references.filter((ref) => ref.sessionId === late);
    expect(orphaned).toHaveLength(0);

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

  it("leaves nothing of its own behind when a bootstrap it cannot wait for takes the screen", async () => {
    // Past the binding an adoption has installed a chat of its own: the retained
    // reference, and the three subscriptions that answer every frame of that
    // session with a publish. The hand that takes the screen here is the
    // bootstrap, which raises the generation while deliberately keeping whatever
    // transcript is on screen until its own session exists — so it retires
    // nothing. If that bootstrap then fails, nothing ever unbinds this adoption:
    // it would go on holding a Host session nobody is in, and each frame of that
    // abandoned chat would clear the error the stand published.
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
      // The bootstrap this test needs is one that never gets as far as a
      // session: a load that only drafts takes the screen without touching
      // anything, and there is no install left behind to take back.
      timeoutMs: 5,
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
    // Past the binding and inside the proof: the session is installed, so this is
    // the abandonment that has something of its own to take back.
    await until(() =>
      world.secureSession.mock.calls.some(([, id]) => String(id) === stalled),
    );

    // The surface re-boots — another account, configuration or route — and the
    // Host stops answering the session list this bootstrap waits for.
    world.list.set({ ...world.list.getSnapshot(), phase: "pending" });
    const bootstrapping = controller.ensureSession();
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
    await bootstrapping;

    expect(controller.getSnapshot()).toMatchObject({
      sessionId: null,
      error: expect.stringMatching(/Не удалось начать чат/u),
    });
    // The proof came back saying the session was fine, and it still owns nothing:
    // the reference it retained is back with the Host.
    const abandoned = world.references.filter(
      (ref) => ref.sessionId === stalled,
    );
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.release).toHaveBeenCalledOnce();

    // And its subscriptions went with it: a frame of the abandoned chat reaches
    // nobody, so the reason the stand gave stays over the composer instead of
    // being wiped by a chat the visitor is not in.
    const published = vi.fn();
    controller.subscribe(published);
    const stalledFace = world.faces.get(stalled);
    stalledFace?.source.set({
      ...stalledFace.source.getSnapshot(),
      running: true,
    });
    expect(published).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toMatch(/Не удалось начать чат/u);
    controller.dispose();
  });

  it("leaves no binding behind when a subagent view is left on screen too", async () => {
    // The same abandonment one wait earlier, on the only caller that asks for no
    // attestation: a transcript the visitor opened and then walked away from.
    // The session opens late, after the bootstrap has taken the screen and
    // failed, and this is the last wait that adoption passes — so it is the only
    // place its own install can still be taken back.
    const world = harness(["sub-1"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        // The bootstrap this test needs to fail is one that has a session to
        // open and cannot: a load that drafts has nothing to spend and nothing
        // to refuse.
        session: { policy: "fixed", fixedSessionId: "gone" },
      }),
    });
    const subagent = world.faces.get("sub-1");
    subagent?.source.set({
      ...subagent.source.getSnapshot(),
      openState: "opening",
    });
    const viewing = controller.viewSubagent("sub-1", "Транскрипт субагента");
    await until(
      () => (world.bindings.get("sub-1")?.target.mock.calls.length ?? 0) > 0,
    );

    const bootstrapping = controller.ensureSession();

    // The transcript the visitor already left arrives, and proves nothing about
    // the screen it would have taken over.
    subagent?.source.set({
      ...subagent.source.getSnapshot(),
      openState: "open",
    });
    await viewing;
    await bootstrapping;

    expect(controller.getSnapshot()).toMatchObject({
      sessionId: null,
      error: expect.stringMatching(/Не удалось начать чат/u),
    });
    const abandoned = world.references.filter(
      (ref) => ref.sessionId === "sub-1",
    );
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.release).toHaveBeenCalledOnce();
    // A chat this browser never asked for was not added to its list either.
    expect(controller.chatIds()).not.toContain("sub-1");
    controller.dispose();
  });

  it("keeps the chat a switch opened during the stop of a running turn", async () => {
    // Entering a draft stops the turn that is running first, and that is a
    // round-trip — the one wait between chats that lets another chat be opened
    // underneath it. The draft was asked for before the click that opened this
    // one, so it has to give the screen back rather than resume as its owner:
    // unbinding a session that had just been adopted leaves a visitor looking at
    // an empty chat they never chose, whose every question then goes nowhere.
    const world = harness(["saved", "other"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    const open = controller.getSnapshot().sessionId;
    expect(open).toBe("saved");
    const openFace = world.faces.get(String(open));
    openFace?.source.set({
      ...openFace.source.getSnapshot(),
      running: true,
    });
    let releaseCancel!: () => void;
    openFace?.cancel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCancel = () =>
            resolve({ ok: true as const, value: { accepted: true as const } });
        }),
    );

    const drafting = controller.startDraft();
    await until(() => (openFace?.cancel.mock.calls.length ?? 0) > 0);

    // The visitor changes their mind mid-round-trip and opens another chat.
    await controller.switchTo("other");
    const liveKey = controller.getSnapshot().chatKey;
    releaseCancel();
    await drafting;

    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "other",
      chatKey: liveKey,
      canSend: true,
      error: null,
    });
    // The chat that won the screen is still a chat the next question rides.
    expect(await controller.send("Второй вопрос")).toBe(true);
    expect(world.faces.get("other")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Второй вопрос" }],
      "queue",
    );
    controller.dispose();
  });

  it("does not persist as the open chat the one a switch gave up on", async () => {
    // Opening a chat writes it as the conversation this browser reopens on the
    // next load. An adoption that stepped back never put its chat on screen, so
    // writing its id would bring back, on the next load, a chat the visitor was
    // never shown and never chose — under a draft they were.
    const world = harness(["other"]);
    const activeKey = "dsh-qa-surface.session:v1:/qa:session";
    const late = "binding-late";
    const listed = world.list.getSnapshot();
    world.list.set({
      ...listed,
      ids: [late as never, ...listed.ids],
      byId: {
        ...listed.byId,
        [late]: {
          id: late,
          displayTitle: late,
          running: false,
          blank: true,
          updatedAt: 2,
        },
      } as SessionListState["byId"],
    } as SessionListState);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: { policy: "new-on-load" },
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();

    // The Host names this chat in its list but has not handed out its binding
    // yet, so the switch waits for that reference to become ready. This wait is
    // the one the test leaves behind, so the reference is the switch's own.
    let showBinding!: () => void;
    world.retain.mockImplementationOnce((id: unknown) => {
      const reference = {
        sessionId: String(id),
        ready: new Promise((resolve) => {
          showBinding = () => resolve({});
        }),
        release: vi.fn(),
      };
      world.references.push(reference);
      return reference;
    });

    const switching = controller.switchTo(late);
    await until(() =>
      world.retain.mock.calls.some(([id]) => String(id) === late),
    );
    // The switch is parked with its reference still held: a binding that arrives
    // after this point is what the abandonment has to be measured against, not a
    // lookup that failed while the chat was still on screen.
    expect(world.references.at(-1)?.release).not.toHaveBeenCalled();

    // The visitor changes their mind and asks for a new chat instead.
    await controller.startDraft();
    const draft = controller.getSnapshot();

    // The binding the switch was waiting for arrives, to a screen it no longer
    // owns.
    world.faces.set(late, sessionFace(late));
    world.bindings.set(late, conversationBinding(late));
    showBinding();
    await switching;

    // Nothing of the given-up-on chat reached browser storage, and nothing of it
    // was kept at the Host either.
    expect(world.stored.has(activeKey)).toBe(false);
    expect(controller.chatIds()).not.toContain(late);
    const abandoned = world.references.filter((ref) => ref.sessionId === late);
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.release).toHaveBeenCalledOnce();
    // The draft the visitor asked for is still the chat on screen.
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: null,
      chatKey: draft.chatKey,
      canSend: true,
      error: null,
    });

    // A switch that does finish is written down — otherwise the assertion above
    // would only prove that this harness never persists anything.
    await controller.switchTo("other");
    expect(world.stored.get(activeKey)).toBe("other");
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
