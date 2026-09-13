// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaQuestions } from "../src/client/components/QaQuestions.js";
import type { QaPendingQuestion } from "../src/types.js";

function request(questions: QaPendingQuestion["questions"]): QaPendingQuestion {
  return { id: "request-1", sessionId: "s1", createdAt: 1, questions };
}

const SINGLE = request([
  {
    id: "target",
    question: "Куда писать отчёт?",
    header: "Формат",
    detail: "Отчёт за квартал",
    multiSelect: false,
    options: [
      { label: "В Confluence", description: "Со страницей-источником" },
      { label: "В чат", description: null },
    ],
  },
]);

const DOUBLE = request([
  {
    id: "target",
    question: "Куда писать отчёт?",
    header: null,
    detail: null,
    multiSelect: false,
    options: [{ label: "В Confluence", description: null }],
  },
  {
    id: "parts",
    question: "Какие разделы включить?",
    header: null,
    detail: null,
    multiSelect: true,
    options: [
      { label: "Итоги", description: null },
      { label: "Риски", description: null },
    ],
  },
]);

function mount(pending: QaPendingQuestion) {
  const onAnswer = vi.fn(async () => undefined);
  const onCancel = vi.fn(async () => undefined);
  render(
    <QaQuestions
      questions={[pending]}
      onAnswer={onAnswer}
      onCancel={onCancel}
    />,
  );
  return { onAnswer, onCancel };
}

describe("QA question form", () => {
  it("renders the question, its options and its detail", () => {
    mount(SINGLE);
    expect(screen.getByText("Требуется ответ")).toBeDefined();
    expect(screen.getByText("Куда писать отчёт?")).toBeDefined();
    expect(screen.getByText("Отчёт за квартал")).toBeDefined();
    expect(screen.getByText("В Confluence")).toBeDefined();
  });

  it("sends the chosen option and refuses to submit a blank answer", async () => {
    const { onAnswer } = mount(SINGLE);
    const submit = screen.getByText("Отправить");
    expect(submit).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByText("В Confluence"));
    expect(submit).toHaveProperty("disabled", false);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith("request-1", [
        { id: "target", selected: ["В Confluence"] },
      ]);
    });
  });

  it("lets free text override a single-select choice", async () => {
    const { onAnswer } = mount(SINGLE);
    fireEvent.click(screen.getByText("В чат"));
    fireEvent.change(screen.getByPlaceholderText("Напечатайте ответ…"), {
      target: { value: "В письмо руководителю" },
    });
    fireEvent.click(screen.getByText("Отправить"));
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith("request-1", [
        { id: "target", selected: [], custom: "В письмо руководителю" },
      ]);
    });
  });

  it("reports a skipped question as skipped", async () => {
    const { onAnswer } = mount(SINGLE);
    fireEvent.click(screen.getByText("Пропустить"));
    fireEvent.click(screen.getByText("Отправить"));
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith("request-1", [
        { id: "target", selected: [] },
      ]);
    });
  });

  it("pages through questions and sends one answer per question", async () => {
    const { onAnswer } = mount(DOUBLE);
    expect(screen.getByText("Требуется ответ · вопрос 1 из 2")).toBeDefined();
    fireEvent.click(screen.getByText("В Confluence"));
    // A single-select choice advances by itself.
    expect(screen.getByText("Какие разделы включить?")).toBeDefined();
    fireEvent.click(screen.getByText("Итоги"));
    fireEvent.click(screen.getByText("Риски"));
    fireEvent.click(screen.getByText("Отправить"));
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith("request-1", [
        { id: "target", selected: ["В Confluence"] },
        { id: "parts", selected: ["Итоги", "Риски"] },
      ]);
    });
  });

  it("closes the request without answering it", async () => {
    const { onCancel } = mount(SINGLE);
    fireEvent.click(screen.getByText("Отмена"));
    expect(onCancel).toHaveBeenCalledWith("request-1");
    await waitFor(() => {
      expect(screen.getByText("Отмена")).toHaveProperty("disabled", false);
    });
  });

  it("keeps the form on screen when the answer cannot be sent", async () => {
    const onAnswer = vi.fn(async () => {
      throw new Error("transport");
    });
    render(
      <QaQuestions
        questions={[SINGLE]}
        onAnswer={onAnswer}
        onCancel={vi.fn(async () => undefined)}
      />,
    );
    fireEvent.click(screen.getByText("В чат"));
    fireEvent.click(screen.getByText("Отправить"));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Куда писать отчёт?")).toBeDefined();
  });
});
