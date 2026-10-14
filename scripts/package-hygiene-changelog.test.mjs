import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJson } from "./test-support/package-hygiene-fixtures.mjs";
import {
  compareVersions,
  curatedChangelogBlocks,
  curatedChangelogVersions,
  incrementVersion,
  planBumpFor,
  planProjects,
  qaChangelogBaselines,
  validateQaChangelogFrozenSections,
  validateQaChangelogPlannedEntries,
  verifyVersionPlans,
} from "./verify-package-hygiene.mjs";

const qaSurfacePlan = [
  "---",
  '"@yadsh/dsh-qa-surface": patch',
  "---",
  "",
  "Fix the QA chat.",
  "",
].join("\n");

const changelogOf = (versions) =>
  `export const QA_CHANGELOG = [${versions
    .map(
      (version) =>
        `{ version: "${version}", date: "2026-09-16", sections: [] }`,
    )
    .join(",\n")}];\n`;

async function qaSurfaceFixture({
  plans = [],
  packages = {},
  version = "0.7.4",
  changelogVersions = ["0.7.4"],
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-qa-changelog-"));
  const plansRoot = path.join(root, ".nx", "version-plans");
  mkdirSync(plansRoot, { recursive: true });
  for (const [name, content] of plans) {
    writeFileSync(path.join(plansRoot, name), content);
  }
  for (const [name, manifest] of Object.entries(packages)) {
    const directory = path.join(root, "packages", name);
    mkdirSync(directory, { recursive: true });
    writeJson(path.join(directory, "package.json"), manifest);
  }
  const directory = path.join(root, "plugins", "dsh-qa-surface");
  mkdirSync(path.join(directory, "src", "client", "components"), {
    recursive: true,
  });
  writeJson(path.join(directory, "package.json"), {
    name: "@yadsh/dsh-qa-surface",
    version,
  });
  writeFileSync(
    path.join(directory, "src", "client", "components", "QaChangelog.tsx"),
    changelogOf(changelogVersions),
  );
  return root;
}

test("a qa-surface plan requires a changelog entry for the planned version", async () => {
  const root = await qaSurfaceFixture({ plans: [["plan.md", qaSurfacePlan]] });
  try {
    assert.throws(
      () => verifyVersionPlans(root),
      /plans bump to 0\.7\.5, but QaChangelog\.tsx has no entry for it/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a qa-surface plan covered by the planned curated entry passes", async () => {
  const root = await qaSurfaceFixture({
    plans: [["plan.md", qaSurfacePlan]],
    changelogVersions: ["0.7.5", "0.7.4"],
  });
  try {
    assert.equal(verifyVersionPlans(root), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale future entry does not cover the next planned release", async () => {
  // The reviewer's false-positive: with 0.8.0 already recorded, a patch plan
  // still demands its own 0.7.5 entry — any-version-newer is not coverage.
  const root = await qaSurfaceFixture({
    plans: [["plan.md", qaSurfacePlan]],
    changelogVersions: ["0.8.0", "0.7.4"],
  });
  try {
    assert.throws(
      () => verifyVersionPlans(root),
      /plans bump to 0\.7\.5, but QaChangelog\.tsx has no entry for it/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the highest qa-surface bump decides the demanded version", async () => {
  const minorPlan = [
    "---",
    '"@yadsh/dsh-qa-surface": minor',
    "---",
    "",
    "Add something to the QA chat.",
    "",
  ].join("\n");
  const matchingRoot = await qaSurfaceFixture({
    plans: [
      ["patch.md", qaSurfacePlan],
      ["minor.md", minorPlan],
    ],
    changelogVersions: ["0.8.0", "0.7.4"],
  });
  try {
    assert.equal(verifyVersionPlans(matchingRoot), 2);
  } finally {
    await rm(matchingRoot, { recursive: true, force: true });
  }

  const staleRoot = await qaSurfaceFixture({
    plans: [
      ["patch.md", qaSurfacePlan],
      ["minor.md", minorPlan],
    ],
    changelogVersions: ["0.7.5", "0.7.4"],
  });
  try {
    assert.throws(
      () => verifyVersionPlans(staleRoot),
      /plans bump to 0\.8\.0, but QaChangelog\.tsx has no entry for it/u,
    );
  } finally {
    await rm(staleRoot, { recursive: true, force: true });
  }
});

test("no qa-surface plan means no changelog demand", async () => {
  const root = await qaSurfaceFixture({
    plans: [
      [
        "plan.md",
        ["---", '"@yadsh/dsh-other": patch', "---", "", "Other work.", ""].join(
          "\n",
        ),
      ],
    ],
    packages: {
      "dsh-other": { name: "@yadsh/dsh-other", version: "1.0.0" },
    },
  });
  try {
    assert.equal(verifyVersionPlans(root), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an empty plan set never trips the changelog tripwire", async () => {
  const root = await qaSurfaceFixture();
  try {
    assert.equal(verifyVersionPlans(root), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Frozen published sections: the sidebar test compares the *list* of versions,
// so a sentence slipped into an already released entry leaves the list intact
// and passes CI while the deployed changelog now claims a fix that shipped in
// an earlier version. The hygiene gate compares the entry text against the
// newest reachable release tag, blames only the sections the branch itself
// wrote, and demands a plan for any entry newer than the released version.
// ---------------------------------------------------------------------------

const changelogOfItems = (entries) =>
  `export const QA_CHANGELOG = [\n${entries
    .map(
      ([version, items]) =>
        `  { version: "${version}", date: "2026-09-16", sections: [{ title: "Fixes", items: [${items
          .map((item) => JSON.stringify(item))
          .join(", ")}] }] }`,
    )
    .join(",\n")}\n];\n`;

const releasedChangelog = changelogOfItems([["0.7.4", ["Fixed the QA chat."]]]);

test("an entry added above the released ones does not disturb their blocks", () => {
  const working = changelogOfItems([
    ["0.7.5", ["Fixed the slash-command palette."]],
    ["0.7.4", ["Fixed the QA chat."]],
  ]);
  assert.deepEqual(
    validateQaChangelogFrozenSections(working, releasedChangelog),
    [],
  );
  assert.deepEqual(
    [...curatedChangelogBlocks(working).keys()],
    ["0.7.5", "0.7.4"],
  );
});

test("the rendering code below the array is not part of the last entry", () => {
  const working = `${changelogOfItems([
    ["0.7.4", ["Fixed the QA chat."]],
  ])}\nexport const QaChangelogModal = () => [\n  <section key="a" />,\n];\n`;
  assert.deepEqual(
    validateQaChangelogFrozenSections(working, releasedChangelog),
    [],
  );
});

test("a sentence added inside a released section fails the gate", () => {
  const working = changelogOfItems([
    ["0.7.4", ["Fixed the QA chat.", "Fixed the palette too."]],
  ]);
  const failures = validateQaChangelogFrozenSections(
    working,
    releasedChangelog,
  );
  assert.equal(failures.length, 1);
  assert.match(
    failures[0],
    /QaChangelog\.tsx changes the entry of the released version 0\.7\.4 away from what that wave published/u,
  );
});

test("a released section cannot be renamed or dropped", () => {
  const renamed = changelogOfItems([["0.7.4", ["Fixed the chat."]]]);
  assert.match(
    validateQaChangelogFrozenSections(renamed, releasedChangelog)[0],
    /changes the entry of the released version 0\.7\.4/u,
  );
  const dropped = changelogOfItems([["0.7.5", ["Fixed the palette."]]]);
  assert.match(
    validateQaChangelogFrozenSections(dropped, releasedChangelog)[0],
    /drops the entry of the released version 0\.7\.4/u,
  );
});

test("a branch that predates the wave is not blamed for the published text", () => {
  // The head started before 0.7.4 was published and never touched the file, so
  // the difference is staleness; rebasing seats it back, this gate stays quiet.
  const stale = changelogOfItems([["0.7.3", ["Fixed an older chat."]]]);
  assert.deepEqual(
    validateQaChangelogFrozenSections(stale, releasedChangelog, stale),
    [],
  );
  // The same head that wrote its note into the section the wave later published
  // is held to it: the note has to move to the version its plans bump to.
  const rewrote = changelogOfItems([
    ["0.7.4", ["Fixed the QA chat.", "And the palette."]],
    ["0.7.3", ["Fixed an older chat."]],
  ]);
  assert.deepEqual(
    validateQaChangelogFrozenSections(
      rewrote,
      releasedChangelog,
      changelogOfItems([
        ["0.7.4", ["Fixed the QA chat."]],
        ["0.7.3", ["Fixed an older chat."]],
      ]),
    ).length,
    1,
  );
});

test("a curated entry newer than the released version needs a qa-surface plan", () => {
  const pending = changelogOfItems([
    ["0.7.5", ["Fixed the palette."]],
    ["0.7.4", ["Fixed the QA chat."]],
  ]);
  const plansWith = [{ file: "plan.md", content: qaSurfacePlan }];
  assert.deepEqual(
    validateQaChangelogPlannedEntries(pending, "0.7.4", plansWith),
    [],
  );
  const failures = validateQaChangelogPlannedEntries(pending, "0.7.4", []);
  assert.equal(failures.length, 1);
  assert.match(
    failures[0],
    /entry for 0\.7\.5, newer than the released 0\.7\.4, but no qa-surface version plan/u,
  );
});

test("a pending entry inherited from the branch base is not its doing", () => {
  const pending = changelogOfItems([
    ["0.7.5", ["Fixed the palette."]],
    ["0.7.4", ["Fixed the QA chat."]],
  ]);
  // A head that forked before the wave published 0.7.5 carries the note as it
  // found it; rebasing, not this message, is what seats it.
  assert.deepEqual(
    validateQaChangelogPlannedEntries(pending, "0.7.4", [], pending),
    [],
  );
});

test("the pending entry must be the version the plans bump to", () => {
  const minorPlan = [
    "---",
    '"@yadsh/dsh-qa-surface": minor',
    "---",
    "",
    "Add something to the QA chat.",
    "",
  ].join("\n");
  const failures = validateQaChangelogPlannedEntries(
    changelogOfItems([
      ["0.7.5", ["Fixed the palette."]],
      ["0.7.4", ["x"]],
    ]),
    "0.7.4",
    [{ file: "plan.md", content: minorPlan }],
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /entry for 0\.7\.5/u);
  assert.deepEqual(
    validateQaChangelogPlannedEntries(
      changelogOfItems([
        ["0.8.0", ["Added a panel."]],
        ["0.7.4", ["x"]],
      ]),
      "0.7.4",
      [{ file: "plan.md", content: minorPlan }],
    ),
    [],
  );
});

test("verifyVersionPlans rejects a note written into a published section", async () => {
  const root = await qaSurfaceFixture({ plans: [] });
  try {
    const rewritten = changelogOfItems([
      ["0.7.4", ["Fixed the QA chat.", "And the palette."]],
    ]);
    writeFileSync(
      path.join(
        root,
        "plugins",
        "dsh-qa-surface",
        "src",
        "client",
        "components",
        "QaChangelog.tsx",
      ),
      rewritten,
    );
    const baselines = {
      released: releasedChangelog,
      base: changelogOfItems([["0.7.4", ["Fixed the QA chat."]]]),
    };
    assert.throws(
      () => verifyVersionPlans(root, { changelogBaselines: baselines }),
      /changes the entry of the released version 0\.7\.4/u,
    );
    // No tag to freeze against is a skip, not a failure.
    assert.equal(verifyVersionPlans(root, { changelogBaselines: null }), 0);
    // And a head that never wrote the section is not blamed for it.
    assert.equal(
      verifyVersionPlans(root, {
        changelogBaselines: { released: releasedChangelog, base: rewritten },
      }),
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifyVersionPlans rejects a curated entry its branch never planned", async () => {
  const root = await qaSurfaceFixture({
    plans: [],
    changelogVersions: ["0.7.5", "0.7.4"],
  });
  try {
    assert.throws(
      () => verifyVersionPlans(root, { changelogBaselines: null }),
      /no qa-surface version plan bumps to it/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the released changelog is read from the newest wave tag", async () => {
  const root = await qaSurfaceFixture({ plans: [] });
  try {
    // A checkout without a reachable release tag has nothing frozen, and the
    // gate says so instead of inventing a baseline.
    assert.equal(qaChangelogBaselines(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changelog coverage parses front matter, versions, and orders them", () => {
  assert.deepEqual(planProjects(qaSurfacePlan), ["@yadsh/dsh-qa-surface"]);
  assert.deepEqual(planProjects("no front matter"), []);
  assert.equal(planBumpFor(qaSurfacePlan, "@yadsh/dsh-qa-surface"), "patch");
  assert.equal(planBumpFor(qaSurfacePlan, "@yadsh/dsh-other"), undefined);
  assert.equal(
    planBumpFor("no front matter", "@yadsh/dsh-qa-surface"),
    undefined,
  );
  assert.deepEqual(curatedChangelogVersions(changelogOf(["0.7.5", "0.7.4"])), [
    "0.7.5",
    "0.7.4",
  ]);
  assert.equal(incrementVersion("0.7.4", "patch"), "0.7.5");
  assert.equal(incrementVersion("0.7.4", "minor"), "0.8.0");
  assert.equal(incrementVersion("0.7.4", "major"), "1.0.0");
  assert.equal(incrementVersion("1.0.0-rc.1", "minor"), "1.1.0");
  assert.equal(incrementVersion("not-a-version", "patch"), undefined);
  assert.equal(compareVersions("0.7.5", "0.7.4"), 1);
  assert.equal(compareVersions("0.7.4", "0.7.4"), 0);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.10"), -1);
});
