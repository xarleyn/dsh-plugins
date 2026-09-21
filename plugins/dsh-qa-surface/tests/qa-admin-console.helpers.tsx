import { render } from "@testing-library/react";
import { vi } from "vitest";
import { QaAdmin } from "../src/client/admin/QaAdmin.js";
import type { QaAccessApi, QaAdminApi } from "../src/client/types.js";
import type {
  QaAdminOverview,
  QaConversationDetail,
  QaConversationSummary,
  QaReviewQueueRow,
} from "../src/types.js";

export const CONVERSATION: QaConversationDetail = {
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

export const SUMMARY: QaConversationSummary = CONVERSATION.summary;

export const QUEUE_ROW: QaReviewQueueRow = {
  ...(CONVERSATION.queueItems[0] as QaReviewQueueRow),
  displayName: "alice",
  subroleId: "analyst",
  title: "Отчёт по релизу",
  raisedAtLabel: "2026-09-15T10:06:00.000Z",
};

export const OVERVIEW: QaAdminOverview = {
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

export function accessApi(): QaAccessApi {
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

export function adminApi(overrides: Partial<QaAdminApi> = {}): QaAdminApi {
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
    // A shared store with nothing in it: the console's skills page renders its
    // scope picker before any skill exists anywhere.
    skills: vi.fn(async (_token, scope) => ({
      ok: true as const,
      value: { scope, owner: null, skills: [], rootPath: "" },
    })),
    skill: vi.fn(),
    saveSkill: vi.fn(),
    deleteSkill: vi.fn(),
    validateSkill: vi.fn(),
    skillTools: vi.fn(async () => ({ ok: true as const, value: [] })),
    ...overrides,
  };
}

export function renderConsole(
  api: QaAdminApi,
  path = "/qa/admin",
  role: "admin" | "reviewer" = "admin",
): ReturnType<typeof render> {
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
