/**
 * Unicode-aware deterministic tokenizer (§14).
 *
 * The token level is where a change becomes readable — "10 рабочих" →
 * "30 календарных" is one replacement, not two paragraphs — so tokenization
 * decides what the model gets to see. It is done by rule, in this process, with
 * the offsets kept: no model, no locale, no third-party segmenter whose
 * version would change the answer.
 *
 * Four classes are enough for the documents this pipeline handles:
 *
 * ```text
 * word      letters, with internal joins      договор, day-to-day, «не»
 * number    digits, with internal separators  30, 0.5, 1 000 000, 5-10
 * space     runs of whitespace                "   "
 * punct     punctuation and every other mark  % , . ₽ - « »
 * ```
 *
 * A token's `start`/`end` are code-unit offsets into the original string, so a
 * span computed on tokens can be reported against `rawText` without any
 * re-derivation.
 */

export type TokenKind = "word" | "number" | "space" | "punct";

export interface TextToken {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly kind: TokenKind;
}

/**
 * One pass, longest match first:
 *
 * 1. whitespace run;
 * 2. number with internal separators (`.`, `,`, `-`, `/` — a thin space is not
 *    folded in, so `1 000` tokenizes as `1`, ` `, `000`, which is how a reader
 *    sees an edit to either part);
 * 3. word: letters with combining marks, joined internally by `-`, `'`, `’` or
 *    `_` when a letter or digit follows;
 * 4. any other single code point.
 */
const TOKEN_PATTERN =
  /(\s+)|(\p{N}+(?:[.,\-/]\p{N}+)*)|(\p{L}[\p{L}\p{M}]*(?:[-'\u2019_][\p{L}\p{M}\p{N}]+)*)|([\s\S])/gu;

export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const value = match[0];
    const start = match.index;
    tokens.push({
      text: value,
      start,
      end: start + value.length,
      kind: classify(match),
    });
  }
  return tokens;
}

/** The alternation group that matched decides the class. */
function classify(match: RegExpMatchArray): TokenKind {
  if (match[1] !== undefined) return "space";
  if (match[2] !== undefined) return "number";
  if (match[3] !== undefined) return "word";
  return "punct";
}

/** Whether the token carries anything a reader would notice. */
export function isSignificantToken(token: TextToken): boolean {
  return token.kind !== "space";
}

/** Tokens that take part in similarity: whitespace and case folded away. */
export function significantTokens(text: string): string[] {
  return tokenize(text)
    .filter(isSignificantToken)
    .map((token) => token.text.toLowerCase());
}

/** Whether a stretch of text is nothing but whitespace. */
export function isWhitespaceOnly(text: string): boolean {
  return text.trim() === "";
}
