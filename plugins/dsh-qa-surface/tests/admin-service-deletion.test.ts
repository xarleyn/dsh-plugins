import { describe, expect, it } from "vitest";
import { fakeEraser, harness } from "./admin-service.helpers.js";

describe("administrative deletion", () => {
  it("removes the chat, its delegated sessions and everything kept about it", async () => {
    const dropped: string[] = [];
    const files = fakeEraser(["session-alice", "child-alice"]);
    const { service, accounts, quality, admin, alice } = harness({
      sessionFiles: files,
      droppedSources: dropped,
      extraSessions: [
        { id: "child-alice", createdAt: 2, parentSessionId: "session-alice" },
      ],
    });
    quality.rateFeedback(
      {
        conversationId: "session-alice",
        messageId: "2",
        userId: alice.user.id,
      },
      { rating: "negative", reasons: ["incorrect"] },
    );
    quality.enqueueReview(admin.user.id, "session-alice", "3");

    const result = await service.deleteConversation(
      admin.token,
      "session-alice",
    );

    // A subagent's session is part of the answer it ran inside, so the chat
    // does not leave its children behind.
    expect(files.calls).toEqual([["session-alice", "child-alice"]]);
    expect(result).toEqual({
      conversationId: "session-alice",
      sessions: ["session-alice", "child-alice"],
      qualityRows: 2,
    });
    expect(accounts.ownedSessionIds(alice.token)).toEqual([]);
    expect(quality.allFeedback()).toEqual([]);
    expect(quality.manualQueue()).toEqual([]);
    expect(dropped).toEqual(["session-alice", "child-alice"]);
    const audit = quality.auditEvents();
    expect(audit.map((event) => event.action)).toContain(
      "conversation.deleted",
    );
    expect(audit.at(-1)?.targetId).toBe("session-alice");
  });

  it("drops the records of a chat whose log is already gone", async () => {
    // The listing no longer knows it, but the ownership record does — exactly
    // the row the console still shows for a chat deleted outside the surface.
    const files = fakeEraser([]);
    const { service, accounts, admin, alice } = harness({
      sessionFiles: files,
    });
    accounts.reserveSession(alice.token, "session-vanished", {
      subroleId: "analyst",
    });

    const result = await service.deleteConversation(
      admin.token,
      "session-vanished",
    );

    expect(result.sessions).toEqual([]);
    expect(accounts.ownerIdOf("session-vanished")).toBeUndefined();
    // The chat the fixture still has keeps its owner.
    expect(accounts.ownedSessionIds(alice.token)).toEqual(["session-alice"]);
  });

  it("refuses a reviewer: deleting a conversation is the administrator's", async () => {
    const files = fakeEraser(["session-alice"]);
    const { service, accounts, reviewer, alice } = harness({
      sessionFiles: files,
    });

    await expect(
      service.deleteConversation(reviewer.token, "session-alice"),
    ).rejects.toMatchObject({ reason: "forbidden" });
    expect(files.calls).toEqual([]);
    expect(accounts.ownedSessionIds(alice.token)).toEqual(["session-alice"]);
  });

  it("refuses a conversation the Harness still holds open", async () => {
    // A live session is still being written: storage removal would be undone
    // by the next flush, so nothing is touched.
    const files = fakeEraser(["session-alice"]);
    const { service, accounts, admin, alice } = harness({
      sessionFiles: files,
      held: ["session-alice"],
    });

    await expect(
      service.deleteConversation(admin.token, "session-alice"),
    ).rejects.toMatchObject({ reason: "conversation-live" });
    expect(files.calls).toEqual([]);
    expect(accounts.ownedSessionIds(alice.token)).toEqual(["session-alice"]);
  });

  it("refuses when storage keeps the conversation somewhere directories do not", async () => {
    const files = fakeEraser([]);
    const { service, accounts, admin, alice } = harness({
      sessionFiles: files,
    });

    await expect(
      service.deleteConversation(admin.token, "session-alice"),
    ).rejects.toMatchObject({ reason: "conversation-not-removable" });
    // A refusal never half-deletes: the record is still the chat's.
    expect(accounts.ownedSessionIds(alice.token)).toEqual(["session-alice"]);
  });

  it("refuses a conversation the deployment never had", async () => {
    const files = fakeEraser([]);
    const { service, admin } = harness({ sessionFiles: files });

    await expect(
      service.deleteConversation(admin.token, "session-ghost"),
    ).rejects.toMatchObject({ reason: "conversation-unknown" });
    expect(files.calls).toEqual([]);
  });

  it("refuses when the deployment serves no removal at all", async () => {
    const { service, admin } = harness();

    await expect(
      service.deleteConversation(admin.token, "session-alice"),
    ).rejects.toMatchObject({ reason: "conversation-not-removable" });
  });
});
