// @vitest-environment jsdom

import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "../../../src/client/components/Markdown.js";
import { QaMessage } from "../../../src/client/components/QaMessage.js";
import { parseMarkdown } from "../../../src/client/markdown/blocks.js";

/** A display formula mid-stream: the closer has not arrived yet. */
const OPEN_FORMULA = "Сравним два подхода.\n\n$$\n\\frac{a}{b} = c";

/** The same answer one frame later, with the fence closed. */
const CLOSED_FORMULA = `${OPEN_FORMULA}\n$$\n\nОтношение меньше единицы.`;

const TABLE_HEADER_ROW = "| Показатель | Значение |";

/** The same answer with its delimiter row written out in full. */
const TABLE_HEAD = `${TABLE_HEADER_ROW}\n| --- | ---: |`;

/** An answer whose every frame the reader sees: a formula, then a table. */
const STREAMED_ANSWER = `$$\n\\rho = \\frac{A}{B}\n$$\n\n${TABLE_HEAD}\n| КПД | 0,82 |`;

/** The rows {@link STREAMED_ANSWER} carries, once they are written whole. */
const TABLE_ROWS = [["КПД", "0,82"]];

/**
 * A finished answer of every shape the stream carries: headings, a one-line
 * formula, a display block, a table, a fence and a footnote.
 */
const FINISHED_ANSWER = [
  "## Итог",
  "",
  "Отношение задаётся формулой $\\eta = \\frac{A}{B}$ и таблицей ниже.",
  "",
  "$$",
  "\\rho = \\frac{A}{B}",
  "$$",
  "",
  "| Показатель | Значение |",
  "| --- | ---: |",
  "| КПД | 0,82 |",
  "| Срок | 5 лет |",
  "",
  "```text",
  "eta = A / B",
  "```",
  "",
  "Методика расчёта описана отдельно[^1].",
  "",
  "[^1]: Считается по годовой форме.",
].join("\n");

function renderFrame(text: string, streaming: boolean): HTMLElement {
  const { container } = render(<Markdown text={text} streaming={streaming} />);
  return container;
}

