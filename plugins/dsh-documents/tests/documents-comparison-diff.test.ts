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

import type { CanonicalDocument } from "../src/documents/comparison/canonical/document-ir.js";
import { buildCanonicalDocument } from "../src/documents/comparison/canonical/document-ir.js";
import { canonicalFromMarkdown } from "../src/documents/comparison/extractors/markdown.js";
import { diffDocuments } from "../src/documents/comparison/diff/block-diff.js";
import { detectSignals } from "../src/documents/comparison/signals/index.js";
import { diffTokens } from "../src/documents/comparison/diff/token-diff.js";
import { tokenize } from "../src/documents/comparison/canonical/tokenizer.js";
import { normalizeForComparison } from "../src/documents/comparison/canonical/normalize.js";
import { similarityOf } from "../src/documents/comparison/alignment/similarity.js";
import type { DocumentChange } from "../src/documents/comparison/types.js";

const MAX_NODES = 10_000;

function markdownDocument(text: string): CanonicalDocument {
  return canonicalFromMarkdown(text, { maxNodes: MAX_NODES });
}

function compare(
  left: string,
  right: string,
  options: {
    detectMoves?: boolean;
    ignoreWhitespace?: boolean;
    ignoreFormatting?: boolean;
    confidence?: number;
  } = {},
): DocumentChange[] {
  return diffDocuments(markdownDocument(left), markdownDocument(right), {
    leftSha: "left-sha",
    rightSha: "right-sha",
    detectMoves: options.detectMoves ?? true,
    ignoreWhitespace: options.ignoreWhitespace ?? true,
    ignoreFormatting: options.ignoreFormatting ?? true,
    confidence: options.confidence ?? 1,
    checkBudget: () => undefined,
  });
}

function only(changes: readonly DocumentChange[]): DocumentChange {
  expect(changes).toHaveLength(1);
  return changes[0] as DocumentChange;
}

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

describe("token diff (§14)", () => {
  test("spans reassemble each side exactly, minus the other side's edits", () => {
    const left = "Оплата производится в течение 10 рабочих дней.";
    const right = "Оплата производится в течение 30 календарных дней.";
    const changes = only(compare(left, right));
    const spans = changes.spans ?? [];
    // Equal and inserted spans make up the revised text; equal and deleted
    // spans make up the original one. Nothing is lost and nothing is invented.
    expect(
      spans
        .filter((span) => span.kind !== "delete")
        .map((span) => span.text)
        .join(""),
    ).toBe(right);
    expect(
      spans
        .filter((span) => span.kind !== "insert")
        .map((span) => span.text)
        .join(""),
    ).toBe(left);
  });

  test("the diff is deterministic for the same inputs", () => {
    const left = tokenize("a b c d e f");
    const right = tokenize("a c x e f g");
    const first = diffTokens(
      left.map((token) => token.text),
      right.map((token) => token.text),
    );
    const second = diffTokens(
      left.map((token) => token.text),
      right.map((token) => token.text),
    );
    expect(first).toEqual(second);
  });

  test("a pathological pair still produces a whole-text replacement", () => {
    const left = Array.from(
      { length: 2_500 },
      (_value, index) => `L${index}`,
    ).join(" ");
    const right = Array.from(
      { length: 2_500 },
      (_value, index) => `R${index}`,
    ).join(" ");
    const spans = diffTokens(
      tokenize(left).map((token) => token.text),
      tokenize(right).map((token) => token.text),
    );
    expect(spans.some((span) => span.kind === "delete")).toBe(true);
    expect(spans.some((span) => span.kind === "insert")).toBe(true);
  });
});

