import { describe, expect, it } from "vitest";
import { boundText } from "../src/mining/sanitize.js";

function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("boundText", () => {
  it.each([
    ["keeps ASCII within the budget", "abc", 3, "abc"],
    ["truncates ASCII and reserves the ellipsis", "abcd", 3, "ab…"],
    ["counts BMP Cyrillic as code points", "абвг", 3, "аб…"],
    ["counts an emoji outside the BMP as one code point", "😀abc", 2, "😀…"],
    ["keeps several emoji at the boundary", "😀😃😄x", 4, "😀😃😄x"],
    ["truncates several emoji at the boundary", "😀😃😄x", 3, "😀😃…"],
    ["counts a combining mark separately", "e\u0301x", 2, "e…"],
    ["keeps empty text empty", "", 0, ""],
    ["returns an empty string for a zero budget", "abc", 0, ""],
    ["uses the whole one-code-point budget for the ellipsis", "ab", 1, "…"],
  ])("%s", (_name, text, maxChars, expected) => {
    const result = boundText(text, maxChars);
    expect(result).toBe(expected);
    expect([...result].length).toBeLessThanOrEqual(maxChars);
    expect(hasLoneSurrogate(result)).toBe(false);
  });
});
