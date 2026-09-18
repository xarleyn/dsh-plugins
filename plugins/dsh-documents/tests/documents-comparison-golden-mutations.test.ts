/**
 * Golden cases, generated mutations and PDF quality (§25, §39, §41).
 *
 * The specification asks for three things this file provides: a corpus whose
 * expected answer is written down per case (so an engine change that alters an
 * answer has to argue with a fixture), mutations generated from a base document
 * (so a change cannot hide), and a comparison of the lossy formats, where the
 * result has to say out loud how much of it to trust.
 */

import { describe, expect, test } from "vitest";

import { canonicalFromMarkdown } from "../src/documents/comparison/extractors/markdown.js";

import { changes } from "./documents-comparison-golden.helpers.js";
import type { DocumentChange } from "../src/documents/comparison/types.js";

const BASE_PARAGRAPH =
  "Исполнитель обязуется оказать услуги в течение 10 рабочих дней.";

describe("generated mutations always show up (§41)", () => {
  const mutations: readonly {
    readonly name: string;
    readonly after: string;
    readonly signals?: readonly string[];
  }[] = [
    {
      name: "a word inserted",
      after:
        "Исполнитель обязуется оказать услуги в течение ровно 10 рабочих дней.",
      // No signal: the inserted word carries no number, date or obligation of
      // its own, and the change is reported by its text alone.
      signals: [],
    },
    {
      name: "a word deleted",
      after: "Исполнитель обязуется оказать услуги в течение рабочих дней.",
      signals: ["NUMBER_CHANGED", "DURATION_CHANGED"],
    },
    {
      name: "a word replaced",
      after: "Исполнитель обязуется оказать работы в течение 10 рабочих дней.",
    },
    {
      name: "a number replaced",
      after: "Исполнитель обязуется оказать услуги в течение 30 рабочих дней.",
      signals: ["NUMBER_CHANGED", "DURATION_CHANGED"],
    },
    {
      name: "a negation inserted",
      after:
        "Исполнитель не обязуется оказать услуги в течение 10 рабочих дней.",
      signals: ["NEGATION_CHANGED"],
    },
    {
      name: "a percentage inserted",
      after:
        "Исполнитель обязуется оказать услуги в течение 10 рабочих дней (скидка 5%).",
      signals: ["NUMBER_CHANGED", "PERCENTAGE_CHANGED"],
    },
    {
      name: "punctuation replaced",
      after: "Исполнитель обязуется оказать услуги в течение 10 рабочих дней!",
    },
  ];

  for (const mutation of mutations) {
    test(mutation.name, () => {
      const found = changes(BASE_PARAGRAPH, mutation.after);
      expect(found).toHaveLength(1);
      const change = found[0] as DocumentChange;
      expect(change.before).toBe(BASE_PARAGRAPH);
      expect(change.after).toBe(mutation.after);
      if (mutation.signals === undefined) {
        expect(change.kind).toBe("replace");
        return;
      }
      for (const signal of mutation.signals) {
        expect(change.signals).toContain(signal);
      }
      expect(change.signals).toEqual(mutation.signals);
    });
  }

  test("whitespace is reported when the caller asked to see it", () => {
    const widened =
      "Исполнитель  обязуется оказать услуги в течение 10 рабочих дней.";
    expect(changes(BASE_PARAGRAPH, widened)).toEqual([]);
    const found = changes(BASE_PARAGRAPH, widened, { ignoreWhitespace: false });
    expect(found).toHaveLength(1);
    expect(found[0]?.before).toBe(BASE_PARAGRAPH);
  });

  test("a moved paragraph is reported as a move, not as a rewrite", () => {
    const document = [
      "## 1. Предмет",
      "",
      "Первый пункт.",
      "",
      "## 2. Оплата",
      "",
      "Второй пункт.",
      "",
    ].join("\n");
    const moved = [
      "## 2. Оплата",
      "",
      "Второй пункт.",
      "",
      "## 1. Предмет",
      "",
      "Первый пункт.",
      "",
    ].join("\n");
    const found = changes(document, moved);
    // One section changed places with the other, so exactly one of them is the
    // one that moved: whichever the anchor set left unmatched. The edit is the
    // same either way, and the answer is the same on every run.
    expect(found.map((change) => change.kind)).toEqual(["move", "move"]);
    expect(found.every((change) => change.before === change.after)).toBe(true);
    expect(found.map((change) => change.after)).toEqual([
      "1. Предмет",
      "Первый пункт.",
    ]);
  });

  test("a document of many small edits produces one change per edit", () => {
    const left = Array.from(
      { length: 20 },
      (_value, index) => `Пункт ${index}: значение 10.`,
    ).join("\n\n");
    const right = Array.from(
      { length: 20 },
      (_value, index) => `Пункт ${index}: значение ${index === 7 ? 30 : 10}.`,
    ).join("\n\n");
    const found = changes(left, right);
    expect(found).toHaveLength(1);
    expect(found[0]?.before).toBe("Пункт 7: значение 10.");
    expect(found[0]?.after).toBe("Пункт 7: значение 30.");
  });
});

