import { describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import {
  chatRootOf,
  visibleSubagentCandidates,
} from "../../src/client/lineage.js";
import { harness } from "../helpers/session-fakes.js";

const CHATS_KEY = "dsh-qa-surface.session:v1:/qa:chats";

/**
 * The accounts facade the controller reads ownership from. `ownedIds` is the
 * server's answer; everything else only has to exist.
 */
function facade(ownedIds: readonly string[]) {
  return {
    token: () => "t-1",
    ownedIds: () => ownedIds,
    messageAuthorOf: () => undefined,
    onSessionCreated: vi.fn(),
    onAuthRequired: vi.fn(),
  };
}

/**
 * One host-list row: an id plus whatever the case needs to say about it. Ids
 * are plain strings here — the branded `SessionId` a host list carries is what
 * the fixture casts to, not something a case has to spell.
 */
type ListedEntry = Omit<Partial<SessionSummary>, "id" | "parentId"> & {
  readonly id: string;
  readonly parentId?: string;
};

function listed(
  entries: readonly ListedEntry[],
): Record<string, SessionSummary> {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.id,
      {
        displayTitle: entry.id,
        running: false,
        blank: false,
        updatedAt: 1,
        ...entry,
      },
    ]),
  ) as unknown as Record<string, SessionSummary>;
}

describe("the chat list with accounts on", () => {
  it("lists the account's chats, never the chats this browser indexed beside them", () => {
    const world = harness(["s-authored"]);
    // A shared browser: the index still holds the chat the previous account
    // started on this machine.
    world.stored.set(CHATS_KEY, JSON.stringify(["s-authored", "s-foreign"]));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      accounts: facade(["s-authored"]),
    });
    expect(controller.chatIds()).toEqual(["s-authored"]);
    controller.dispose();
  });

  it("lists nothing while the account has claimed no chat yet", () => {
    const world = harness();
    world.stored.set(CHATS_KEY, JSON.stringify(["s-foreign"]));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      accounts: facade([]),
    });
    expect(controller.chatIds()).toEqual([]);
    controller.dispose();
  });

  it("keeps reading the browser index when the deployment has no accounts", () => {
    const world = harness();
    world.stored.set(CHATS_KEY, JSON.stringify(["s-1", "s-2"]));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    // Ownership is not a concept here: the index is the list, as before.
    expect(controller.chatIds()).toEqual(["s-1", "s-2"]);
    controller.dispose();
  });

  it("keeps an admin's opted-in cross-user view in the list", () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      // The admin facade merges the ownership map into the same list.
      accounts: facade(["s-mine", "s-theirs"]),
    });
    expect(controller.chatIds()).toEqual(["s-mine", "s-theirs"]);
    controller.dispose();
  });
});

describe("session lineage", () => {
  it("resolves a nested delegation to the chat it belongs to", () => {
    const byId = listed([
      { id: "chat" },
      { id: "child", parentId: "chat", origin: "subagent" },
      { id: "grandchild", parentId: "child", origin: "subagent" },
    ]);
    expect(chatRootOf(byId, "chat")).toBe("chat");
    expect(chatRootOf(byId, "child")).toBe("chat");
    expect(chatRootOf(byId, "grandchild")).toBe("chat");
  });

  it("stops at the last entry the host list still knows", () => {
    const byId = listed([
      { id: "orphan", parentId: "gone", origin: "subagent" },
    ]);
    expect(chatRootOf(byId, "orphan")).toBe("gone");
  });
});

describe("delegated names are the visible chats' own", () => {
  const byId = listed([
    { id: "s-mine" },
    { id: "s-theirs" },
    { id: "s-my-child", parentId: "s-mine", origin: "subagent" },
    { id: "s-their-child", parentId: "s-theirs", origin: "subagent" },
  ]);
  const catalogs = {
    "s-mine": {
      entries: [{ kind: "child", id: "s-my-child", label: "Счёт за март" }],
    },
    "s-theirs": {
      entries: [{ kind: "child", id: "s-their-child", label: "Чужой аудит" }],
    },
  };

  it("names only the children of the chats this page lists", () => {
    const candidates = visibleSubagentCandidates(
      byId,
      catalogs,
      new Set(["s-mine"]),
    );
    expect(candidates).toEqual([{ id: "s-my-child", label: "Счёт за март" }]);
  });

  it("names every chat's children when the deployment has no accounts", () => {
    const candidates = visibleSubagentCandidates(byId, catalogs, undefined);
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "s-my-child",
      "s-their-child",
    ]);
  });

  it("names a child the host listed without a catalog of its own", () => {
    const candidates = visibleSubagentCandidates(
      byId,
      {},
      new Set(["s-theirs"]),
    );
    expect(candidates).toEqual([
      { id: "s-their-child", label: "s-their-child" },
    ]);
  });
});
