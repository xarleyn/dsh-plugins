import assert from "node:assert/strict";
import { test } from "node:test";

import { capWaveNotes } from "./wave-release-notes.mjs";

const section = (name, lines) => [`## ${name}`, "", ...lines].join("\n");

test("a wave that fits is passed through untouched", () => {
  const sections = [
    section("@yadsh/a 1.0.0", ["alpha"]),
    section("@yadsh/b 1.1.0", ["bravo"]),
  ];
  const text = capWaveNotes(sections, 5_000);

  assert.equal(text, `${sections.join("\n\n")}\n`);
  assert.ok(!text.includes("left out"));
});

test("an over-long wave drops whole sections and names them", () => {
  const sections = [
    section("@yadsh/a 1.0.0", ["alpha".repeat(40)]),
    section("@yadsh/b 1.0.0", ["bravo".repeat(40)]),
    section("@yadsh/c 1.0.0", ["charlie".repeat(40)]),
  ];
  const limit = sections[0].length + sections[1].length + 200;
  const text = capWaveNotes(sections, limit);

  // The unit of loss is a package section: a half-told entry would describe a
  // release the wave did not ship.
  assert.ok(text.includes("## @yadsh/a 1.0.0"));
  assert.ok(text.includes("## @yadsh/b 1.0.0"));
  assert.ok(!text.includes("## @yadsh/c 1.0.0"));
  assert.ok(text.includes("left out"));
  assert.ok(text.includes("`@yadsh/c 1.0.0`"));
  assert.ok(text.length <= limit);
});

test("one oversized section is trimmed at a line boundary", () => {
  const only = section(
    "@yadsh/a 1.0.0",
    Array.from({ length: 400 }, (_, index) => `line ${index}`),
  );
  const text = capWaveNotes([only], 600);

  assert.ok(text.length <= 600);
  assert.match(text, /line \d+\n\n_\(trimmed/u);
  assert.ok(!text.includes("line 399"));
});
