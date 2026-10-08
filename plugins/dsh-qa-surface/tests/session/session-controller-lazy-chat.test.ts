import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import type { QaAccountsFacade } from "../../src/client/QaSessionController.js";
import { harness } from "../helpers/session-fakes.js";

const CHATS_KEY = "dsh-qa-surface.session:v1:/qa:chats";
const SESSION_KEY = "dsh-qa-surface.session:v1:/qa:session";

function accountsFacade() {
  return {
    token: () => "t-1",
    ownedIds: () => [],
    messageAuthorOf: () => undefined,
    onSessionCreated: vi.fn(),
    onAuthRequired: vi.fn(),
  } satisfies QaAccountsFacade;
}

/** The chat ids this browser has indexed, read straight off its storage. */
function indexedIds(world: ReturnType<typeof harness>): readonly string[] {
  return JSON.parse(world.stored.get(CHATS_KEY) ?? "[]") as string[];
}

/**
 * What a chat is made of: a Host session, a reference that keeps it alive, an
 * ownership record on the stand and a row in this browser's history. A visit
 * that never sent a prompt used to pay for all four, so six rounds on one
 * account left six blank «Новый чат» lines and six live sessions behind.
 */
describe("QA session controller: a visit is not a chat", () => {
  it("spends nothing on a load that sends no prompt", async () => {
    for (const policy of ["browser-persistent", "new-on-load"] as const) {
      const world = harness();
      const accounts = accountsFacade();
      const controller = new QaSessionController({
        ...world,
        accounts,
        config: resolveConfig({ session: { policy } }),
      });
      await controller.ensureSession();
      expect(controller.getSnapshot()).toMatchObject({
        phase: "idle",
        sessionId: null,
        canSend: true,
      });
      expect(world.createSession).not.toHaveBeenCalled();
      expect(world.create).not.toHaveBeenCalled();
      expect(world.retain).not.toHaveBeenCalled();
      expect(accounts.onSessionCreated).not.toHaveBeenCalled();
      expect(world.stored.has(CHATS_KEY)).toBe(false);
      expect(world.stored.has(SESSION_KEY)).toBe(false);
      controller.dispose();
    }
  });

  it("leaves no row in the history over three visits, and one after the first prompt", async () => {
    const world = harness();
    const accounts = accountsFacade();
    for (let visit = 0; visit < 3; visit += 1) {
      const controller = new QaSessionController({
        ...world,
        accounts,
        config: resolveConfig(),
      });
      await controller.ensureSession();
      controller.dispose();
    }
    expect(world.createSession).not.toHaveBeenCalled();
    expect(accounts.onSessionCreated).not.toHaveBeenCalled();
    expect(indexedIds(world)).toEqual([]);

    const fourth = new QaSessionController({
      ...world,
      accounts,
      config: resolveConfig(),
    });
    await fourth.ensureSession();
    expect(await fourth.send("Первый вопрос")).toBe(true);
    expect(world.createSession).toHaveBeenCalledOnce();
    expect(accounts.onSessionCreated).toHaveBeenCalledOnce();
    expect(indexedIds(world)).toEqual(["created-1"]);
    fourth.dispose();
  });

  it("holds the question of a visitor who leaves before sending", async () => {
    // The composer of a draft is the whole of what the visit produced: leaving
    // and coming back must not have written a chat down on the way out.
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    await controller.startDraft();
    expect(controller.chatIds()).toEqual([]);
    expect(world.stored.has(CHATS_KEY)).toBe(false);
    controller.dispose();
  });
});
