import { describe, expect, it } from "vitest";
import { aggregateQuality } from "../../src/admin/metrics.js";
import { deriveQueue } from "../../src/admin/queue.js";
import {
  staticSessionLogReader,
  type QaStoredSessionHeader,
} from "../../src/admin/session-log.js";
import type { QaMessageFeedback } from "../../src/types.js";
describe("review queue and aggregation", () => {
  const feedback: readonly QaMessageFeedback[] = [
    {
      id: "f1",
      conversationId: "c1",
      messageId: "4",
      userId: "u1",
      rating: "negative",
      reasons: ["incorrect"],
      createdAt: "2026-09-15T10:00:00.000Z",
    },
    {
      id: "f2",
      conversationId: "c2",
      messageId: "9",
      userId: "u1",
      rating: "negative",
      reasons: ["too_verbose"],
      createdAt: "2026-09-15T11:00:00.000Z",
    },
    {
      id: "f3",
      conversationId: "c2",
      messageId: "10",
      userId: "u2",
      rating: "positive",
      createdAt: "2026-09-15T12:00:00.000Z",
    },
  ];

  it("raises a rated-down answer at high priority when the reason says so", () => {
    const queue = deriveQueue({ feedback, reviews: [], manual: [] });
    expect(queue.map((item) => [item.feedbackId, item.priority])).toEqual([
      ["f1", "high"],
      ["f2", "normal"],
    ]);
  });

  it("takes an item out of the queue once a review answers it", () => {
    const queue = deriveQueue({
      feedback,
      reviews: [
        {
          id: "r1",
          conversationId: "c1",
          messageId: "4",
          reviewerId: "rev",
          status: "reviewed",
          issues: ["answer.incorrect"],
          severity: "major",
          createdAt: "2026-09-15T13:00:00.000Z",
        },
      ],
      manual: [],
    });
    expect(queue.find((item) => item.feedbackId === "f1")?.status).toBe(
      "reviewed",
    );
  });

  it("keeps a needs-followup verdict in the queue", () => {
    const queue = deriveQueue({
      feedback,
      reviews: [
        {
          id: "r1",
          conversationId: "c1",
          messageId: "4",
          reviewerId: "rev",
          status: "needs_followup",
          issues: [],
          severity: "minor",
          createdAt: "2026-09-15T13:00:00.000Z",
        },
      ],
      manual: [],
    });
    expect(queue.find((item) => item.feedbackId === "f1")?.status).toBe(
      "needs_followup",
    );
  });

  it("counts unreviewed negatives, issue distribution and per-subrole rates", () => {
    const metrics = aggregateQuality({
      conversations: [
        {
          conversationId: "c1",
          userId: "u1",
          subroleId: "analyst",
          assistantMessages: 4,
          createdAt: 1,
        },
        {
          conversationId: "c2",
          userId: "u2",
          subroleId: "developer",
          assistantMessages: 6,
          createdAt: 2,
        },
      ],
      feedback,
      reviews: [
        {
          id: "r1",
          conversationId: "c1",
          messageId: "4",
          reviewerId: "rev",
          status: "reviewed",
          issues: ["answer.incorrect", "context.missing_knowledge"],
          severity: "major",
          createdAt: "2026-09-15T13:00:00.000Z",
        },
      ],
    });
    expect(metrics.conversations).toBe(2);
    expect(metrics.activeUsers).toBe(2);
    expect(metrics.assistantMessages).toBe(10);
    expect(metrics.ratedMessages).toBe(3);
    expect(metrics.ratingRate).toBe(0.3);
    expect(metrics.positiveRate).toBeCloseTo(1 / 3);
    expect(metrics.unreviewedNegatives).toBe(1);
    expect(metrics.issues).toEqual([
      { issue: "answer.incorrect", count: 1 },
      { issue: "context.missing_knowledge", count: 1 },
    ]);
    const developer = metrics.bySubrole.find((row) => row.key === "developer");
    expect(developer?.rated).toBe(2);
    expect(developer?.positiveRate).toBe(0.5);
    expect(metrics.trend.map((point) => point.date)).toEqual(["2026-09-15"]);
  });

  it("reports no rate at all rather than a fabricated zero", () => {
    const metrics = aggregateQuality({
      conversations: [],
      feedback: [],
      reviews: [],
    });
    expect(metrics.positiveRate).toBeNull();
    expect(metrics.ratingRate).toBeNull();
  });
});

describe("stored session reader fallback", () => {
  it("reports a missing log as not-found instead of throwing", async () => {
    const reader = staticSessionLogReader({
      sessions: [
        {
          id: "c1",
          createdAt: 1,
        } satisfies QaStoredSessionHeader,
      ],
      events: {},
    });
    expect(await reader.read("c1")).toEqual({ ok: false, reason: "not-found" });
    expect((await reader.list()).headers).toHaveLength(1);
  });

  it("calls an explicit fixture complete unless it says otherwise", async () => {
    // A fixture that names its sessions means them to be the whole world; a
    // live-only view of a larger deployment has to say so, because the
    // ownership sweep treats an incomplete listing as an answer it cannot use.
    expect((await staticSessionLogReader({}).list()).complete).toBe(true);
    expect(
      (await staticSessionLogReader({ complete: false }).list()).complete,
    ).toBe(false);
  });
});
