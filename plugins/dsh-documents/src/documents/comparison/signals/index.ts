/**
 * Signal detection over one change (§18).
 *
 * The entry point takes the two texts a change reports and returns the facts
 * the deterministic layer can prove about them. Order is the canonical
 * `CHANGE_SIGNALS` order rather than detection order, so a signal list is
 * comparable across runs and across documents.
 *
 * A one-sided change (an insertion or a deletion) is compared against the
 * empty text on purpose: everything the new clause says about money, dates and
 * obligations is then a change, which is exactly what a reader wants to know
 * about a clause that just appeared.
 */

import type { ChangeSignal } from "../types.js";
import { CHANGE_SIGNALS } from "../types.js";
import {
  CLASS_SIGNALS,
  featuresChanged,
  lexicalFeatures,
  type LexicalFeatures,
} from "./lexical.js";
import {
  dateFeatures,
  durationFeatures,
  moneyFeatures,
  numberFeatures,
  percentFeatures,
} from "./numeric.js";

export interface SignalInput {
  readonly before?: string;
  readonly after?: string;
  /** The differ saw equal text with a different formatting signature. */
  readonly formattingChanged?: boolean;
}

export function detectSignals(input: SignalInput): ChangeSignal[] {
  const found = new Set<ChangeSignal>();
  if (input.formattingChanged === true) found.add("FORMATTING_CHANGED");
  const before = input.before ?? "";
  const after = input.after ?? "";
  if (before !== after) {
    if (featuresChanged(numberFeatures(before), numberFeatures(after))) {
      found.add("NUMBER_CHANGED");
    }
    if (featuresChanged(percentFeatures(before), percentFeatures(after))) {
      found.add("PERCENTAGE_CHANGED");
    }
    if (featuresChanged(moneyFeatures(before), moneyFeatures(after))) {
      found.add("MONEY_CHANGED");
    }
    if (featuresChanged(dateFeatures(before), dateFeatures(after))) {
      found.add("DATE_CHANGED");
    }
    if (featuresChanged(durationFeatures(before), durationFeatures(after))) {
      found.add("DURATION_CHANGED");
    }
    const beforeLexical = lexicalFeatures(before);
    const afterLexical = lexicalFeatures(after);
    if (featuresChanged(beforeLexical.negation, afterLexical.negation)) {
      found.add("NEGATION_CHANGED");
    }
    if (featuresChanged(beforeLexical.parties, afterLexical.parties)) {
      found.add("PARTY_REFERENCE_CHANGED");
    }
    if (featuresChanged(beforeLexical.urls, afterLexical.urls)) {
      found.add("URL_CHANGED");
    }
    if (featuresChanged(beforeLexical.emails, afterLexical.emails)) {
      found.add("EMAIL_CHANGED");
    }
    for (const key of [
      "obligation",
      "permission",
      "prohibition",
      "liability",
    ] as const) {
      if (
        featuresChanged(
          beforeLexical[key as keyof LexicalFeatures],
          afterLexical[key as keyof LexicalFeatures],
        )
      ) {
        found.add(CLASS_SIGNALS[key]);
      }
    }
  }
  return CHANGE_SIGNALS.filter((signal) => found.has(signal));
}
