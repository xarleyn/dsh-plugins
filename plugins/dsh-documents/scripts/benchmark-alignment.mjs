// Paired benchmark for the same built plugin and deterministic fixture.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const mode = process.argv[2] ?? "wasm";
assert.ok(mode === "wasm" || mode === "js");
if (mode === "js") globalThis.WebAssembly = undefined;

const { wasmEditDistance } =
  await import("../lib/documents/comparison/alignment/edit-distance-wasm.js");
const { canonicalFromMarkdown } =
  await import("../lib/documents/comparison/extractors/markdown.js");
const { diffDocuments } =
  await import("../lib/documents/comparison/diff/block-diff.js");
assert.equal(
  wasmEditDistance("поставка", "доставка"),
  mode === "wasm" ? 1 : undefined,
);

const digest = (text) => createHash("sha256").update(text).digest("hex");
const paragraphs = Array.from({ length: 180 }, (_, i) =>
  [
    "Проверка №" + (i + 1) + " выполнена.",
    "Согласуйте срок поставки оборудования и подтвердите дату приемки документации.",
    "Система допускает три повторных проверки.",
  ].join(" "),
);
const before = paragraphs.join("\n\n");
const after = before.replaceAll("три повторных", "четыре повторных");
const left = canonicalFromMarkdown(before, { maxNodes: 200 });
const right = canonicalFromMarkdown(after, { maxNodes: 200 });
const context = {
  leftSha: digest(before),
  rightSha: digest(after),
  detectMoves: true,
  ignoreWhitespace: true,
  ignoreFormatting: true,
  confidence: 1,
  checkBudget() {},
};
const warmup = diffDocuments(left, right, context);
assert.equal(warmup.length, 180);
const resultHash = digest(JSON.stringify(warmup));
const times = Array.from({ length: 9 }, () => {
  const start = performance.now();
  const result = diffDocuments(left, right, context);
  const elapsed = performance.now() - start;
  assert.equal(digest(JSON.stringify(result)), resultHash);
  return elapsed;
}).sort((a, b) => a - b);
console.log(
  JSON.stringify({
    mode,
    changes: warmup.length,
    resultHash,
    p50Ms: times[4],
    maxMs: times.at(-1),
    times,
  }),
);
