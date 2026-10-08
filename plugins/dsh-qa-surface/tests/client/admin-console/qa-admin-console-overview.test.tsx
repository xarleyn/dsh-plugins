// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaConversationReviewInput } from "../../../src/types.js";
import {
  CONVERSATION,
  adminApi,
  renderConsole,
} from "./qa-admin-console.helpers.js";

describe("admin console", () => {
  it("opens on the overview with the quality counters and alerts", async () => {
    renderConsole(adminApi());
    expect(await screen.findByRole("heading", { name: "Обзор" })).toBeTruthy();
    expect(
      (await screen.findByTestId("qa-admin-overview-alert")).textContent,
    ).toContain("негативных оценок без разбора");
    // The positive-share metric is a plain percentage on its own row.
    expect(
      screen.getByTestId("qa-admin-metric-positive-value").textContent,
    ).toBe("33%");
  });

  it("lists conversations and opens one on its own route", async () => {
    const api = adminApi();
    renderConsole(api, "/qa/admin/conversations");
    expect(
      await screen.findByTestId("qa-admin-conversations-row"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("qa-admin-conversations-cell-title").textContent,
    ).toContain("Отчёт по релизу");
    fireEvent.click(screen.getByTestId("qa-admin-conversations-open"));
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/qa/admin/conversations/session-alice",
      ),
    );
    const texts = await screen.findAllByTestId("qa-admin-message-text");
    expect(texts[0]?.textContent).toBe("Сделай отчёт по релизу");
    expect(texts[1]?.textContent).toBe("Готово");
    // The reviewer sees what the agent could use at the time: the frozen
    // capability snapshot, and the skills the model actually loaded.
    expect(
      screen.getByTestId("qa-admin-conversation-loaded-skills").textContent,
    ).toContain("release-notes");
    // And the block says whose agent that was: a delegated assistant runs
    // without the catalog, so a snapshot of the chat is not a snapshot of it.
    expect(
      screen.getByTestId("qa-admin-conversation-skill-scope").textContent,
    ).toContain("Список описывает агента самого разговора");
    // Tool calls stay collapsed until asked for.
    const tools = within(screen.getByTestId("qa-admin-message-tools"));
    expect(tools.queryByTestId("qa-admin-message-tool-args")).toBeNull();
    fireEvent.click(screen.getByTestId("qa-admin-message-tools-toggle"));
    expect(tools.getByTestId("qa-admin-message-tool-args").textContent).toBe(
      '{"repository":"api"}',
    );
  });

  it("keeps the section out of reach for a role that may not open it", async () => {
    renderConsole(adminApi(), "/qa/admin", "reviewer");
    expect(await screen.findByRole("heading", { name: "Обзор" })).toBeTruthy();
    // Access administration is not a reviewer's business.
    expect(screen.queryByTestId("qa-admin-nav-common")).toBeNull();
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
    const issues = within(await screen.findByTestId("qa-admin-review-issues"));
    // The option is still ticked through the name a screen reader reads.
    fireEvent.click(issues.getByRole("checkbox", { name: "Неверный ответ" }));
    fireEvent.click(screen.getByTestId("qa-admin-review-save"));
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
    expect(
      await screen.findByTestId("qa-admin-review-queue-item"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("qa-admin-review-queue-priority").textContent,
    ).toBe("Высокий");
    expect(screen.getByTestId("qa-admin-review-queue-reason").textContent).toBe(
      "Негативная оценка",
    );
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
      (await screen.findByTestId("qa-admin-conversation-transcript-error"))
        .textContent,
    ).toContain("Журнал разговора не читается");
  });
});
