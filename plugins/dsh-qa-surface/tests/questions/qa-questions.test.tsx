// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaQuestions } from "../../src/client/components/QaQuestions.js";
import type { QaPendingQuestion } from "../../src/types.js";

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
  const { container } = render(
    <QaQuestions
      questions={[pending]}
      onAnswer={onAnswer}
      onCancel={onCancel}
    />,
  );
  return { onAnswer, onCancel, container };
}

describe("QA question form", () => {
  it("renders the question, its options and its detail", () => {
    mount(SINGLE);
    expect(screen.getByTestId("qa-question-state").textContent).toBe(
      "Требуется ответ",
    );
    expect(screen.getByTestId("qa-question-text").textContent).toBe(
      "Куда писать отчёт?",
    );
    expect(screen.getByTestId("qa-question-detail").textContent).toBe(
      "Отчёт за квартал",
    );
    expect(screen.getByRole("radio", { name: /В Confluence/ })).toBeTruthy();
  });

  it("hides punctuation-only junk a model put into details and descriptions", () => {
    const junk = request([
      {
        id: "target",
        question: "Какой объём анализа нужен?",
        header: null,
        detail: "?",
        multiSelect: false,
        options: [
          { label: "Подробный анализ", description: "?" },
          { label: "Краткий анализ", description: "..." },
          { label: "Обзор", description: "С перечнем разделов" },
        ],
      },
    ]);
    mount(junk);
    expect(
      screen.getAllByTestId("qa-question-option-description"),
    ).toHaveLength(1);
    expect(
      screen.getByTestId("qa-question-option-description").textContent,
    ).toBe("С перечнем разделов");
    expect(screen.queryByTestId("qa-question-detail")).toBeNull();
  });

  it("splits the strip into a status text and a right-aligned pager", () => {
    mount(DOUBLE);
    expect(screen.getByTestId("qa-question-state").textContent).toBe(
      "Требуется ответ",
    );
    const count = screen.getByTestId("qa-question-count");
    expect(count.textContent).toBe("вопрос 1 из 2");
    expect(screen.getByTestId("qa-question").textContent ?? "").not.toContain(
      "·",
    );
  });

  it("keeps the pager out of a single-question strip", () => {
    mount(SINGLE);
    expect(screen.queryByTestId("qa-question-count")).toBeNull();
    expect(screen.getByTestId("qa-question-state").textContent).toBe(
      "Требуется ответ",
    );
  });

  it("sends the chosen option and refuses to submit a blank answer", async () => {
    const { onAnswer } = mount(SINGLE);
    const submit = screen.getByTestId("qa-question-submit");
    expect(submit).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("radio", { name: /В Confluence/ }));
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
    fireEvent.click(screen.getByRole("radio", { name: "В чат" }));
    fireEvent.change(screen.getByTestId("qa-question-custom"), {
      target: { value: "В письмо руководителю" },
    });
    fireEvent.click(screen.getByTestId("qa-question-submit"));
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith("request-1", [
        { id: "target", selected: [], custom: "В письмо руководителю" },
      ]);
    });
  });

  it("reports a skipped question as skipped", async () => {
    const { onAnswer } = mount(SINGLE);
    fireEvent.click(screen.getByTestId("qa-question-skip"));
    fireEvent.click(screen.getByTestId("qa-question-submit"));
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith("request-1", [
        { id: "target", selected: [] },
      ]);
    });
  });

  it("pages through questions and sends one answer per question", async () => {
    const { onAnswer } = mount(DOUBLE);
    expect(screen.getByTestId("qa-question-state").textContent).toBe(
      "Требуется ответ",
    );
    expect(screen.getByTestId("qa-question-count").textContent).toBe(
      "вопрос 1 из 2",
    );
    fireEvent.click(screen.getByRole("radio", { name: "В Confluence" }));
    // A single-select choice advances by itself.
    expect(screen.getByTestId("qa-question-text").textContent).toBe(
      "Какие разделы включить?",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Итоги" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Риски" }));
    fireEvent.click(screen.getByTestId("qa-question-submit"));
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith("request-1", [
        { id: "target", selected: ["В Confluence"] },
        { id: "parts", selected: ["Итоги", "Риски"] },
      ]);
    });
  });

  it("closes the request without answering it", async () => {
    const { onCancel } = mount(SINGLE);
    fireEvent.click(screen.getByTestId("qa-question-cancel"));
    expect(onCancel).toHaveBeenCalledWith("request-1");
    await waitFor(() => {
      expect(screen.getByTestId("qa-question-cancel")).toHaveProperty(
        "disabled",
        false,
      );
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
    fireEvent.click(screen.getByRole("radio", { name: "В чат" }));
    fireEvent.click(screen.getByTestId("qa-question-submit"));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByTestId("qa-question-text").textContent).toBe(
      "Куда писать отчёт?",
    );
  });

  it("sends one answer however often the operator presses the button", async () => {
    let release: () => void;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <QaQuestions
        questions={[SINGLE]}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "В чат" }));
    const submit = screen.getByTestId("qa-question-submit");
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    release!();
    await waitFor(() => {
      expect(submit).toHaveProperty("disabled", false);
    });
  });

  it("carries the run's own stop action while the form owns the composer", async () => {
    const onStop = vi.fn(async () => undefined);
    render(
      <QaQuestions
        questions={[SINGLE]}
        onAnswer={vi.fn(async () => undefined)}
        onCancel={vi.fn(async () => undefined)}
        onStop={onStop}
        canStop
      />,
    );
    fireEvent.click(screen.getByTestId("qa-questions-stop"));
    await waitFor(() => {
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  it("offers the stop action disabled while the run cannot be stopped", () => {
    render(
      <QaQuestions
        questions={[SINGLE]}
        onAnswer={vi.fn(async () => undefined)}
        onCancel={vi.fn(async () => undefined)}
        onStop={vi.fn(async () => undefined)}
        canStop={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Остановить" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("leaves the stop action out where the surface has none", () => {
    mount(SINGLE);
    expect(screen.queryByTestId("qa-questions-stop")).toBeNull();
  });
});