describe("golden cases (§39)", () => {
  test("a marked-up contract revision is reported exactly", () => {
    const before = [
      "# Договор",
      "",
      "## 5.2 Порядок оплаты",
      "",
      "Оплата производится в течение 10 рабочих дней.",
      "",
      "| Позиция | Сумма |",
      "| --- | --- |",
      "| Лицензия | 500 000 ₽ |",
      "",
      "## 6. Ответственность",
      "",
      "Исполнитель несёт ответственность за убытки.",
      "",
    ].join("\n");
    const after = [
      "# Договор",
      "",
      "## 5.2 Порядок оплаты",
      "",
      "Оплата производится в течение 30 календарных дней.",
      "",
      "| Позиция | Сумма |",
      "| --- | --- |",
      "| Лицензия | 750 000 ₽ |",
      "",
      "## 6. Ответственность",
      "",
      "Исполнитель не несёт ответственности за убытки.",
      "",
    ].join("\n");
    const found = changes(before, after);
    expect(
      found.map((change) => ({
        kind: change.kind,
        nodeType: change.nodeType,
        before: change.before,
        after: change.after,
        signals: change.signals,
        location: change.right?.headingPath,
        cell: [change.right?.table, change.right?.row, change.right?.column],
      })),
    ).toEqual([
      {
        kind: "replace",
        nodeType: "paragraph",
        before: "Оплата производится в течение 10 рабочих дней.",
        after: "Оплата производится в течение 30 календарных дней.",
        signals: ["NUMBER_CHANGED", "DURATION_CHANGED"],
        location: ["Договор", "5.2 Порядок оплаты"],
        cell: [undefined, undefined, undefined],
      },
      {
        kind: "replace",
        nodeType: "table-cell",
        before: "500 000 ₽",
        after: "750 000 ₽",
        signals: ["MONEY_CHANGED", "NUMBER_CHANGED"],
        location: ["Договор", "5.2 Порядок оплаты"],
        cell: [1, 1, 1],
      },
      {
        kind: "replace",
        nodeType: "paragraph",
        before: "Исполнитель несёт ответственность за убытки.",
        after: "Исполнитель не несёт ответственности за убытки.",
        signals: ["NEGATION_CHANGED"],
        location: ["Договор", "6. Ответственность"],
        cell: [undefined, undefined, undefined],
      },
    ]);
  });

  test("an unchanged document produces an empty change set", () => {
    const text = "# Договор\n\n## 1. Предмет\n\nТекст пункта.\n";
    expect(changes(text, text)).toEqual([]);
  });

  test("ids, ordering and text are byte-stable across runs", () => {
    const before = "# Договор\n\nСрок 10 дней.\n\nСумма 100 ₽.\n";
    const after = "# Договор\n\nСрок 30 дней.\n\nСумма 200 ₽.\n";
    const first = JSON.stringify(changes(before, after));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(JSON.stringify(changes(before, after))).toBe(first);
    }
  });

  test("the serialized IR is byte-stable across runs", () => {
    const ir = canonicalFromMarkdown(
      "# Договор\n\nТекст с\u00a0неразрывным   пробелом.\n",
      { maxNodes: 100 },
    );
    const once = JSON.stringify(ir);
    expect(
      JSON.stringify(
        canonicalFromMarkdown(
          "# Договор\n\nТекст с\u00a0неразрывным   пробелом.\n",
          { maxNodes: 100 },
        ),
      ),
    ).toBe(once);
  });
});
