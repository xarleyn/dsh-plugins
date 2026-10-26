import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionLogReader,
  staticSessionLogReader,
} from "../../src/admin/session-log.js";
import { QA_ADMIN_REQUEST_BUDGET_MS } from "../../src/admin/read-budget.js";
import { harness, logFor } from "./admin-service.helpers.js";

afterEach(() => vi.useRealTimers());

describe("bounded administrative reads", () => {
  it("returns overview data within one budget even when every storage operation stalls", async () => {
    vi.useFakeTimers();
    const sessionLog = createSessionLogReader({
      get: (name: string) =>
        name === "sessionQuery"
          ? {
              listSessions: () => new Promise(() => {}),
              readSession: () => new Promise(() => {}),
            }
          : undefined,
    } as never);
    const world = harness({ sessionLog });
    world.service.rateMessage(world.alice.token, "session-alice", "2", {
      rating: "negative",
    });
    let done = false;
    const pending = world.service.overview(world.admin.token).then((result) => {
      done = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(QA_ADMIN_REQUEST_BUDGET_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.metrics).toMatchObject({
      conversations: 2,
      ratedMessages: 1,
      ratingRate: null,
      coverage: {
        complete: false,
        readConversations: 0,
        totalConversations: 2,
      },
    });
    expect(result.queue).toHaveLength(1);
    expect(result.recentFeedback).toHaveLength(1);
    expect(done).toBe(true);
  });

  it("does not turn missing rated logs into an inflated coverage percentage", async () => {
    const inner = staticSessionLogReader({
      sessions: [
        { id: "session-alice", createdAt: 1 },
        { id: "session-bob", createdAt: 2 },
      ],
      events: { "session-alice": logFor("A", "Question", "Answer") },
    });
    const world = harness({ sessionLog: inner });
    world.service.rateMessage(world.alice.token, "session-alice", "2", {
      rating: "positive",
    });
    world.service.rateMessage(world.bob.token, "session-bob", "2", {
      rating: "positive",
    });
    const metrics = await world.service.metrics(world.admin.token);
    expect(metrics).toMatchObject({
      conversations: 2,
      assistantMessages: 1,
      ratedMessages: 2,
      ratingRate: null,
      coverage: {
        complete: false,
        readConversations: 1,
        totalConversations: 2,
      },
    });
  });

  it("counts only ratings targeting actual assistant messages in the coverage ratio", async () => {
    const world = harness();
    world.service.rateMessage(world.alice.token, "session-alice", "2", {
      rating: "positive",
    });
    world.service.rateMessage(world.alice.token, "session-alice", "999", {
      rating: "positive",
    });
    const metrics = await world.service.metrics(world.admin.token);
    expect(metrics.ratedMessages).toBe(2);
    expect(metrics.ratingRate).toBe(0.5);
    expect(metrics.coverage?.complete).toBe(true);
  });
});