describe("tokenizer and normalization (§9)", () => {
  test("words keep their internal joins", () => {
    const kinds = tokenize("day-to-day 10.5 «не»").map((token) => token.kind);
    expect(kinds).toEqual([
      "word",
      "space",
      "number",
      "space",
      "punct",
      "word",
      "punct",
    ]);
  });

  test("normalization folds representation, never meaning", () => {
    expect(normalizeForComparison("Оплата\u00a0производится   в течение")).toBe(
      "Оплата производится в течение",
    );
    expect(normalizeForComparison("не обязан")).toBe("не обязан");
    expect(normalizeForComparison("10 %")).not.toBe(
      normalizeForComparison("1 %"),
    );
  });

  test("similarity separates an edit from a replacement", () => {
    expect(
      similarityOf(
        "Оплата производится в течение 10 рабочих дней.",
        "Оплата производится в течение 30 рабочих дней.",
      ),
    ).toBeGreaterThan(0.6);
    expect(
      similarityOf(
        "Оплата производится в течение 10 рабочих дней.",
        "Стороны несут ответственность за убытки.",
      ),
    ).toBeLessThan(0.2);
  });
});

describe("signals (§18)", () => {
  test("signals are ordered canonically, not by detection", () => {
    const signals = detectSignals({
      before: "Срок 10 дней, сумма 100 ₽.",
      after: "Срок 30 дней, сумма 200 $.",
    });
    expect(signals.indexOf("MONEY_CHANGED")).toBeLessThan(
      signals.indexOf("NUMBER_CHANGED"),
    );
    expect(signals.indexOf("NUMBER_CHANGED")).toBeLessThan(
      signals.indexOf("DURATION_CHANGED"),
    );
  });

  test("an obligation turning into a permission is a vocabulary change", () => {
    const signals = detectSignals({
      before: "Исполнитель обязан устранить недостатки.",
      after: "Исполнитель вправе устранить недостатки.",
    });
    expect(signals).toContain("OBLIGATION_TERM_CHANGED");
    expect(signals).toContain("PERMISSION_TERM_CHANGED");
    expect(signals).not.toContain("LIABILITY_TERM_CHANGED");
  });

  test("a party swap is a party reference change", () => {
    const signals = detectSignals({
      before: "Заказчик обеспечивает доступ.",
      after: "Исполнитель обеспечивает доступ.",
    });
    expect(signals).toContain("PARTY_REFERENCE_CHANGED");
  });

  test("liability vocabulary is detected", () => {
    const signals = detectSignals({
      before: "Ответственность сторон ограничена.",
      after:
        "Ответственность сторон ограничена; штраф за просрочку — 0,1% в день.",
    });
    expect(signals).toContain("LIABILITY_TERM_CHANGED");
    expect(signals).toContain("PERCENTAGE_CHANGED");
  });

  test("an unreachable edit produces no signals", () => {
    expect(
      detectSignals({ before: "Текст пункта.", after: "Текст пункта." }),
    ).toEqual([]);
  });
});

describe("empty and degenerate documents", () => {
  test("both sides empty is not a change", () => {
    expect(compare("", "")).toEqual([]);
  });

  test("an empty side makes every node an insertion", () => {
    const changes = compare("", "Первый.\n\nВторой.\n");
    expect(changes.map((change) => change.kind)).toEqual(["insert", "insert"]);
  });

  test("formatting signatures are compared only when asked for", () => {
    const left = buildCanonicalDocument({
      kind: "native-docx",
      extractor: "native-docx",
      nodes: [
        {
          id: "body:0",
          type: "paragraph",
          part: "body",
          path: [],
          rawText: "Текст.",
          comparisonKey: "Текст.",
          source: {},
          formatting: "b",
        },
      ],
    });
    const right = buildCanonicalDocument({
      kind: "native-docx",
      extractor: "native-docx",
      nodes: [
        {
          id: "body:0",
          type: "paragraph",
          part: "body",
          path: [],
          rawText: "Текст.",
          comparisonKey: "Текст.",
          source: {},
          formatting: "i",
        },
      ],
    });
    const context = {
      leftSha: "l",
      rightSha: "r",
      detectMoves: true,
      ignoreWhitespace: true,
      checkBudget: () => undefined,
      confidence: 1,
    };
    expect(
      diffDocuments(left, right, { ...context, ignoreFormatting: true }),
    ).toEqual([]);
    const changes = diffDocuments(left, right, {
      ...context,
      ignoreFormatting: false,
    });
    expect(only(changes).signals).toContain("FORMATTING_CHANGED");
  });
});
