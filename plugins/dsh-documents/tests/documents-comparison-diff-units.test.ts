import { describe, expect, test } from "vitest";

import { buildCanonicalDocument } from "../src/documents/comparison/canonical/document-ir.js";
import { detectSignals } from "../src/documents/comparison/signals/index.js";
import { diffTokens } from "../src/documents/comparison/diff/token-diff.js";
import { tokenize } from "../src/documents/comparison/canonical/tokenizer.js";
import { normalizeForComparison } from "../src/documents/comparison/canonical/normalize.js";
import { similarityOf } from "../src/documents/comparison/alignment/similarity.js";
import { diffDocuments } from "../src/documents/comparison/diff/block-diff.js";

import { compare, only } from "./documents-comparison-diff.helpers.js";

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
