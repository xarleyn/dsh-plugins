/**
 * The diff's promises, checked over generated documents (#422, the test
 * remainder of #296 item 1).
 *
 * The case-by-case tests answer "did it find this edit". These properties answer
 * the structural questions a hand-written pair cannot: whether the spans of a
 * change are a partition of the two texts rather than a decoration over them,
 * and whether an empty change set is really the same document rather than an
 * alignment that gave up.
 */

import { describe, expect, test } from "vitest";

import { diffDocuments } from "../src/documents/comparison/diff/block-diff.js";
import { buildCanonicalDocument } from "../src/documents/comparison/canonical/document-ir.js";
import type { CanonicalDocument } from "../src/documents/comparison/canonical/document-ir.js";
import type { DocumentChange } from "../src/documents/comparison/types.js";

import {
  canonicalFormOf,
  mutateDocument,
  randomDocument,
  seededRandom,
} from "./documents-comparison-roundtrip.helpers.js";

/** Pairs of documents; the card asks for 50 or more. */
const PAIRS = 64;
const SEED = 0x422e;

const random = seededRandom(SEED);

interface Pair {
  readonly index: number;
  readonly left: CanonicalDocument;
  readonly right: CanonicalDocument;
  readonly changes: readonly DocumentChange[];
}

function diffOf(
  left: CanonicalDocument,
  right: CanonicalDocument,
  index: number,
  options: { readonly ignoreFormatting?: boolean } = {},
): DocumentChange[] {
  return diffDocuments(left, right, {
    leftSha: `left-${index}`,
    rightSha: `right-${index}`,
    // The contract default (§5.1): whitespace and formatting are out of scope,
    // moves are in. Those are the options the artifact is written with.
    detectMoves: true,
    ignoreWhitespace: true,
    ignoreFormatting: options.ignoreFormatting ?? true,
    confidence: 1,
    checkBudget: () => undefined,
  });
}

const pairs: Pair[] = [];
for (let index = 0; index < PAIRS; index += 1) {
  const left = randomDocument(random);
  const right = mutateDocument(random, left);
  pairs.push({ index, left, right, changes: diffOf(left, right, index) });
}

describe("the generated corpus exercises both outcomes", () => {
  test("some pairs changed and some did not", () => {
    // Without this the properties below could hold vacuously: an all-empty
    // change set makes "spans reassemble" and "empty iff the forms match" true
    // for the wrong reason.
    expect(
      pairs.filter((pair) => pair.changes.length > 0).length,
      "pairs with at least one change",
    ).toBeGreaterThan(2);
    expect(
      pairs.filter((pair) => pair.changes.length === 0).length,
      "pairs with no change",
    ).toBeGreaterThan(0);
  });

  test("the corpus holds every change kind the diff can report", () => {
    const kinds = new Set(
      pairs.flatMap((pair) => pair.changes.map((c) => c.kind)),
    );
    expect([...kinds].sort()).toEqual(["delete", "insert", "move", "replace"]);
    expect(
      pairs.some((pair) =>
        pair.changes.some((change) => (change.spans?.length ?? 0) > 0),
      ),
      "at least one change carries spans",
    ).toBe(true);
  });
});

