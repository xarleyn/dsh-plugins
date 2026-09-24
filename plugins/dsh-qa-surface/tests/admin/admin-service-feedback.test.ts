import { describe, expect, it } from "vitest";
import { harness } from "./admin-service.helpers.js";
import type { QaFeedbackHarvestEntry } from "../../src/types.js";

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

describe("feedback harvest", () => {
  it("recovers a rating that never reached the Host into the reviewer's list", async () => {
    const { service, admin, alice, quality } = harness();
    expect(
      service.harvestFeedback(alice.token, [
        { conversationId: "session-alice", messageId: "2", rating: "negative" },
      ]),
    ).toEqual({ recorded: 1, present: 0, rejected: 0 });
    expect(quality.allFeedback()[0]?.userId).toBe(alice.user.id);
    const page = await service.feedback(admin.token, {}, undefined, undefined);
    expect(page.items.map((row) => row.displayName)).toEqual(["alice"]);
    const queue = await service.reviewQueue(admin.token, undefined, undefined);
    expect(
      queue.items.find(
        (row) =>
          row.conversationId === "session-alice" &&
          row.reason === "negative_feedback",
      ),
    ).toBeDefined();
  });

  it("replays once: a second pass records nothing", async () => {
    const { service, alice, quality } = harness();
    const entry = {
      conversationId: "session-alice",
      messageId: "2",
      rating: "positive" as const,
    };
    service.harvestFeedback(alice.token, [entry]);
    expect(service.harvestFeedback(alice.token, [entry])).toEqual({
      recorded: 0,
      present: 1,
      rejected: 0,
    });
    expect(quality.allFeedback()).toHaveLength(1);
  });

  it("never rewrites a rating the Host already holds, reasons included", async () => {
    const { service, alice, quality } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
      comment: "wrong project",
    });
    expect(
      service.harvestFeedback(alice.token, [
        { conversationId: "session-alice", messageId: "2", rating: "positive" },
      ]),
    ).toEqual({ recorded: 0, present: 1, rejected: 0 });
    const [record] = quality.allFeedback();
    expect(record?.rating).toBe("negative");
    expect(record?.reasons).toEqual(["incorrect"]);
    expect(record?.comment).toBe("wrong project");
    expect(record?.updatedAt).toBeUndefined();
  });

  it("refuses a foreign chat without losing the rest of the batch", async () => {
    const { service, alice, bob, quality } = harness();
    expect(
      service.harvestFeedback(bob.token, [
        {
          conversationId: "session-alice",
          messageId: "2",
          rating: "negative",
        },
        {
          conversationId: "session-bob",
          messageId: "2",
          rating: "negative",
        },
        // A row with nothing to file it under, one the store itself refuses,
        // and a verdict no browser sends: none may lose the rest of the batch.
        { conversationId: "session-bob", messageId: "", rating: "positive" },
        {
          conversationId: "session-bob",
          messageId: "9".repeat(300),
          rating: "positive",
        },
        { conversationId: "session-bob", messageId: "4", rating: "sideways" },
      ] as unknown as readonly QaFeedbackHarvestEntry[]),
    ).toEqual({ recorded: 1, present: 0, rejected: 4 });
    expect(quality.allFeedback().map((row) => row.userId)).toEqual([
      bob.user.id,
    ]);
    expect(alice.user.id).not.toBe(bob.user.id);
  });

  it("refuses a batch no browser sends rather than applying half of it", async () => {
    const { service, alice, quality } = harness();
    const entries = Array.from(
      { length: 501 },
      (_unused, index): QaFeedbackHarvestEntry => ({
        conversationId: "session-alice",
        messageId: String(index),
        rating: "positive",
      }),
    );
    expect(() => service.harvestFeedback(alice.token, entries)).toThrow(
      /harvest batch is too large/u,
    );
    expect(quality.allFeedback()).toHaveLength(0);
  });
});
