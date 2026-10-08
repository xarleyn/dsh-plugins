import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildWaveNotes, packWaveNotes } from "./wave-release-notes.mjs";

const entry = (title, body, dir) => ({
  title,
  path: `${dir}/CHANGELOG.md`,
  text: [`## ${title}`, "", body].join("\n"),
});

test("entries that fit are passed through untouched", () => {
  const entries = [
    entry("@yadsh/a 1.0.0", "alpha", "plugins/a"),
    entry("@yadsh/b 1.1.0", "bravo", "plugins/b"),
  ];
  const text = packWaveNotes(entries, 5_000);

  assert.equal(text, `${entries.map((one) => one.text).join("\n\n")}\n`);
  assert.ok(!text.includes("shortened"));
});

test("an over-budget wave drops whole entries and points at their files", () => {
  const entries = [
    entry("@yadsh/a 1.0.0", "alpha".repeat(40), "plugins/a"),
    entry("@yadsh/b 1.0.0", "bravo".repeat(40), "plugins/b"),
    entry("@yadsh/c 1.0.0", "charlie".repeat(40), "plugins/c"),
  ];
  const two = entries[0].text.length + 2 + entries[1].text.length;
  const text = packWaveNotes(entries, two + 200);

  // The unit of loss is a whole entry, and the loss is announced with the file
  // that still holds the text — never a half-told story.
  assert.ok(two + 200 < entries.map((one) => one.text).join("\n\n").length + 1);
  assert.ok(text.includes("## @yadsh/a 1.0.0"));
  assert.ok(text.includes("## @yadsh/b 1.0.0"));
  assert.ok(!text.includes("## @yadsh/c 1.0.0"));
  assert.ok(text.includes("shortened to the index above"));
  assert.ok(
    text.includes(`\`@yadsh/c 1.0.0\` (\`${entries[2].path}\`)`),
    "the shortened note names the file that still holds the entry",
  );
  assert.ok(text.length <= two + 200);
});

test("one oversized entry is trimmed at a line boundary, footer included", () => {
  const body = Array.from({ length: 400 }, (_, index) => `line ${index}`).join(
    "\n",
  );
  const text = packWaveNotes([entry("@yadsh/a 1.0.0", body, "plugins/a")], 600);

  assert.ok(text.length <= 600);
  assert.match(text, /line \d+\n\n_\(trimmed/u);
  assert.ok(!text.includes("line 399"));
});

test("the index names every package even when entries are dropped", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wave-notes-"));
  const rows = [
    { name: "@yadsh/big", version: "2.0.0", directory: "plugins/big" },
    { name: "@yadsh/small", version: "1.0.0", directory: "plugins/small" },
  ];
  const bodies = [
    ["plugins/big", "2.0.0", Array.from({ length: 800 }, () => "x".repeat(50))],
    [
      "plugins/small",
      "1.0.0",
      Array.from({ length: 120 }, () => "a wave-sized note"),
    ],
  ];
  for (const [directory, version, lines] of bodies) {
    const file = path.join(root, directory, "CHANGELOG.md");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `# ${directory}\n\n## ${version}\n\n${lines.join("\n")}\n`,
      "utf8",
    );
  }

  const text = buildWaveNotes(rows, root, 12_000);

  // Released packages never vanish from the release: the index carries all of
  // them, the body carries what fits.
  assert.ok(text.includes("`@yadsh/big@2.0.0` — `plugins/big/CHANGELOG.md`"));
  assert.ok(
    text.includes("`@yadsh/small@1.0.0` — `plugins/small/CHANGELOG.md`"),
  );
  assert.ok(text.includes("## @yadsh/big 2.0.0"));
  assert.ok(!text.includes("## @yadsh/small 1.0.0"));
  assert.ok(
    text.includes("`@yadsh/small 1.0.0` (`plugins/small/CHANGELOG.md`)"),
    "the footer survives the trim",
  );
  assert.ok(text.length <= 12_000);
});
