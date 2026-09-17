// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaAdmin } from "../src/client/admin/QaAdmin.js";
import type { QaAccessApi, QaAdminApi } from "../src/client/types.js";
import type {
  QaAdminOverview,
  QaConversationDetail,
  QaConversationReviewInput,
  QaConversationSummary,
  QaReviewQueueRow,
} from "../src/types.js";

const CONVERSATION: QaConversationDetail = {
  conversationId: "session-alice",
  summary: {
    conversationId: "session-alice",
    userId: "u1",
    displayName: "alice",
    subroleId: "analyst",
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:05:00.000Z",
    title: "Отчёт по релизу",
    messageCount: 2,
    positiveFeedback: 0,
    negativeFeedback: 1,
    reviewStatus: "unreviewed",
  },
  runtime: {
    subroleId: "analyst",
    adminPreview: false,
    model: "glm-4.7",
    provider: "zai",
    effectiveTools: ["read", "search"],
    effectiveSkills: ["release-notes"],
    loadedSkills: ["release-notes"],
  },
  messages: [
    {
      id: "1",
      seq: 1,
      role: "user",
      text: "Сделай отчёт по релизу",
      time: Date.parse("2026-09-15T10:00:10.000Z"),
    },
    {
      id: "3",
      seq: 3,
      role: "assistant",
      text: "Готово",
      time: Date.parse("2026-09-15T10:00:20.000Z"),
      model: "glm-4.7",
      usage: { inputTokens: 100, outputTokens: 20 },
      toolCalls: [
        {
          callId: "c1",
          name: "git_readonly",
          arguments: '{"repository":"api"}',
          result: "not a repository",
          error: "git",
          durationMs: 400,
        },
      ],
      feedback: [
        {
          id: "f1",
          conversationId: "session-alice",
          messageId: "3",
          userId: "u1",
          rating: "negative",
          reasons: ["incorrect"],
          createdAt: "2026-09-15T10:06:00.000Z",
        },
      ],
    },
  ],
  reviews: [],
  queueItems: [
    {
      conversationId: "session-alice",
      messageId: "3",
      reason: "negative_feedback",
      priority: "high",
      status: "unreviewed",
      raisedAt: "2026-09-15T10:06:00.000Z",
    },
  ],
};

const SUMMARY: QaConversationSummary = CONVERSATION.summary;

const QUEUE_ROW: QaReviewQueueRow = {
  ...(CONVERSATION.queueItems[0] as QaReviewQueueRow),
  displayName: "alice",
  subroleId: "analyst",
  title: "Отчёт по релизу",
  raisedAtLabel: "2026-09-15T10:06:00.000Z",
};

const OVERVIEW: QaAdminOverview = {
  metrics: {
    conversations: 2,
    activeUsers: 2,
    assistantMessages: 4,
    ratedMessages: 3,
    positiveRatings: 1,
    negativeRatings: 2,
    ratingRate: 0.75,
    positiveRate: 1 / 3,
    unreviewedNegatives: 2,
    reviewedItems: 0,
    issues: [],
    bySubrole: [
      {
        key: "analyst",
        label: "analyst",
        rated: 3,
        positive: 1,
        negative: 2,
        positiveRate: 1 / 3,
      },
    ],
    trend: [{ date: "2026-09-15", rated: 3, positive: 1, negative: 2 }],
  },
  alerts: [{ level: "critical", code: "unreviewed-negatives", count: 2 }],
  recentFeedback: [],
  queue: [QUEUE_ROW],
};

function accessApi(): QaAccessApi {
  return {
    current: vi.fn(),
    session: vi.fn(),
    admin: vi.fn(async () => ({
      ok: true as const,
      value: {
        config: {
          version: 1 as const,
          common: {
            tools: { always: [], skillGrantable: [] },
            skills: [],
          },
          subroles: [
            {
              id: "analyst",
              name: "Аналитик",
              enabled: true,
              capabilities: {
                tools: { always: [], skillGrantable: [] },
                skills: [],
              },
            },
          ],
          skillOverrides: [],
        },
        systemRequired: {
          tools: { always: [], skillGrantable: [] },
          skills: [],
        },
        catalog: [],
        skills: [],
        users: [],
        audit: [],
      },
    })),
    createSubrole: vi.fn(),
    updateSubrole: vi.fn(),
    deleteSubrole: vi.fn(),
    updateCommon: vi.fn(),
    updateAssignment: vi.fn(),
    updateSkillOverride: vi.fn(),
    skillActivations: vi.fn(),
  };
}

