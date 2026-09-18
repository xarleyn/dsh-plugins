/**
 * The deterministic comparison core (§13–§18, §38).
 *
 * These tests are the answer to "does the plugin actually find the change":
 * each case is a pair of documents and the change set the specification says
 * must come out of them. Nothing here goes through a backend, a provider or a
 * file — the IR, the alignment, the token diff and the signals are exercised
 * directly, which is what makes a failure point at the algorithm instead of at
 * the plumbing around it.
 */

import { describe, expect, test } from "vitest";

import { diffDocuments } from "../src/documents/comparison/diff/block-diff.js";

import {
  compare,
  markdownDocument,
  only,
} from "./documents-comparison-diff.helpers.js";

describe("the specification's change table (§38)", () => {
  test("one replaced word is one replacement", () => {
    const change = only(
      compare(
        "Оплата производится в течение 10 рабочих дней.",
        "Оплата производится в течение 10 календарных дней.",
      ),
    );
    expect(change.kind).toBe("replace");
    expect(change.nodeType).toBe("paragraph");
    expect(change.before).toBe(
      "Оплата производится в течение 10 рабочих дней.",
    );
    expect(change.after).toBe(
      "Оплата производится в течение 10 календарных дней.",
    );
    const deleted = (change.spans ?? []).filter(
      (span) => span.kind === "delete",
    );
    expect(deleted.map((span) => span.text).join("")).toBe("рабочих");
  });

  test("an added `не` is an exact replacement and a negation signal", () => {
    const change = only(
      compare(
        "Исполнитель вправе привлекать третьих лиц.",
        "Исполнитель не вправе привлекать третьих лиц.",
      ),
    );
    expect(change.kind).toBe("replace");
    expect(change.signals).toContain("NEGATION_CHANGED");
    expect(change.signals).toContain("PERMISSION_TERM_CHANGED");
    expect(change.signals).toContain("PROHIBITION_TERM_CHANGED");
  });

  test("a changed number is a change even when the sentence is identical", () => {
    const change = only(compare("Срок — 10 дней.", "Срок — 30 дней."));
    expect(change.signals).toContain("NUMBER_CHANGED");
  });

  test("a changed duration is a duration change", () => {
    const change = only(
      compare(
        "Оплата в течение 10 рабочих дней.",
        "Оплата в течение 30 рабочих дней.",
      ),
    );
    expect(change.signals).toContain("DURATION_CHANGED");
  });

  test("5% becoming 0.5% is never normalized away", () => {
    const change = only(compare("Ставка 5%.", "Ставка 0.5%."));
    expect(change.kind).toBe("replace");
    expect(change.signals).toContain("PERCENTAGE_CHANGED");
    const spans = change.spans ?? [];
    expect(
      spans
        .filter((span) => span.kind !== "delete")
        .map((span) => span.text)
        .join(""),
    ).toBe("Ставка 0.5%.");
  });

  test("a currency swap is a money change", () => {
    const change = only(
      compare("Стоимость 500 000 ₽.", "Стоимость 500 000 $."),
    );
    expect(change.signals).toContain("MONEY_CHANGED");
  });

  test("a changed amount is a money change", () => {
    const change = only(compare("Итого 500 000 ₽.", "Итого 750 000 ₽."));
    expect(change.signals).toContain("MONEY_CHANGED");
    expect(change.signals).toContain("NUMBER_CHANGED");
  });

  test("an added paragraph is an insertion", () => {
    const changes = compare(
      "Первый.\n\nТретий.\n",
      "Первый.\n\nВторой.\n\nТретий.\n",
    );
    const change = only(changes);
    expect(change.kind).toBe("insert");
    expect(change.after).toBe("Второй.");
  });

  test("a removed paragraph is a deletion", () => {
    const change = only(compare("Первый.\n\nВторой.\n", "Первый.\n"));
    expect(change.kind).toBe("delete");
    expect(change.before).toBe("Второй.");
  });

  test("a moved paragraph is a move, not a delete plus an insert", () => {
    const changes = compare(
      "## 1\n\nАльфа.\n\n## 2\n\nБета.\n",
      "## 2\n\nБета.\n\n## 1\n\nАльфа.\n",
    );
    expect(changes.map((change) => change.kind)).toEqual(["move", "move"]);
    expect(changes.every((change) => change.before === change.after)).toBe(
      true,
    );
  });

  test("a paragraph that moved unchanged keeps one change per paragraph", () => {
    const changes = compare(
      "# Раздел\n\nАльфа.\n\nБета.\n\nГамма.\n",
      "# Раздел\n\nАльфа.\n\nГамма.\n\nБета.\n",
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("move");
    expect(changes[0]?.after).toBe("Бета.");
  });

  test("a table cell change is reported as a cell, with its coordinates", () => {
    const changes = compare(
      ["| Позиция | Сумма |", "| --- | --- |", "| Лицензия | 500 000 ₽ |"].join(
        "\n",
      ),
      ["| Позиция | Сумма |", "| --- | --- |", "| Лицензия | 750 000 ₽ |"].join(
        "\n",
      ),
    );
    const change = only(changes);
    expect(change.kind).toBe("replace");
    expect(change.nodeType).toBe("table-cell");
    expect(change.right?.table).toBe(1);
    expect(change.right?.row).toBe(1);
    expect(change.right?.column).toBe(1);
    expect(change.before).toBe("500 000 ₽");
    expect(change.after).toBe("750 000 ₽");
    expect(change.signals).toContain("MONEY_CHANGED");
  });

  test("an added table row is a row insertion", () => {
    const changes = compare(
      ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n"),
      ["| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"].join("\n"),
    );
    const change = only(changes);
    expect(change.kind).toBe("insert");
    expect(change.nodeType).toBe("table-row");
    expect(change.after).toBe("3 | 4");
  });

  test("a renamed heading is a heading replacement", () => {
    const change = only(
      compare("## Порядок оплаты\n\nТекст.\n", "## Сроки оплаты\n\nТекст.\n"),
    );
    expect(change.kind).toBe("replace");
    expect(change.nodeType).toBe("heading");
    expect(change.before).toBe("Порядок оплаты");
    expect(change.after).toBe("Сроки оплаты");
  });

  test("a punctuation change is a change", () => {
    const change = only(
      compare("Стороны согласовали условия.", "Стороны согласовали условия!"),
    );
    expect(change.kind).toBe("replace");
    expect(change.before).toBe("Стороны согласовали условия.");
    expect(change.after).toBe("Стороны согласовали условия!");
  });

  test("identical documents produce no changes", () => {
    const text = "# Договор\n\n## 1. Предмет\n\nТекст пункта.\n";
    expect(compare(text, text)).toEqual([]);
  });

  test("whitespace-only differences are ignored where the mode says so", () => {
    const left = "Оплата производится в течение 10 дней.";
    const right = "Оплата  производится\tв течение 10 дней.";
    expect(compare(left, right, { ignoreWhitespace: true })).toEqual([]);
    const changes = compare(left, right, { ignoreWhitespace: false });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("replace");
  });
});

describe("change records (§17)", () => {
  test("every change carries an id, a location, context and confidence", () => {
    const changes = compare(
      "# Договор\n\n## 5.2 Порядок оплаты\n\nОплата в течение 10 дней.\n",
      "# Договор\n\n## 5.2 Порядок оплаты\n\nОплата в течение 30 дней.\n",
    );
    const change = only(changes);
    expect(change.id).toMatch(/^chg_[0-9a-f]{12}$/u);
    expect(change.right).toMatchObject({
      part: "body",
      nodeIndex: 2,
      // Blocks are numbered in document order: two headings, then the text.
      paragraph: 3,
    });
    expect(change.right?.headingPath).toEqual([
      "Договор",
      "5.2 Порядок оплаты",
    ]);
    expect(change.context.headingPath).toEqual([
      "Договор",
      "5.2 Порядок оплаты",
    ]);
    expect(change.confidence).toBe(1);
  });

  test("a nearly identical pairing is trusted fully", () => {
    const change = only(compare("Срок — 10 дней.", "Срок — 30 дней."));
    expect(change.confidence).toBe(1);
  });

  test("confidence falls with the extraction quality", () => {
    const changes = diffDocuments(
      markdownDocument("Срок — 10 дней."),
      markdownDocument("Срок — 30 дней."),
      {
        leftSha: "l",
        rightSha: "r",
        detectMoves: true,
        ignoreWhitespace: true,
        ignoreFormatting: true,
        confidence: 0.6,
        checkBudget: () => undefined,
      },
    );
    expect(only(changes).confidence).toBeLessThanOrEqual(0.6);
  });

  test("ids are stable across runs and distinct across changes", () => {
    const left = "# Договор\n\nСрок 10 дней.\n\nСумма 100 ₽.\n";
    const right = "# Договор\n\nСрок 30 дней.\n\nСумма 200 ₽.\n";
    const first = compare(left, right);
    const second = compare(left, right);
    expect(first.map((change) => change.id)).toEqual(
      second.map((change) => change.id),
    );
    expect(new Set(first.map((change) => change.id)).size).toBe(first.length);
  });

  test("the change set is ordered by position in the revised document", () => {
    const changes = compare(
      "Первый.\n\nВторой.\n\nТретий.\n",
      "Первый!\n\nВторой.\n\nТретий!\n",
    );
    expect(changes.map((change) => change.right?.nodeIndex)).toEqual([0, 2]);
  });

  test("table changes stay inside their table and keep row order", () => {
    const changes = compare(
      ["| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"].join("\n"),
      ["| A | B |", "| --- | --- |", "| 1 | 2X |", "| 3X | 4 |"].join("\n"),
    );
    expect(changes.map((change) => change.nodeType)).toEqual([
      "table-cell",
      "table-cell",
    ]);
    expect(changes.map((change) => change.right?.row)).toEqual([1, 2]);
  });
});
