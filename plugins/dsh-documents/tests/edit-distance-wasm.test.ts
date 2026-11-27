import { expect, test } from "vitest";
import { wasmEditDistance } from "../src/documents/comparison/alignment/edit-distance-wasm.js";
import { editDistance } from "../src/documents/comparison/alignment/similarity.js";

test("the packaged Rust kernel preserves exact UTF-16 distances", () => {
  const pairs: [string, string][] = [
    ["", ""],
    ["", "🌍"],
    ["раздел 1", "раздел 2"],
    ["🚀", "🌍"],
    ["\uD800\u0000\uFFFF", "\uDC00\u0001\uFFFF"],
    ["Cafe\u0301", "Café"],
  ];
  let state = 42;
  const alphabet = ["а", "б", "c", "\uFFFE", "\uD800", "\uDC00", "\u0000"];
  const sample = (length: number): string =>
    Array.from({ length }, () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return alphabet[(state >>> 8) % alphabet.length];
    }).join("");
  for (const size of [
    1, 31, 63, 64, 65, 127, 128, 129, 255, 256, 257, 511, 512,
  ]) {
    for (const other of [1, size - 1, size, 512]) {
      pairs.push([sample(size), sample(other)]);
      pairs.push([sample(other), sample(size)]);
    }
  }
  for (const [left, right] of pairs)
    expect(wasmEditDistance(left, right)).toBe(editDistance(left, right));
  expect(wasmEditDistance("a".repeat(513), "a")).toBeUndefined();
});
