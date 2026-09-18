import type { DocumentChange } from "../src/documents/comparison/types.js";
import { canonicalFromMarkdown } from "../src/documents/comparison/extractors/markdown.js";
import { diffDocuments } from "../src/documents/comparison/diff/block-diff.js";

export function changes(
  before: string,
  after: string,
  options: { readonly ignoreWhitespace?: boolean } = {},
): DocumentChange[] {
  return diffDocuments(
    canonicalFromMarkdown(before, { maxNodes: 1_000 }),
    canonicalFromMarkdown(after, { maxNodes: 1_000 }),
    {
      leftSha: "left",
      rightSha: "right",
      detectMoves: true,
      ignoreWhitespace: options.ignoreWhitespace ?? true,
      ignoreFormatting: true,
      confidence: 1,
      checkBudget: () => undefined,
    },
  );
}
