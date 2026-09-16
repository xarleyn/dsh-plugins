import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { QaQualityStore } from "../src/admin/quality-store.js";
import { projectTranscript } from "../src/admin/conversation-log.js";
import { defaultAdminRedactor, maskSecrets } from "../src/admin/redaction.js";
import { aggregateQuality } from "../src/admin/metrics.js";
import { deriveQueue } from "../src/admin/queue.js";
import {
  staticSessionLogReader,
  type QaStoredSessionHeader,
} from "../src/admin/session-log.js";
import type { QaMessageFeedback } from "../src/types.js";

const roots: string[] = [];
const stores: QaQualityStore[] = [];

function tempFile(name = "qa-quality.db"): string {
  const root = mkdtempSync(path.join(tmpdir(), "qa-quality-"));
  roots.push(root);
  return path.join(root, name);
}

/** Build a store the cleanup below closes and deletes. */
function openStore(file: string): QaQualityStore {
  const store = new QaQualityStore(file);
  stores.push(store);
  return store;
}

afterEach(() => {
  // The store is a database: its handle goes before the directory does, or
  // Windows refuses to remove a directory holding an open file.
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

describe("conversation log projection", () => {
  const events = [
    {
      seq: 0,
      type: "session/title",
      data: { title: "Release report" },
      time: 1_000,
    },
    {
      seq: 1,
      type: "user/message",
      data: {
        content: [{ type: "text", text: "Make the report" }],
        source: { kind: "user" },
      },
      time: 1_100,
    },
    {
      seq: 2,
      type: "user/message",
      data: {
        content: [{ type: "text", text: "injected skill body" }],
        source: { kind: "plugin", plugin: "skill" },
      },
      time: 1_150,
    },
    {
      seq: 3,
      type: "assistant/message",
      data: {
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking out loud" },
            { type: "text", text: "Here it is" },
          ],
          source: { kind: "model", provider: "zai", model: "glm-4.7" },
        },
        usage: { inputTokens: 120, outputTokens: 30 },
      },
      time: 1_200,
    },
    {
      seq: 4,
      type: "tool/call",
      data: {
        callId: "c1",
        name: "skill",
        arguments: '{"name":"release-notes"}',
      },
      time: 1_210,
    },
    {
      seq: 5,
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              content: [{ type: "text", text: "skill loaded" }],
            },
          ],
        },
      },
      time: 1_240,
    },
    {
      seq: 6,
      type: "tool/call",
      data: {
        callId: "c2",
        name: "git_readonly",
        arguments: '{"repository":"api"}',
      },
      time: 1_250,
    },
    {
      seq: 7,
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "c2",
              content: [{ type: "text", text: "command failed" }],
              isError: true,
            },
          ],
        },
        error: { name: "git", code: "E1" },
      },
      time: 1_300,
    },
  ];

  it("projects messages in log order, skipping injected context", () => {
    const project = projectTranscript(events, defaultAdminRedactor);
    expect(project.title).toBe("Release report");
    expect(project.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(project.messages[0]?.id).toBe("1");
    expect(project.lastActivity).toBe(1_300);
  });

  it("carries the assistant's model, usage and tool calls", () => {
    const project = projectTranscript(events, defaultAdminRedactor);
    const assistant = project.messages[1];
    expect(assistant?.model).toBe("glm-4.7");
    expect(assistant?.provider).toBe("zai");
    expect(assistant?.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(assistant?.text).toBe("Here it is");
    expect(assistant?.toolCalls?.map((call) => call.name)).toEqual([
      "skill",
      "git_readonly",
    ]);
    const [loaded, failed] = assistant?.toolCalls ?? [];
    expect(loaded?.result).toBe("skill loaded");
    expect(failed?.error).toBe("git");
    expect(failed?.durationMs).toBe(50);
  });

  it("reports the skills the model actually loaded", () => {
    const project = projectTranscript(events, defaultAdminRedactor);
    expect(project.loadedSkills).toEqual(["release-notes"]);
  });

  it("masks credential shapes in tool traffic", () => {
    expect(maskSecrets('{"apiKey":"sk-live-abcdef123456"}')).toBe(
      '{"apiKey":"[redacted]"}',
    );
    expect(maskSecrets("Authorization: Bearer abcdef1234567890")).toBe(
      "Authorization: [redacted]",
    );
    const project = projectTranscript(
      [
        {
          seq: 0,
          type: "tool/call",
          data: {
            callId: "c1",
            name: "http",
            arguments: '{"token":"secret-value-1234"}',
          },
        },
      ],
      defaultAdminRedactor,
    );
    expect(project.messages[0]?.toolCalls?.[0]?.arguments).not.toContain(
      "secret-value-1234",
    );
  });
});

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
    expect(await reader.list()).toHaveLength(1);
  });
});
