import { describe, expect, it } from "vitest";
import { harness } from "./admin-service.helpers.js";

describe("quality metrics and audit", () => {
  it("aggregates ratings, subrole breakdown and issues", async () => {
    const { service, admin, reviewer, alice, bob } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
    });
    service.rateMessage(bob.token, "session-bob", "2", { rating: "positive" });
    service.saveReview(reviewer.token, {
      conversationId: "session-alice",
      messageId: "2",
      status: "reviewed",
      issues: ["answer.incorrect"],
      severity: "major",
    });
    const metrics = await service.metrics(admin.token);
    expect(metrics.conversations).toBe(2);
    expect(metrics.activeUsers).toBe(2);
    expect(metrics.assistantMessages).toBe(2);
    expect(metrics.ratedMessages).toBe(2);
    expect(metrics.positiveRatings).toBe(1);
    expect(metrics.negativeRatings).toBe(1);
    expect(metrics.positiveRate).toBe(0.5);
    expect(metrics.ratingRate).toBe(1);
    expect(metrics.unreviewedNegatives).toBe(0);
    expect(metrics.reviewedItems).toBe(1);
    expect(metrics.issues).toEqual([{ issue: "answer.incorrect", count: 1 }]);
    expect(metrics.bySubrole.map((row) => row.key)).toEqual([
      "analyst",
      "developer",
    ]);
    expect(metrics.trend).toHaveLength(1);
  });

  it("raises an overview alert for unanswered negative feedback", async () => {
    const { service, admin, alice } = harness();
    service.rateMessage(alice.token, "session-alice", "2", {
      rating: "negative",
      reasons: ["incorrect"],
    });
    const overview = await service.overview(admin.token);
    expect(overview.alerts.map((alert) => alert.code)).toContain(
      "unreviewed-negatives",
    );
    expect(overview.queue.length).toBeGreaterThan(0);
    expect(overview.recentFeedback[0]?.rating).toBe("negative");
  });

  it("merges capability-policy events into one audit timeline", async () => {
    const { service, admin, roles, alice } = harness();
    roles.updateCommon(admin.user.id, {
      tools: { always: ["read"], skillGrantable: [] },
      skills: [],
    });
    service.updateUser(admin.token, alice.user.id, { role: "reviewer" });
    const page = await service.audit(admin.token, {}, undefined, undefined);
    const actions = page.items.map((event) => event.action);
    expect(actions).toContain("common_capabilities.updated");
    expect(actions).toContain("authorization.changed");
    // Newest first.
    const newest = page.items[0]?.timestamp ?? "";
    const oldest = page.items.at(-1)?.timestamp ?? "";
    expect(newest >= oldest).toBe(true);
    const onlyRole = await service.audit(
      admin.token,
      { action: "authorization.changed" },
      undefined,
      undefined,
    );
    expect(onlyRole.total).toBe(1);
  });

  it("pages long lists with a cursor that survives new rows", async () => {
    const { service, admin } = harness();
    const first = await service.conversations(admin.token, {}, undefined, 1);
    expect(first.items).toHaveLength(1);
    expect(first.total).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.conversations(
      admin.token,
      {},
      first.nextCursor ?? undefined,
      1,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.conversationId).not.toBe(
      first.items[0]?.conversationId,
    );
    expect(second.nextCursor).toBeNull();
  });
});