function adminApi(overrides: Partial<QaAdminApi> = {}): QaAdminApi {
  const page = <T,>(items: readonly T[]) => ({
    ok: true as const,
    value: { items, nextCursor: null, total: items.length },
  });
  return {
    overview: vi.fn(async () => ({ ok: true as const, value: OVERVIEW })),
    users: vi.fn(async () => page([])),
    user: vi.fn(async () => ({
      ok: false as const,
      error: new Error("unused"),
    })),
    updateUser: vi.fn(),
    conversations: vi.fn(async () => page([SUMMARY])),
    conversation: vi.fn(async () => ({
      ok: true as const,
      value: CONVERSATION,
    })),
    deleteConversation: vi.fn(async (_token, conversationId) => ({
      ok: true as const,
      value: { conversationId, sessions: [conversationId], qualityRows: 0 },
    })),
    feedback: vi.fn(async () => page([])),
    rateMessage: vi.fn(),
    reviewQueue: vi.fn(async () => page([QUEUE_ROW])),
    queueConversation: vi.fn(),
    saveReview: vi.fn(async (_token, input) => ({
      ok: true as const,
      value: {
        id: "r1",
        reviewerId: "reviewer",
        createdAt: "2026-09-15T10:10:00.000Z",
        ...input,
      },
    })),
    metrics: vi.fn(async () => ({
      ok: true as const,
      value: OVERVIEW.metrics,
    })),
    audit: vi.fn(async () => page([])),
    ...overrides,
  };
}

function renderConsole(
  api: QaAdminApi,
  path = "/qa/admin",
  role: "admin" | "reviewer" = "admin",
) {
  window.history.pushState(null, "", path);
  return render(
    <QaAdmin
      api={accessApi()}
      adminApi={api}
      token="token"
      routePath="/qa"
      role={role}
      onPreview={() => undefined}
    />,
  );
}

