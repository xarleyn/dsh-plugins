/**
 * Text extraction from a tool result's content blocks (result-shaping SPEC
 * §13).
 *
 * The shaper only ever rewrites text. Non-text blocks (images, files, tool
 * results) are preserved in place and in order, and a result whose text cannot
 * be rebuilt unambiguously — several text blocks interleaved with non-text
 * ones — is skipped entirely rather than guessed at.
 */

/** Structural view of a content block (avoids a `dsh-llm` peer). */
export interface ContentBlockLike {
  readonly type: string;
  readonly text?: unknown;
}

/**
 * How the extracted text maps back onto the content array:
 *
 * - `single`: exactly one text block, whatever surrounds it — the shaped text
 *   replaces that block and every other block keeps its position;
 * - `uniform`: every block is text — the shaped text replaces them with one
 *   text block at the first one's position (concatenation is unambiguous, and
 *   it is what the model reads either way).
 */
export type TextLayout = "single" | "uniform";

export interface ExtractedText {
  readonly text: string;
  readonly layout: TextLayout;
}

function isTextBlock<T extends ContentBlockLike>(
  block: T,
): block is T & { text: string } {
  return block.type === "text" && typeof block.text === "string";
}

/**
 * Extract the model-facing text of a result, or `undefined` when the result is
 * not shapeable at all (no text, or an ambiguous mix of text and non-text).
 */
export function extractText<T extends ContentBlockLike>(
  content: readonly T[],
): ExtractedText | undefined {
  const textIndices: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    if (isTextBlock(content[index]!)) textIndices.push(index);
  }
  if (textIndices.length === 0) return undefined;

  const text = textIndices
    .map((index) => (content[index] as { text: string }).text)
    .join("\n");

  if (textIndices.length === content.length) return { text, layout: "uniform" };
  // Mixed content: only a single text block can be rebuilt without inventing a
  // block structure that the original never had.
  if (textIndices.length === 1) return { text, layout: "single" };
  return undefined;
}

/**
 * Rebuild the content array with `replacement` in the text position(s) the
 * layout allows. Returns a new array; the input is never mutated.
 */
export function replaceText<T extends ContentBlockLike>(
  content: readonly T[],
  extracted: ExtractedText,
  replacement: string,
): T[] {
  if (extracted.layout === "single") {
    return content.map((block) =>
      isTextBlock(block) ? ({ ...block, text: replacement } as T) : block,
    );
  }
  const rebuilt: T[] = [];
  let placed = false;
  for (const block of content) {
    if (!isTextBlock(block)) continue;
    if (!placed) {
      rebuilt.push({ type: "text", text: replacement } as T);
      placed = true;
    }
  }
  return rebuilt;
}

/** True when the content carries at least one text block. */
export function hasText(content: readonly ContentBlockLike[]): boolean {
  return content.some(isTextBlock);
}
