/**
 * Numeric, monetary and temporal signals (§18, §28).
 *
 * A contract is mostly numbers wearing words, and the whole point of this
 * layer is that it never normalizes one away: `0.1 %` and `1 %` differ, `10
 * рабочих дней` and `30 календарных дней` differ, `₽` and `$` differ — and the
 * signal says which *kind* of thing moved, not how much it matters.
 *
 * Each detector extracts a set of features from a text and compares the two
 * sets. Sets, not counts: a paragraph that says the same thing twice says the
 * same thing, and a feature that appears on both sides has not changed. The
 * output is sorted, so a signal list never encodes the order in which a
 * regular expression happened to match.
 */

const NUMBER_PATTERN = /\p{N}+(?:[.,\-/]\p{N}+)*/gu;
const PERCENT_PATTERN =
  /(\p{N}+(?:[.,]\p{N}+)*)\s*(?:%|процент\p{L}*|percent)/giu;
/** Space-like characters that may sit inside a written amount. */
const AMOUNT_DIGITS = String.raw`\p{N}[\p{N} \u00a0\u202f.,]*`;
const CURRENCY_MARK = String.raw`[₽$€£¥₸₴₾₹₩]`;
const CURRENCY_WORD = String.raw`(?:руб\p{L}*\.?|р\.|доллар\p{L}*|евро|usd|eur|rub|rur|uah|kzt|cny|юан\p{L}*|тенге|гривн\p{L}*|фунт\p{L}*|dollars?|euros?|pounds?|yuan|yen)`;
const MONEY_AFTER = new RegExp(
  `(${AMOUNT_DIGITS})\\s*(${CURRENCY_MARK}|${CURRENCY_WORD})`,
  "giu",
);
const MONEY_BEFORE = new RegExp(
  `(${CURRENCY_MARK}|${CURRENCY_WORD})\\s*(${AMOUNT_DIGITS})`,
  "giu",
);
const DATE_NUMERIC = /\b(\p{N}{1,4})[./-](\p{N}{1,2})[./-](\p{N}{2,4})\b/gu;
const DATE_WORD_RU =
  /\b(\p{N}{1,2})\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\p{L}*\s*(\p{N}{4})?/giu;
const DATE_WORD_EN =
  /\b(?:(\p{N}{1,2})\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*(\p{N}{4})?\b/giu;
const DURATION_PATTERN = new RegExp(
  String.raw`(\p{N}+(?:[.,]\p{N}+)?)\s+((?:(?:рабоч|календарн|банковск)\p{L}*\s+)?(?:дн\p{L}*|день|недел\p{L}*|месяц\p{L}*|год\p{L}*|лет|час\p{L}*|минут\p{L}*|секунд\p{L}*|days?|weeks?|months?|years?|hours?|minutes?|seconds?))`,
  "giu",
);

function sortedFeatures(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function matchAll(text: string, pattern: RegExp): RegExpExecArray[] {
  const found: RegExpExecArray[] = [];
  const scanner = new RegExp(pattern.source, pattern.flags);
  for (const match of text.matchAll(scanner)) found.push(match);
  return found;
}

/** Normalized numbers, so `1 000` and `1000` are the same amount. */
export function numberFeatures(text: string): string[] {
  return sortedFeatures(
    matchAll(text, NUMBER_PATTERN).map((match) =>
      (match[0] as string).replace(/[\s\u00a0\u202f]/gu, "").replace(",", "."),
    ),
  );
}

export function percentFeatures(text: string): string[] {
  return sortedFeatures(
    matchAll(text, PERCENT_PATTERN).map(
      (match) => `${((match[1] as string) ?? "").replace(",", ".")}%`,
    ),
  );
}

/**
 * Amount-plus-currency features. Both orders are recognized, because "500 000
 * ₽" and "₽ 500 000" are the same clause, and the currency marker is part of
 * the feature so `₽ → $` is a change even when the number does not move.
 */
export function moneyFeatures(text: string): string[] {
  const features: string[] = [];
  for (const match of matchAll(text, MONEY_AFTER)) {
    features.push(
      `${normalizeAmount(match[1] as string)} ${normalizeCurrency(match[2] as string)}`,
    );
  }
  for (const match of matchAll(text, MONEY_BEFORE)) {
    features.push(
      `${normalizeAmount(match[2] as string)} ${normalizeCurrency(match[1] as string)}`,
    );
  }
  return sortedFeatures(features);
}

function normalizeAmount(value: string): string {
  return value
    .replace(/[\s\u00a0\u202f]/gu, "")
    .replace(/[.,]$/u, "")
    .replace(",", ".");
}

function normalizeCurrency(value: string): string {
  return value.toLowerCase().replace(/\.$/u, "");
}

export function dateFeatures(text: string): string[] {
  const features: string[] = [];
  for (const match of matchAll(text, DATE_NUMERIC)) {
    const [first, second, third] = [
      match[1] as string,
      match[2] as string,
      match[3] as string,
    ];
    features.push(
      first.length === 4
        ? `${first}-${second.padStart(2, "0")}-${third.padStart(2, "0")}`
        : `${third}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`,
    );
  }
  for (const match of matchAll(text, DATE_WORD_RU)) {
    features.push(
      `${(match[1] as string).padStart(2, "0")} ${(match[2] as string).toLowerCase()} ${match[3] ?? ""}`.trim(),
    );
  }
  for (const match of matchAll(text, DATE_WORD_EN)) {
    features.push(
      `${(match[1] ?? "").padStart(2, "0")} ${(match[2] as string).toLowerCase()} ${match[3] ?? ""}`
        .replace(/\s+/gu, " ")
        .trim(),
    );
  }
  return sortedFeatures(features);
}

/** `10 рабочих дней`, `30 календарных дней`, `3 (три) месяца`. */
export function durationFeatures(text: string): string[] {
  return sortedFeatures(
    matchAll(text, DURATION_PATTERN).map(
      (match) =>
        `${(match[1] as string).replace(",", ".")} ${(match[2] as string).toLowerCase()}`,
    ),
  );
}