describe("admin console", () => {
  it("opens on the overview with the quality counters and alerts", async () => {
    renderConsole(adminApi());
    expect(await screen.findByRole("heading", { name: "Обзор" })).toBeTruthy();
    expect(
      await screen.findByText((content) =>
        content.includes("негативных оценок без разбора"),
      ),
    ).toBeTruthy();
    // The positive-share metric is a plain percentage on its own row.
    expect(screen.getByText("33%")).toBeTruthy();
  });

  it("lists conversations and opens one on its own route", async () => {
    const api = adminApi();
    renderConsole(api, "/qa/admin/conversations");
    expect(await screen.findByText("Отчёт по релизу")).toBeTruthy();
    fireEvent.click(screen.getByText("Открыть"));
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/qa/admin/conversations/session-alice",
      ),
    );
    expect(await screen.findByText("Сделай отчёт по релизу")).toBeTruthy();
    expect(screen.getByText("Готово")).toBeTruthy();
    // The reviewer sees what the agent could use at the time: the frozen
    // capability snapshot, and the skills the model actually loaded.
    expect(screen.getAllByText(/release-notes/u).length).toBeGreaterThan(0);
    // Tool calls stay collapsed until asked for.
    expect(screen.queryByText('{"repository":"api"}')).toBeNull();
    fireEvent.click(screen.getByText(/вызовы инструментов/u));
    expect(screen.getByText('{"repository":"api"}')).toBeTruthy();
  });

  it("keeps the section out of reach for a role that may not open it", async () => {
    renderConsole(adminApi(), "/qa/admin", "reviewer");
    expect(await screen.findByRole("heading", { name: "Обзор" })).toBeTruthy();
    // Access administration is not a reviewer's business.
    expect(screen.queryByText("Общие возможности")).toBeNull();
  });

  it("classifies a conversation and sends it to the review queue", async () => {
    const saveReview = vi.fn(
      async (_token: string, input: QaConversationReviewInput) => ({
        ok: true as const,
        value: {
          id: "r1",
          reviewerId: "reviewer",
          createdAt: "2026-09-15T10:10:00.000Z",
          ...input,
        },
      }),
    );
    const api = adminApi({ saveReview });
    renderConsole(api, "/qa/admin/conversations/session-alice/3");
    fireEvent.click(await screen.findByText("Неверный ответ"));
    fireEvent.click(screen.getByText("Сохранить разбор"));
    await waitFor(() => expect(saveReview).toHaveBeenCalledTimes(1));
    expect(saveReview.mock.calls[0]?.[1]).toMatchObject({
      conversationId: "session-alice",
      status: "reviewed",
      issues: ["answer.incorrect"],
    });
  });

  it("shows the queue with its priority and reason", async () => {
    renderConsole(adminApi(), "/qa/admin/review");
    expect(
      await screen.findByRole("heading", { name: "Очередь разбора" }),
    ).toBeTruthy();
    expect(screen.getByText("Высокий")).toBeTruthy();
    expect(screen.getByText("Негативная оценка")).toBeTruthy();
  });

  it("renders an unreadable transcript as a stated reason", async () => {
    const api = adminApi({
      conversation: vi.fn(async () => ({
        ok: true as const,
        value: {
          ...CONVERSATION,
          messages: [],
          runtime: {
            ...CONVERSATION.runtime,
            transcriptUnavailable: "unreadable" as const,
          },
        },
      })),
    });
    renderConsole(api, "/qa/admin/conversations/session-alice");
    expect(
      await screen.findByText(/Журнал разговора не читается/u),
    ).toBeTruthy();
  });
});

describe("conversation deletion", () => {
  it("removes the conversation from its own page, after a confirmation", async () => {
    const deleteConversation = vi.fn(
      async (_token: string, conversationId: string) => ({
        ok: true as const,
        value: { conversationId, sessions: [conversationId], qualityRows: 2 },
      }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      renderConsole(
        adminApi({ deleteConversation }),
        "/qa/admin/conversations/session-alice",
      );

      fireEvent.click(await screen.findByText("Удалить разговор"));

      await waitFor(() => expect(deleteConversation).toHaveBeenCalledTimes(1));
      expect(deleteConversation.mock.calls[0]).toEqual([
        "token",
        "session-alice",
      ]);
      // The console leaves the page it just emptied.
      await waitFor(() =>
        expect(window.location.pathname).toBe("/qa/admin/conversations"),
      );
    } finally {
      confirm.mockRestore();
    }
  });

  it("keeps the conversation when the confirmation is declined", async () => {
    const deleteConversation = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      renderConsole(
        adminApi({ deleteConversation }),
        "/qa/admin/conversations/session-alice",
      );

      fireEvent.click(await screen.findByText("Удалить разговор"));

      expect(deleteConversation).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe(
        "/qa/admin/conversations/session-alice",
      );
    } finally {
      confirm.mockRestore();
    }
  });

  it("reports a refusal instead of leaving the page", async () => {
    const api = adminApi({
      deleteConversation: vi.fn(async () => ({
        ok: false as const,
        error: new Error("reason: conversation-live"),
      })),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      renderConsole(api, "/qa/admin/conversations/session-alice");

      fireEvent.click(await screen.findByText("Удалить разговор"));

      expect(
        await screen.findByText(/Разговор открыт на стенде прямо сейчас/u),
      ).toBeTruthy();
      expect(window.location.pathname).toBe(
        "/qa/admin/conversations/session-alice",
      );
    } finally {
      confirm.mockRestore();
    }
  });

  it("offers no deletion to a reviewer", async () => {
    renderConsole(
      adminApi(),
      "/qa/admin/conversations/session-alice",
      "reviewer",
    );

    expect(await screen.findByText("Сделай отчёт по релизу")).toBeTruthy();
    expect(screen.queryByText("Удалить разговор")).toBeNull();
  });
});
