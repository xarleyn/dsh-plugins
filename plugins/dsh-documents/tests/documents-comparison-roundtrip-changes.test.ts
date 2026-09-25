/**
 * The change line is a contract, not a dump (#422, the test remainder of #296
 * item 1).
 *
 * `writeComparisonArtifact` puts one serialized change per line of
 * `changes.jsonl`, and `document_diff_read` parses those lines back pages at a
 * time. Both halves live in different modules and only the file joins them, so
 * the pair is tested as a pair: whatever the writer emits for a change, the
 * reader must give that change back — a change, not the field subset one of the
 * two modules happens to name.
 */

import { describe, expect, test } from "vitest";

import {
  serializeChange,
  serializeLocation,
} from "../src/documents/comparison/artifact/writer.js";
import { parseChange } from "../src/documents/comparison/artifact/reader.js";
import { diffDocuments } from "../src/documents/comparison/diff/block-diff.js";
import type { DocumentChange } from "../src/documents/comparison/types.js";

import {
  mutateDocument,
  randomChange,
  randomDocument,
  seededRandom,
} from "./documents-comparison-roundtrip.helpers.js";

/** Changes per property; a fixed seed keeps a failure reproducible by seed. */
const CORPUS = 400;
const SEED = 0x422c;

const random = seededRandom(SEED);
const corpus: DocumentChange[] = [];
for (let index = 0; index < CORPUS; index += 1) {
  corpus.push(randomChange(random));
}

/** The keys `serializeChange` writes, in the order it writes them. */
function expectedKeys(change: DocumentChange): string[] {
  return [
    "id",
    "kind",
    "nodeType",
    ...(change.left === undefined ? [] : ["left"]),
    ...(change.right === undefined ? [] : ["right"]),
    ...(change.before === undefined ? [] : ["before"]),
    ...(change.after === undefined ? [] : ["after"]),
    ...(change.spans === undefined ? [] : ["spans"]),
    "context",
    "signals",
    "confidence",
  ];
}

describe("serializeChange against parseChange", () => {
  test(`a change survives the line roundtrip (${CORPUS} generated changes)`, () => {
    for (const [index, change] of corpus.entries()) {
      const parsed = parseChange(serializeChange(change));
      expect(parsed, `change #${index} (${change.kind})`).toEqual(change);
    }
  });

  test("the serialized form carries exactly the fields the change has", () => {
    for (const [index, change] of corpus.entries()) {
      const raw = JSON.parse(serializeChange(change)) as Record<
        string,
        unknown
      >;
      expect(Object.keys(raw), `field set of change #${index}`).toEqual(
        expectedKeys(change),
      );
    }
  });

  test("serialization is byte-stable, so a rerun hashes to the same file", () => {
    for (const [index, change] of corpus.entries()) {
      expect(
        serializeChange(structuredClone(change)),
        `bytes of change #${index}`,
      ).toBe(serializeChange(change));
    }
  });

  test("a change never spans two lines, whatever its text holds", () => {
    // The corpus text includes a raw newline, U+2028 and a NUL: a serializer
    // that let any of them through unescaped would split one change into two
    // lines, and the reader would then page over a change set that no longer
    // matches the `changes` count in the manifest.
    const lines = corpus.map(serializeChange);
    for (const [index, line] of lines.entries()) {
      expect(line, `line ${index} is a line`).not.toMatch(/[\n\r]/u);
    }
    const framed = `${lines.join("\n")}\n`;
    const read = framed
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map(parseChange);
    expect(read).toEqual(corpus);
  });

  test("a change the diff itself produced survives the same roundtrip", () => {
    // The generated corpus covers shapes; this covers what the engine actually
    // emits, so a field the serializer forgets cannot hide behind a field the
    // generator never sets.
    const engine = seededRandom(SEED + 7);
    const produced: DocumentChange[] = [];
    for (let pair = 0; pair < 60; pair += 1) {
      const left = randomDocument(engine);
      const right = mutateDocument(engine, left);
      produced.push(
        ...diffDocuments(left, right, {
          leftSha: `left-${pair}`,
          rightSha: `right-${pair}`,
          detectMoves: true,
          ignoreWhitespace: true,
          ignoreFormatting: true,
          confidence: 1,
          checkBudget: () => undefined,
        }),
      );
    }
    expect(produced.length).toBeGreaterThan(0);
    for (const [index, change] of produced.entries()) {
      expect(
        parseChange(serializeChange(change)),
        `engine change #${index} (${change.kind})`,
      ).toEqual(change);
    }
  });
});

describe("serializeLocation", () => {
  test("a location survives the JSON roundtrip with its fields intact", () => {
    for (const [index, change] of corpus.entries()) {
      for (const side of ["left", "right"] as const) {
        const location = change[side];
        if (location === undefined) continue;
        const raw = JSON.parse(
          JSON.stringify(serializeLocation(location)),
        ) as Record<string, unknown>;
        expect(raw, `location of change #${index}`).toEqual(location);
      }
    }
  });

  test("the location fields keep their fixed order", () => {
    const location = {
      part: "body" as const,
      nodeIndex: 3,
      headingPath: ["Раздел 1"],
      paragraph: 9,
      page: 2,
      table: 1,
      row: 4,
      column: 2,
      xmlPath: "word/document2.xml",
    };
    expect(Object.keys(serializeLocation(location))).toEqual([
      "part",
      "nodeIndex",
      "headingPath",
      "paragraph",
      "page",
      "table",
      "row",
      "column",
      "xmlPath",
    ]);
  });

  test("a location without source coordinates names no empty keys", () => {
    const location = {
      part: "comment" as const,
      nodeIndex: 0,
      headingPath: [] as string[],
    };
    expect(Object.keys(serializeLocation(location))).toEqual([
      "part",
      "nodeIndex",
      "headingPath",
    ]);
    const change: DocumentChange = {
      id: "chg_test",
      kind: "delete",
      nodeType: "comment",
      left: location,
      before: "",
      context: { headingPath: [] },
      signals: [],
      confidence: 1,
    };
    expect(parseChange(serializeChange(change)).left).toEqual(location);
  });
});