describe("assistant Markdown while an answer streams", () => {
  it("holds an open display formula as literal TeX instead of its dollars", () => {
    const container = renderFrame(OPEN_FORMULA, true);
    const pending = within(container).queryByTestId("qa-md-math-pending");
    expect(pending?.textContent).toBe("\\frac{a}{b} = c");
    expect(container.textContent).not.toContain("$$");
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("holds the rest of a one-line formula the stream has not closed", () => {
    const container = renderFrame(
      "Отношение меньше единицы:\n\n$$\\eta = \\frac{A}{B}",
      true,
    );
    expect(
      within(container).queryByTestId("qa-md-math-pending")?.textContent,
    ).toBe("\\eta = \\frac{A}{B}");
    expect(container.textContent).not.toContain("$$");
  });

  it("holds a math fence that is still open", () => {
    const container = renderFrame("Формула:\n\n```math\n\\frac{a}{b}", true);
    expect(
      within(container).queryByTestId("qa-md-math-pending")?.textContent,
    ).toBe("\\frac{a}{b}");
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("renders the formula through KaTeX as soon as its fence closes", () => {
    const container = renderFrame(CLOSED_FORMULA, true);
    expect(within(container).queryByTestId("qa-md-math-pending")).toBeNull();
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).not.toContain("$$");
  });

  it("keeps a diagram as source in every frame it streams", () => {
    const open = "Схема:\n\n```mermaid\ngraph TD\n  A --> B";
    for (const frame of [open, `${open}\n\`\`\`\n`]) {
      const container = renderFrame(frame, true);
      expect(container.querySelector("svg")).toBeNull();
      expect(within(container).getByTestId("qa-md-code-lang").textContent).toBe(
        "mermaid",
      );
      expect(
        within(container).getByTestId("qa-md-code-content").textContent,
      ).toContain("graph TD");
    }
  });

  it("reads a half-typed delimiter row as the table header, not as prose", () => {
    for (const frame of [
      `${TABLE_HEADER_ROW}\n| --- |`,
      `${TABLE_HEADER_ROW}\n|`,
    ]) {
      const settled = renderFrame(frame, false);
      expect(settled.querySelector("table")).toBeNull();
      expect(settled.textContent).toContain("| Показатель | Значение |");
      const held = renderFrame(frame, true);
      expect(held.textContent).not.toContain("| Показатель | Значение |");
      expect(
        [...held.querySelectorAll("th")].map((cell) => cell.textContent),
      ).toEqual(["Показатель", "Значение"]);
    }
  });

  it("waits for a row to be written before the row joins the table", () => {
    const half = renderFrame(`${TABLE_HEAD}\n| КПД | 0,8`, true);
    expect(half.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(half.textContent).not.toContain("0,8");
    const whole = renderFrame(`${TABLE_HEAD}\n| КПД | 0,82 |\n`, true);
    expect(
      [...whole.querySelectorAll("tbody tr td")].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(["КПД", "0,82"]);
  });

  it("renders a finished answer the same way whether or not it was a stream", () => {
    for (const answer of [FINISHED_ANSWER, `${FINISHED_ANSWER}\n`]) {
      expect(renderFrame(answer, true).innerHTML).toBe(
        renderFrame(answer, false).innerHTML,
      );
    }
  });

  it("holds the formula when the frame stops right after a line break", () => {
    const container = renderFrame(
      "Сравним два подхода.\n\n$$\n\\frac{a}{b}\n",
      true,
    );
    expect(
      within(container).queryByTestId("qa-md-math-pending")?.textContent,
    ).toBe("\\frac{a}{b}");
    expect(container.textContent).not.toContain("$$");
  });

  it("holds a one-line formula the frame has already moved past", () => {
    const container = renderFrame(
      "Отношение меньше единицы:\n\n$$\\eta = \\frac{A}{B}\n",
      true,
    );
    expect(
      within(container).queryByTestId("qa-md-math-pending")?.textContent,
    ).toBe("\\eta = \\frac{A}{B}");
    expect(container.textContent).not.toContain("$$");
  });

  it("keeps reading an unfinished block as literal text once the text settled", () => {
    const [head] = parseMarkdown(OPEN_FORMULA).blocks;
    expect(head).toEqual({
      kind: "paragraph",
      text: "Сравним два подхода.",
    });
    expect(parseMarkdown(OPEN_FORMULA).blocks[1]).toEqual({
      kind: "paragraph",
      text: "$$\n\\frac{a}{b} = c",
    });
    expect(parseMarkdown("$$\\eta = 1\n").blocks[0]).toEqual({
      kind: "paragraph",
      text: "$$\\eta = 1",
    });
    expect(parseMarkdown(`${TABLE_HEAD}\n| КПД | 0,8`).blocks[0]).toEqual({
      kind: "table",
      align: ["left", "right"],
      head: ["Показатель", "Значение"],
      rows: [["КПД", "0,8"]],
    });
  });

  it("holds the frame only in the row that is still streaming", () => {
    const message = {
      id: "assistant:1",
      role: "assistant" as const,
      text: OPEN_FORMULA,
      status: "streaming" as const,
    };
    const { container, rerender } = render(
      <QaMessage message={message} renderMarkdown showTimestamp={false} />,
    );
    expect(
      within(container).queryByTestId("qa-md-math-pending"),
    ).not.toBeNull();
    rerender(
      <QaMessage
        message={{ ...message, text: CLOSED_FORMULA, status: "committed" }}
        renderMarkdown
        showTimestamp={false}
      />,
    );
    expect(within(container).queryByTestId("qa-md-math-pending")).toBeNull();
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("keeps raw markup out of every frame the answer arrives in", () => {
    const wholeRows = new Set(TABLE_ROWS.map((row) => row.join("\u0000")));
    const leaking: string[] = [];
    const partial: string[] = [];
    // A frame is where the stream happened to stop, mid-line as often as not.
    for (let taken = 1; taken <= STREAMED_ANSWER.length; taken += 1) {
      const text = STREAMED_ANSWER.slice(0, taken);
      const container = renderFrame(text, true);
      if (/\$\$/u.test(container.textContent ?? "")) leaking.push(text);
      for (const row of container.querySelectorAll("tbody tr")) {
        const cells = [...row.querySelectorAll("td")].map(
          (cell) => cell.textContent ?? "",
        );
        if (!wholeRows.has(cells.join("\u0000"))) partial.push(text);
      }
    }
    expect({ leaking, partial }).toEqual({ leaking: [], partial: [] });
  });
});
