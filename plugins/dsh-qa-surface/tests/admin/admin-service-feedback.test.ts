import { describe, expect, it } from "vitest";
import { harness } from "./admin-service.helpers.js";

describe("feedback and reviews", () => {
  it("records a rating on the owner's own message and updates it in place", async () => {
    const { service, alice, quality } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
      comment: "wrong project",
    });
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "positive",
    });
    expect(quality.allFeedback()).toHaveLength(1);
    expect(quality.allFeedback()[0]?.rating).toBe("positive");
  });

  it("refuses to rate someone else's answer", async () => {
    const { service, bob } = harness();
    expect(() =>
      service.rateMessage(bob.token, "session-alice", "2", {
        rating: "negative",
      }),
    ).toThrow(/only be given on your own conversations/u);
  });

  it("surfaces negative feedback in the review queue, answered by a review", async () => {
    const { service, admin, reviewer, alice } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
    });
    const queue = await service.reviewQueue(admin.token, undefined, undefined);
    const item = queue.items.find(
      (row) =>
        row.conversationId === "session-alice" &&
        row.reason === "negative_feedback",
    );
    expect(item?.priority).toBe("high");
    expect(item?.displayName).toBe("alice");
    expect(item?.status).toBe("unreviewed");

    const review = service.saveReview(reviewer.token, {
      conversationId: "session-alice",
      messageId: "2",
      status: "reviewed",
      issues: ["answer.incorrect", "context.missing_knowledge"],
      severity: "major",
      notes: "knowledge gap",
      target: "knowledge",
      suggestedAction: "add the release process",
    });
    expect(review.reviewerId).toBe(reviewer.user.id);
    const after = await service.reviewQueue(admin.token, undefined, undefined);
    expect(
      after.items.find(
        (row) =>
          row.conversationId === "session-alice" &&
          row.reason === "negative_feedback",
      )?.status,
    ).toBe("reviewed");
  });

  it("keeps a needs-followup review in the queue and audits the verdict", async () => {
    const { service, reviewer, quality, admin } = harness();
    service.saveReview(reviewer.token, {
      conversationId: "session-alice",
      status: "needs_followup",
      issues: ["tool.failure"],
      severity: "minor",
    });
    const queue = await service.reviewQueue(admin.token, undefined, undefined);
    expect(
      queue.items.some(
        (row) =>
          row.conversationId === "session-alice" &&
          row.reason === "manual" &&
          row.status === "needs_followup",
      ),
    ).toBe(true);
    expect(quality.auditEvents().map((event) => event.action)).toContain(
      "conversation.reviewed",
    );
  });

  it("pages the feedback table and filters it", async () => {
    const { service, admin, alice, bob } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["missing_information"],
    });
    service.rateMessage(bob.token, "session-bob", "2", { rating: "positive" });
    const all = await service.feedback(admin.token, {}, undefined, undefined);
    expect(all.total).toBe(2);
    expect(all.items[0]?.conversationTitle).toBeDefined();
    const negatives = await service.feedback(
      admin.token,
      { rating: "negative" },
      undefined,
      undefined,
    );
    expect(negatives.items).toHaveLength(1);
    expect(negatives.items[0]?.displayName).toBe("alice");
    expect(
      (
        await service.feedback(
          admin.token,
          { reason: "missing_information" },
          undefined,
          undefined,
        )
      ).total,
    ).toBe(1);
    const first = await service.feedback(admin.token, {}, undefined, 1);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.feedback(
      admin.token,
      {},
      first.nextCursor ?? undefined,
      1,
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});