describe("the spans of a change reassemble the change", () => {
  test(`equal and deleted spans give the old text back (${PAIRS} pairs)`, () => {
    for (const pair of pairs) {
      for (const [at, change] of pair.changes.entries()) {
        const spans = change.spans;
        if (spans === undefined || spans.length === 0) continue;
        expect(
          spans
            .filter((span) => span.kind !== "insert")
            .map((span) => span.text)
            .join(""),
          `pair #${pair.index} change #${at} restores its own text`,
        ).toBe(change.before);
        expect(
          spans
            .filter((span) => span.kind !== "delete")
            .map((span) => span.text)
            .join(""),
          `pair #${pair.index} change #${at} restores the new text`,
        ).toBe(change.after);
        expect(
          spans.some((span) => span.kind !== "equal"),
          `pair #${pair.index} change #${at} is an edit, not a match`,
        ).toBe(true);
      }
    }
  });

  test("a change without spans is a move or a whole node, never a partial edit", () => {
    for (const pair of pairs) {
      for (const [at, change] of pair.changes.entries()) {
        if (change.spans !== undefined && change.spans.length > 0) continue;
        expect(
          ["insert", "delete", "move"],
          `pair #${pair.index} change #${at} (${change.kind}) carries no spans`,
        ).toContain(change.kind);
      }
    }
  });

  test.fails(
    "a formatting-only change describes its text with spans too",
    () => {
      // DEFECT (#422 run report): with formatting in scope, two nodes whose texts
      // fold to the same comparison key but whose formatting signatures differ are
      // reported as a `replace` with `spans: []` and a full `before`/`after`. The
      // engine's own rule is that the spans of a change reassemble both sides —
      // `token-diff` says so and every other kind honors it — so an empty array
      // reads as "there is nothing here" instead of "the whole text is equal". A
      // reader that rebuilds the two texts from the spans of `changes.jsonl`,
      // which is what §22 writes them for, gets two empty strings for a change
      // that names a paragraph. The change is right; its spans are not.
      const node = {
        id: "body:0",
        type: "paragraph" as const,
        part: "body" as const,
        path: [],
        rawText: "Текст пункта.",
        comparisonKey: "Текст пункта.",
        source: { paragraph: 1 },
      };
      const changes = diffDocuments(
        buildCanonicalDocument({
          kind: "native-docx",
          extractor: "native-docx",
          nodes: [{ ...node, formatting: "b" }],
        }),
        buildCanonicalDocument({
          kind: "native-docx",
          extractor: "native-docx",
          nodes: [{ ...node, formatting: "i" }],
        }),
        {
          leftSha: "left-formatting",
          rightSha: "right-formatting",
          detectMoves: true,
          ignoreWhitespace: true,
          ignoreFormatting: false,
          confidence: 1,
          checkBudget: () => undefined,
        },
      );
      expect(changes).toHaveLength(1);
      const change = changes[0] as DocumentChange;
      expect(change.signals).toContain("FORMATTING_CHANGED");
      expect(
        (change.spans ?? [])
          .filter((span) => span.kind !== "insert")
          .map((span) => span.text)
          .join(""),
      ).toBe(change.before);
    },
  );
});

describe("an empty change set means the same document", () => {
  test(`the diff is empty exactly when the canonical forms match (${PAIRS} pairs)`, () => {
    for (const pair of pairs) {
      const same =
        JSON.stringify(canonicalFormOf(pair.left)) ===
        JSON.stringify(canonicalFormOf(pair.right));
      expect(
        pair.changes.length === 0,
        `pair #${pair.index}: ${pair.changes.length} change(s), forms ${same ? "match" : "differ"}`,
      ).toBe(same);
    }
  });

  test("a document compared with itself never produces a change", () => {
    for (const pair of pairs) {
      expect(
        diffOf(pair.left, pair.left, pair.index),
        `pair #${pair.index} against itself`,
      ).toEqual([]);
    }
  });

  test("every change names the side it happened on and stays inside it", () => {
    for (const pair of pairs) {
      for (const [at, change] of pair.changes.entries()) {
        const label = `pair #${pair.index} change #${at} (${change.kind})`;
        expect(change.id, label).toMatch(/^chg_[0-9a-f]{12}$/u);
        expect(
          change.kind === "insert"
            ? change.left === undefined
            : change.left !== undefined,
          `${label} has the left side it claims`,
        ).toBe(true);
        expect(
          change.kind === "delete"
            ? change.right === undefined
            : change.right !== undefined,
          `${label} has the right side it claims`,
        ).toBe(true);
        for (const [side, location] of [
          ["left", change.left],
          ["right", change.right],
        ] as const) {
          if (location === undefined) continue;
          const nodes = (side === "left" ? pair.left : pair.right).nodes.filter(
            (node) => node.part === location.part,
          );
          expect(
            location.nodeIndex,
            `${label}: ${side} index inside its part`,
          ).toBeLessThan(nodes.length);
          // A row or a cell is located through the table it belongs to: the
          // index names the table node, the coordinates name the grid.
          const carrier =
            change.nodeType === "table-row" || change.nodeType === "table-cell"
              ? "table"
              : change.nodeType;
          expect(
            nodes[location.nodeIndex]?.type,
            `${label}: ${side} index names a ${carrier}`,
          ).toBe(carrier);
          if (change.nodeType === "table-cell") {
            expect(location.row, `${label} names its row`).toBeTypeOf("number");
            expect(location.column, `${label} names its column`).toBeTypeOf(
              "number",
            );
          }
        }
      }
    }
  });

  test("the same two documents always give the same change set", () => {
    for (const pair of pairs) {
      expect(
        diffOf(pair.left, pair.right, pair.index),
        `pair #${pair.index} re-diffed`,
      ).toEqual([...pair.changes]);
    }
  });
});
