/**
 * The normalized side is a re-readable document, not a debug printout (#422,
 * the test remainder of #296 item 1).
 *
 * `writeComparisonArtifact` hands `normalized/<side>.json` to anyone who wants
 * to see what the comparison actually read, and the determinism claim of §22
 * rests on that file being reproducible. So the IR has to survive the trip out
 * of the process: serialize, parse, re-build through `buildCanonicalDocument`,
 * and the document a later run derives from the file must be the same document
 * — same nodes, same counts, and the same alignment keys.
 */

import { describe, expect, test } from "vitest";

import {
  buildCanonicalDocument,
  serializeCanonicalDocument,
  strongKeyOf,
} from "../src/documents/comparison/canonical/document-ir.js";
import type {
  BuildCanonicalDocumentInput,
  CanonicalDocument,
} from "../src/documents/comparison/canonical/document-ir.js";
import { comparisonKeyOf } from "../src/documents/comparison/canonical/normalize.js";

import {
  randomDocument,
  seededRandom,
} from "./documents-comparison-roundtrip.helpers.js";

const CORPUS = 200;
const SEED = 0x422d;

const random = seededRandom(SEED);
const corpus: CanonicalDocument[] = [];
for (let index = 0; index < CORPUS; index += 1) {
  corpus.push(randomDocument(random));
}

/**
 * Read a serialized document back through the same door the extractor used:
 * the file holds a node list, and `buildCanonicalDocument` derives everything
 * a node list implies.
 */
function reread(serialized: string): CanonicalDocument {
  const shape = JSON.parse(serialized) as {
    kind: BuildCanonicalDocumentInput["kind"];
    extractor: string;
    ocrUsed: boolean;
    warnings: BuildCanonicalDocumentInput["warnings"];
    nodes: BuildCanonicalDocumentInput["nodes"];
  };
  return buildCanonicalDocument({
    kind: shape.kind,
    extractor: shape.extractor,
    ocrUsed: shape.ocrUsed,
    nodes: shape.nodes,
    ...(shape.warnings === undefined ? {} : { warnings: shape.warnings }),
  });
}

describe("the canonical roundtrip", () => {
  test(`every node survives serialize → parse → rebuild (${CORPUS} documents)`, () => {
    for (const [index, document] of corpus.entries()) {
      const again = reread(serializeCanonicalDocument(document));
      expect(again.nodes, `nodes of document #${index}`).toEqual(
        document.nodes,
      );
    }
  });

  test("the alignment key of every node is unchanged by the roundtrip", () => {
    for (const [index, document] of corpus.entries()) {
      const again = reread(serializeCanonicalDocument(document));
      expect(
        again.nodes.map((node) => strongKeyOf(node)),
        `strong keys of document #${index}`,
      ).toEqual(document.nodes.map((node) => strongKeyOf(node)));
    }
  });

  test("the counts a re-built document reports are the counts it was built from", () => {
    for (const [index, document] of corpus.entries()) {
      const again = reread(serializeCanonicalDocument(document));
      expect(again.counts, `counts of document #${index}`).toEqual(
        document.counts,
      );
    }
  });

  test("the normalized file is byte-identical when it is written twice", () => {
    for (const [index, document] of corpus.entries()) {
      const first = serializeCanonicalDocument(document);
      expect(
        serializeCanonicalDocument(reread(first)),
        `bytes of document #${index}`,
      ).toBe(first);
    }
  });

  test("the roundtrip keeps the document's own identity", () => {
    for (const [index, document] of corpus.entries()) {
      const again = reread(serializeCanonicalDocument(document));
      expect(
        [again.kind, again.extractor, again.ocrUsed],
        `identity #${index}`,
      ).toEqual([document.kind, document.extractor, document.ocrUsed]);
    }
  });

  test.fails("a warning survives the roundtrip whole, details included", () => {
    // DEFECT (#422 run report): `serializeCanonicalDocument` maps a warning to
    // `{code, message, backend}` and drops `details`, which is the field the
    // docx extractor puts the tracked-revision count in. Every other part of
    // the IR is written whole, so `normalized/<side>.json` is not a faithful
    // copy of what the comparison read. The count is lost on the way to disk.
    const withDetails = corpus.filter((document) =>
      document.warnings.some((warning) => warning.details !== undefined),
    );
    expect(
      withDetails.length,
      "the corpus holds a warning with details",
    ).toBeGreaterThan(0);
    for (const document of withDetails) {
      expect(reread(serializeCanonicalDocument(document)).warnings).toEqual(
        document.warnings,
      );
    }
  });
});

describe("comparisonKeyOf as a fixed point", () => {
  test("folding an already folded text changes nothing", () => {
    // The IR stores the key next to the text; if folding were not idempotent,
    // re-keying a re-read document would move the keys and alignment would
    // differ between two runs over the same file.
    for (const [index, document] of corpus.entries()) {
      for (const [nodeIndex, node] of document.nodes.entries()) {
        const once = comparisonKeyOf(node.rawText);
        expect(
          comparisonKeyOf(once),
          `document #${index} node #${nodeIndex}`,
        ).toBe(once);
      }
    }
  });

  test("the stored key is the key of the text it was derived from", () => {
    for (const [index, document] of corpus.entries()) {
      for (const node of document.nodes) {
        expect(node.comparisonKey, `document #${index} node ${node.id}`).toBe(
          comparisonKeyOf(node.rawText),
        );
      }
    }
  });

  test("a table row and its cells carry the keys their text gives them", () => {
    for (const [index, document] of corpus.entries()) {
      for (const node of document.nodes) {
        for (const row of node.table?.rows ?? []) {
          expect(row.comparisonKey, `document #${index} row ${row.row}`).toBe(
            comparisonKeyOf(row.rawText),
          );
          expect(row.rawText).toBe(
            row.cells.map((cell) => cell.rawText).join(" | "),
          );
        }
      }
    }
  });
});
