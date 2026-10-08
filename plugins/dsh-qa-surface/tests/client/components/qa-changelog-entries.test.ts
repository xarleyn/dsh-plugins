import { describe, expect, it } from "vitest";
import { QA_CHANGELOG } from "../../../src/client/components/QaChangelog.js";

/**
 * The curated changelog grows by hand, one append per card, and an entry runs
 * to a paragraph: two appends that describe the same feature look nothing alike
 * in `git diff`. 0.14.0 shipped the theme switcher twice and only reading the
 * rendered dialog caught it, so the collision itself is what has to fail here.
 */

const WORD = /[\p{L}\p{M}]+/gu;

/** Measured on the current file: the two theme entries share 0.90, the closest pair of genuinely different features shares 0.18. */
const DUPLICATE_OVERLAP = 0.5;

function contentWords(item: string): Set<string> {
  // Only the content words count. Two Russian prose blocks share every
  // connective by definition, and that floor would drown the signal.
  return new Set(
    item
      .toLowerCase()
      .match(WORD)
      ?.filter((word) => word.length > 2) ?? [],
  );
}

/**
 * The opening sentence, the part a repeated append rarely rewords. The sentence
 * ends at a period that closes it, not at any period: entries name releases like
 * 0.13.0 in their opening line, and cutting there would compare «список
 * изменений 0» instead of what was written.
 */
function lead(item: string): string {
  return item
    .split(/\.(?=\s|$)/u)[0]!
    .trim()
    .toLowerCase();
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function pairLabel(entry: string, section: string, left: string): string {
  return `${entry} / ${section}: «${lead(left).slice(0, 48)}…»`;
}

function versionParts(version: string): number[] {
  return version.split(".").map((part) => Number(part));
}

function compareVersions(left: string, right: string): number {
  const [leftMajor = 0, leftMinor = 0, leftPatch = 0] = versionParts(left);
  const [rightMajor = 0, rightMinor = 0, rightPatch = 0] = versionParts(right);
  return (
    leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch
  );
}

describe("curated changelog shape", () => {
  it("says each thing once inside a section", () => {
    for (const entry of QA_CHANGELOG) {
      for (const section of entry.sections) {
        for (let left = 0; left < section.items.length; left += 1) {
          for (let right = left + 1; right < section.items.length; right += 1) {
            const first = section.items[left]!;
            const second = section.items[right]!;
            const label = pairLabel(entry.version, section.title, first);

            expect(
              lead(second),
              `${label} and the entry below it open with the same sentence`,
            ).not.toBe(lead(first));

            const shared = overlap(contentWords(first), contentWords(second));
            expect(
              shared,
              `${label} and the entry below it restate the same feature (${shared.toFixed(2)} of their words are shared)`,
            ).toBeLessThan(DUPLICATE_OVERLAP);
          }
        }
      }
    }
  });

  it("keeps the entries in descending version order", () => {
    // The order of the array is the order the dialog renders, so an append in
    // the middle puts an old release on top. Compared numerically: as text,
    // "0.10.0" sorts below "0.9.0" and would fail an ordered changelog.
    const versions = QA_CHANGELOG.map((entry) => entry.version);
    for (let index = 1; index < versions.length; index += 1) {
      const previous = versions[index - 1]!;
      const current = versions[index]!;
      expect(
        compareVersions(previous, current),
        `${previous} is listed above ${current}, but it is the older release`,
      ).toBeGreaterThan(0);
    }
    expect(new Set(versions).size, "a version is listed twice").toBe(
      versions.length,
    );
  });
});
