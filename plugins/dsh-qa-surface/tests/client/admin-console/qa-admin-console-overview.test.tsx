// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
