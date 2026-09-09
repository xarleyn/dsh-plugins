// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaComposer } from "../src/client/components/QaComposer.js";
import { QaMessage } from "../src/client/components/QaMessage.js";
import {
  formatWorkDuration,
  QaWorkGroup,
} from "../src/client/components/QaWorkGroup.js";
import { Markdown } from "../src/client/components/Markdown.js";
import {
  buildChatRows,
  QaSidebar,
} from "../src/client/components/QaSidebar.js";
import type { SessionSummary } from "@deepseek-ai/dsh-client-runtime/client";

describe("QA composer", () => {
  it("sends on Enter and preserves Shift+Enter", async () => {
    const send = vi.fn(async () => true);
    render(
      <QaComposer
        placeholder="Ask"
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={send}
        onStop={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Задать вопрос");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("hello");
  });

  it("shows a real Stop button during generation", () => {
    render(
      <QaComposer
        placeholder="Ask"
        canSend={false}
        canStop
        running
        showStop
        status="Скребу по сусекам…"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Остановить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
  });

  it("renders the running status inside the composer", () => {
    render(
      <QaComposer
        placeholder="Ask"
        canSend={false}
        canStop
        running
        showStop
        status="Скребу по сусекам…"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("Скребу по сусекам…")).toBeTruthy();
  });

  it("sends a quick question from the empty-chat shortcuts", async () => {
    const send = vi.fn(async () => true);
    render(
      <QaComposer
        placeholder="Спросите"
        quickQuestions={["Что ты умеешь?", "С чего начать?"]}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={send}
        onStop={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Что ты умеешь?" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("Что ты умеешь?"));
  });
});

describe("QA message", () => {
  it("copies visible assistant text from the icon action", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <QaMessage
        message={{
          id: "assistant:1",
          role: "assistant",
          text: "Useful answer",
          status: "committed",
        }}
        renderMarkdown
        showTimestamp={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Скопировать сообщение" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Useful answer"),
    );
    expect(screen.getByRole("button", { name: "Скопировано" })).toBeTruthy();
  });
});

describe("QA work group", () => {
  it("starts collapsed for completed work and exposes all details together", () => {
    render(
      <QaWorkGroup
        status="complete"
        startedAt={1_000}
        endedAt={101_000}
        renderMarkdown
        items={[
          {
            id: "reasoning:1",
            kind: "reasoning",
            text: "Inspect the repository first.",
            status: "complete",
          },
          {
            id: "tool:1",
            kind: "tool",
            name: "bash",
            label: "Bash",
            summary: "Find TODOs",
            input: '{\n  "command": "rg TODO"\n}',
            output: "src/a.ts: TODO",
            status: "ok",
          },
        ]}
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Готово за 1 мин 40 с",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Inspect the repository first.")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Inspect the repository first.")).toBeTruthy();
    expect(screen.getByText("Find TODOs")).toBeTruthy();
  });

  it("collapses automatically when a running turn completes", async () => {
    const startedAt = Date.now() - 5_000;
    const view = render(
      <QaWorkGroup
        status="running"
        startedAt={startedAt}
        renderMarkdown={false}
        items={[
          {
            id: "reasoning:live",
            kind: "reasoning",
            text: "Still thinking",
            status: "running",
          },
        ]}
      />,
    );
    const running = screen.getByRole("button", {
      name: /Скребу по сусекам|Кумекаю|Навожу резкость|Собираю мысли|Раскладываю|Сверяю/u,
    });
    expect(running.getAttribute("aria-expanded")).toBe("true");

    view.rerender(
      <QaWorkGroup
        status="complete"
        startedAt={startedAt}
        endedAt={startedAt + 5_000}
        renderMarkdown={false}
        items={[
          {
            id: "reasoning:live",
            kind: "reasoning",
            text: "Still thinking",
            status: "complete",
          },
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Готово за 5 с" })
          .getAttribute("aria-expanded"),
      ).toBe("false"),
    );
  });

  it("formats short and minute-scale durations", () => {
    expect(formatWorkDuration(100)).toBe("< 1 с");
    expect(formatWorkDuration(17_000)).toBe("17 с");
    expect(formatWorkDuration(1_060_000)).toBe("17 мин 40 с");
  });
});

describe("safe Markdown", () => {
  it("renders formatting without interpreting HTML or unsafe links", () => {
    const { container } = render(
      <Markdown
        text={"**bold** <script>alert(1)</script> [bad](javascript:alert(1))"}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders GFM tables with alignment and inline formatting", () => {
    const { container } = render(
      <Markdown
        text={
          "before\n\n| Name | Uses |\n| :--- | ---: |\n| **glob** | find `*.ts` |\n| grep | regex |\n\nafter"
        }
      />,
    );
    const table = container.querySelector(".dsh-qa-md-table table");
    expect(table).toBeTruthy();
    expect(container.querySelectorAll("thead th").length).toBe(2);
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
    expect(container.querySelector("thead th")?.getAttribute("style")).toBe(
      "text-align: left;",
    );
    expect(
      container.querySelectorAll("thead th")[1]?.getAttribute("style"),
    ).toBe("text-align: right;");
    expect(container.querySelector("tbody strong")?.textContent).toBe("glob");
    expect(container.querySelector("tbody code")?.textContent).toBe("*.ts");
    const before = container.textContent ?? "";
    expect(before.indexOf("before")).toBeLessThan(before.indexOf("Name"));
    expect(before.indexOf("regex")).toBeLessThan(before.indexOf("after"));
  });

  it("renders ordered lists and horizontal rules", () => {
    const { container } = render(
      <Markdown text={"1. first step\n2. second step\n\n---\n\ndone"} />,
    );
    expect(container.querySelectorAll("ol li").length).toBe(2);
    expect(container.querySelector("ol li")?.textContent).toBe("first step");
    expect(container.querySelector("hr")).toBeTruthy();
    expect(container.textContent).toContain("done");
  });

  it("does not turn a single pipe sentence into a table", () => {
    const { container } = render(<Markdown text={"a | b sentence"} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("a | b sentence");
  });
});

describe("QA sidebar", () => {
  const byId = {
    "s-1": {
      id: "s-1",
      displayTitle: "How do I reset the cache?",
      running: false,
      blank: false,
      updatedAt: 1_000,
    },
    "s-2": {
      id: "s-2",
      displayTitle: "s-2",
      running: true,
      blank: true,
      updatedAt: 2_000,
    },
  } as unknown as Record<string, SessionSummary>;

  it("projects indexed ids onto the host session list, newest update first", () => {
    const rows = buildChatRows(["s-1", "s-2", "gone"], byId, "s-1", 90_000);
    expect(rows).toEqual([
      {
        id: "s-2",
        title: "Новый чат",
        running: true,
        active: false,
        meta: "1 мин",
        updatedAt: 2_000,
      },
      {
        id: "s-1",
        title: "How do I reset the cache?",
        running: false,
        active: true,
        meta: "1 мин",
        updatedAt: 1_000,
      },
    ]);
  });

  it("renders rows with the active mark and a new-chat control", () => {
    const onSwitch = vi.fn();
    const rows = buildChatRows(["s-2", "s-1"], byId, "s-2", 90_000);
    render(
      <QaSidebar
        rows={rows}
        showNewChat
        busy={false}
        onSwitch={onSwitch}
        onNewChat={vi.fn()}
      />,
    );
    const items = document.querySelectorAll(".dsh-qa-sidebar__item");
    expect(items.length).toBe(2);
    const active = document.querySelector(
      ".dsh-qa-sidebar__item--active .dsh-qa-sidebar__item-main",
    );
    expect(active?.getAttribute("aria-current")).toBe("true");
    expect(active?.textContent).toContain("Новый чат");
    expect(document.querySelector(".dsh-qa-sidebar__dot")).toBeTruthy();
    fireEvent.click(
      document.querySelector(".dsh-qa-sidebar__new") as HTMLElement,
    );
    fireEvent.click(
      (items[1] as HTMLElement).querySelector(
        ".dsh-qa-sidebar__item-main",
      ) as HTMLElement,
    );
    expect(onSwitch).toHaveBeenCalledWith("s-1");
  });

  it("renders the empty state without a new-chat control", () => {
    render(
      <QaSidebar
        rows={[]}
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(screen.getByText("Здесь пока пусто")).toBeTruthy();
    expect(screen.queryByText("Чаты")).toBeTruthy();
  });
});

it("deletes a chat after a second confirming click", () => {
  const onDelete = vi.fn();
  const rows = [
    {
      id: "s-1",
      title: "Chat",
      running: false,
      active: false,
      meta: "1m",
      updatedAt: 1,
    },
  ];
  const { container } = render(
    <QaSidebar
      rows={rows}
      showNewChat={false}
      busy={false}
      onSwitch={vi.fn()}
      onNewChat={vi.fn()}
      onDelete={onDelete}
    />,
  );
  const del = container.querySelector(
    ".dsh-qa-sidebar__item-delete",
  ) as HTMLElement;
  expect(del.getAttribute("aria-label")).toBe("Удалить чат");
  fireEvent.click(del);
  expect(onDelete).not.toHaveBeenCalled();
  expect(del.getAttribute("aria-label")).toBe("Подтвердить удаление чата");
  fireEvent.click(del);
  expect(onDelete).toHaveBeenCalledWith("s-1");
});

it("hides the delete control when the deployment omits it", () => {
  const rows = [
    {
      id: "s-1",
      title: "Chat",
      running: false,
      active: false,
      meta: "1m",
      updatedAt: 1,
    },
  ];
  const { container } = render(
    <QaSidebar
      rows={rows}
      showNewChat={false}
      busy={false}
      onSwitch={vi.fn()}
      onNewChat={vi.fn()}
    />,
  );
  expect(container.querySelector(".dsh-qa-sidebar__item-delete")).toBeNull();
});
