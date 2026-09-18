import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { QaQualityStore } from "../src/admin/quality-store.js";
import type { QaMessageFeedback } from "../src/types.js";
import { openStore, tempFile } from "./admin-records.helpers.js";
describe("quality store", () => {
  it("keeps one rating per user and message, replacing it on re-rating", () => {
    const store = openStore(tempFile());
    const first = store.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u1" },
      { rating: "negative", reasons: ["incorrect"], comment: "wrong project" },
    );
    const second = store.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u1" },
      { rating: "positive" },
    );
    expect(store.allFeedback()).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.rating).toBe("positive");
    expect(second.reasons).toBeUndefined();
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeDefined();
  });

  it("keeps each user's own verdict on the same message", () => {
    const store = openStore(tempFile());
    store.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u1" },
      { rating: "positive" },
    );
    store.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u2" },
      { rating: "negative", reasons: ["tool_issue"] },
    );
    expect(store.allFeedback()).toHaveLength(2);
    expect(store.feedbackOf("c1", "4", "u2")?.rating).toBe("negative");
  });

  it("refuses an unknown rating, reason or empty identifier", () => {
    const store = openStore(tempFile());
    expect(() =>
      store.rateFeedback(
        { conversationId: "c1", messageId: "4", userId: "u1" },
        { rating: "maybe" as never },
      ),
    ).toThrow(/rating must be one of/u);
    expect(() =>
      store.rateFeedback(
        { conversationId: "c1", messageId: "4", userId: "u1" },
        { rating: "negative", reasons: ["made-up" as never] },
      ),
    ).toThrow(/reasons must be one of/u);
    expect(() =>
      store.rateFeedback(
        { conversationId: "", messageId: "4", userId: "u1" },
        { rating: "positive" },
      ),
    ).toThrow(/conversationId must not be empty/u);
  });

  it("replaces one reviewer's verdict and records a first-seen timestamp", () => {
    const store = openStore(tempFile());
    const first = store.saveReview("r1", {
      conversationId: "c1",
      status: "needs_followup",
      issues: ["answer.incorrect"],
      severity: "major",
    });
    const second = store.saveReview("r1", {
      conversationId: "c1",
      status: "reviewed",
      issues: ["answer.incorrect", "tool.failure"],
      severity: "minor",
      notes: "fixed by the new skill",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(store.allReviews()).toHaveLength(1);
    expect(second.review.status).toBe("reviewed");
    expect(second.review.issues).toEqual(["answer.incorrect", "tool.failure"]);
    expect(second.review.createdAt).toBe(first.review.createdAt);
  });

  it("parks a conversation once and drops it on dequeue", () => {
    const store = openStore(tempFile());
    store.enqueueReview("r1", "c1", "4");
    store.enqueueReview("r1", "c1", "4");
    expect(store.manualQueue()).toHaveLength(1);
    expect(store.dequeueReview("c1", "4")).toBe(true);
    expect(store.dequeueReview("c1", "4")).toBe(false);
    expect(store.manualQueue()).toHaveLength(0);
  });

  it("persists records and reads them back in a second store instance", () => {
    const file = tempFile();
    const first = openStore(file);
    first.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u1" },
      {
        rating: "negative",
        reasons: ["missing_information"],
        comment: "no facts",
      },
    );
    first.saveReview("r1", {
      conversationId: "c1",
      status: "reviewed",
      issues: ["context.missing_knowledge"],
      severity: "critical",
      notes: "knowledge gap",
      target: "knowledge",
      suggestedAction: "add the release process",
    });
    first.appendAudit({
      actorId: "admin",
      action: "user.disabled",
      targetType: "user",
      targetId: "u2",
    });

    const second = openStore(file);
    const feedback = second.allFeedback()[0] as QaMessageFeedback;
    expect(feedback.reasons).toEqual(["missing_information"]);
    expect(feedback.comment).toBe("no facts");
    const review = second.allReviews()[0];
    expect(review?.target).toBe("knowledge");
    expect(review?.suggestedAction).toBe("add the release process");
    expect(second.auditEvents()).toHaveLength(1);
  });

  it("refuses to start on a record carrying an unusable row", () => {
    const file = tempFile();
    const store = openStore(file);
    store.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u1" },
      { rating: "positive" },
    );
    store.close();
    // Every write is validated, so an unusable record means a hand-edited or
    // corrupted database: the console reports it instead of silently dropping
    // a person's verdict.
    const db = new DatabaseSync(file);
    db.prepare(
      "INSERT INTO quality_rows (kind, key, seq, json) VALUES (?, ?, ?, ?)",
    ).run(
      "feedback",
      "broken",
      99,
      JSON.stringify({
        id: "broken",
        conversationId: "c1",
        messageId: "4",
        userId: "u9",
        rating: "sideways",
        createdAt: "2026-09-15T00:00:00.000Z",
      }),
    );
    db.close();

    expect(() => new QaQualityStore(file)).toThrow(/rating must be one of/u);
  });

  it("bounds a before/after snapshot it cannot store", () => {
    const store = openStore(tempFile());
    const event = store.appendAudit({
      actorId: "admin",
      action: "user.updated",
      targetType: "user",
      targetId: "u1",
      after: { value: "x".repeat(40_000) },
    });
    expect(event.after).toBe('{"truncated":true}');
  });
});

describe("dropping the records of a deleted conversation", () => {
  /** One conversation of every kind the sweep is expected to take with it. */
  function seed(store: QaQualityStore): void {
    store.rateFeedback(
      { conversationId: "c-gone", messageId: "4", userId: "u1" },
      { rating: "negative", reasons: ["incorrect"] },
    );
    store.rateFeedback(
      { conversationId: "c-kept", messageId: "4", userId: "u1" },
      { rating: "positive" },
    );
    store.saveReview("r1", {
      conversationId: "c-gone",
      status: "reviewed",
      issues: [],
      severity: "minor",
    });
    store.saveReview("r1", {
      conversationId: "c-kept",
      status: "reviewed",
      issues: [],
      severity: "minor",
    });
    store.enqueueReview("r1", "c-gone", "4");
    store.appendAudit({
      actorId: "admin",
      action: "conversation.reviewed",
      targetType: "conversation",
      targetId: "c-gone",
    });
  }

  it("takes feedback, reviews and queue entries, and leaves the rest", () => {
    const store = openStore(tempFile());
    seed(store);

    expect(store.dropConversations(["c-gone"])).toBe(3);

    expect(store.allFeedback().map((row) => row.conversationId)).toEqual([
      "c-kept",
    ]);
    expect(store.allReviews().map((row) => row.conversationId)).toEqual([
      "c-kept",
    ]);
    expect(store.manualQueue()).toEqual([]);
    // The audit trail names conversations but records what people did; it is
    // not the conversation's to be dropped with.
    expect(store.auditEvents()).toHaveLength(1);
  });

  it("survives a reopen — the rows are gone from the database, not a cache", () => {
    const file = tempFile();
    const store = openStore(file);
    seed(store);
    store.dropConversations(["c-gone", "c-kept"]);
    store.close();

    const reopened = openStore(file);

    expect(reopened.allFeedback()).toEqual([]);
    expect(reopened.allReviews()).toEqual([]);
    expect(reopened.auditEvents()).toHaveLength(1);
  });

  it("changes nothing when nothing matches", () => {
    const store = openStore(tempFile());
    seed(store);

    expect(store.dropConversations([])).toBe(0);
    expect(store.dropConversations(["c-other"])).toBe(0);
    expect(store.allFeedback()).toHaveLength(2);
  });
});
