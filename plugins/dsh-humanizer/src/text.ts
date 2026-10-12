/** One prose group and the original separator that follows it. */
export interface TextChunk {
  readonly text: string;
  readonly separator: string;
}

/** Reject instead of truncating. Paragraph boundaries survive regrouping. */
export function splitDraft(text: string, maxBytes: number): TextChunk[] {
  if (/^[ \t]*(?:```|~~~)/mu.test(text)) {
    throw new TypeError(
      "UNSUPPORTED_FORMAT: pass prose without fenced code blocks.",
    );
  }
  const parts = text.trim().split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/u);
  const chunks: TextChunk[] = [];
  let current = "";
  let separator = "";
  for (let i = 0; i < parts.length; i += 2) {
    const paragraph = parts[i] ?? "";
    if (Buffer.byteLength(paragraph, "utf8") > maxBytes) {
      throw new RangeError(
        "PARAGRAPH_TOO_LARGE: shorten the paragraph or increase maxChunkBytes.",
      );
    }
    const combined = current + separator + paragraph;
    if (current && Buffer.byteLength(combined, "utf8") > maxBytes) {
      chunks.push({ text: current, separator });
      current = paragraph;
    } else current = combined;
    separator = parts[i + 1] ?? "";
  }
  if (current) chunks.push({ text: current, separator: "" });
  return chunks;
}

function counts(items: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) result.set(item, (result.get(item) ?? 0) + 1);
  return result;
}

function occurrences(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

/** Deliberately narrow heuristic: digit strings, separators and percentage sign. */
export function preservationWarnings(
  before: string,
  after: string,
  phrases: readonly string[],
): string[] {
  const pattern = /[+-]?\d+(?:[.,:/-]\d+)*(?:%|‰)?/gu;
  const a = counts(before.match(pattern) ?? []);
  const b = counts(after.match(pattern) ?? []);
  const warnings: string[] = [];
  if (
    [...new Set([...a.keys(), ...b.keys()])].some(
      (key) => a.get(key) !== b.get(key),
    )
  ) {
    warnings.push(
      "NUMBER_MISMATCH: number occurrence counts changed; compare with the draft.",
    );
  }
  if (
    phrases.some(
      (phrase) => occurrences(before, phrase) !== occurrences(after, phrase),
    )
  ) {
    warnings.push(
      "PROTECTED_PHRASE_MISMATCH: an exact protected phrase occurrence count changed.",
    );
  }
  if (
    (/\p{Script=Cyrillic}/u.test(before) &&
      !/\p{Script=Cyrillic}/u.test(after)) ||
    (!/\p{Script=Han}/u.test(before) &&
      /\p{Script=Latin}/u.test(before) &&
      /\p{Script=Han}/u.test(after))
  ) {
    warnings.push(
      "LANGUAGE_MISMATCH: the rewrite may have changed language; review it.",
    );
  }
  return warnings;
}
