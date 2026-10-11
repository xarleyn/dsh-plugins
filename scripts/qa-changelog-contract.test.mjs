import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  qaChangelogBaselines,
  verifyVersionPlans,
} from "./verify-package-hygiene.mjs";

const directory = "plugins/dsh-qa-surface";
const curatedPath = `${directory}/src/client/components/QaChangelog.tsx`;
const project = "@yadsh/dsh-qa-surface";
const curated = (items) =>
  `export const QA_CHANGELOG = [\n  {\n    version: "0.7.4",\n    sections: [{ items: ${JSON.stringify(items)} }],\n  },\n];\n`;

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "qa-changelog-contract-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Fixture Bot");
  git("config", "user.email", "fixture@bots.invalid");
  write(
    `${directory}/package.json`,
    JSON.stringify({ name: project, version: "0.7.4" }),
  );
  write(curatedPath, curated(["Initial note."]));
  git("add", `${directory}/package.json`, curatedPath);
  git("commit", "-m", "fixture: baseline");
  const base = git("rev-parse", "HEAD");
  return { root, git, write, base };
}

test("a branch cut before publication still freezes the published section without plans", () => {
  const { root, git, write, base } = fixture();
  try {
    git("tag", "release/2026-01-01-1");
    // The wave moved on another branch after this branch forked. Its manifest
    // version stayed the same; the important state is the published note.
    write(curatedPath, curated(["Initial note.", "Published note."]));
    git("add", curatedPath);
    git("commit", "-m", "chore(release): publish wave");
    git("tag", "release/2026-01-01-2");
    git("switch", "-c", "lagging", base);
    write(curatedPath, curated(["Initial note.", "Unreleased change."]));
    git("add", curatedPath);
    git("commit", "-m", "fixture: edit released section");
    assert.throws(
      () => verifyVersionPlans(root),
      /changes the entry of the released version 0\.7\.4/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lagging branch is not blamed for an unchanged inherited section", () => {
  const { root, git, write, base } = fixture();
  try {
    write(curatedPath, curated(["Initial note.", "Published note."]));
    git("add", curatedPath);
    git("commit", "-m", "chore(release): publish wave");
    git("tag", "release/2026-01-01-1");
    git("switch", "-c", "lagging", base);
    assert.equal(verifyVersionPlans(root), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit missing comparison ref fails instead of silently skipping", () => {
  const { root, git } = fixture();
  try {
    git("tag", "release/2026-01-01-1");
    assert.throws(
      () => qaChangelogBaselines(root, { base: "missing-ref" }),
      /not a commit/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an already published target rejects a stale plan on a lagging branch", () => {
  const { root, git, write, base } = fixture();
  try {
    write(
      `${directory}/package.json`,
      JSON.stringify({ name: project, version: "0.7.5" }),
    );
    write(curatedPath, curated(["Initial note."]));
    git("add", `${directory}/package.json`, curatedPath);
    git("commit", "-m", "chore(release): publish wave");
    git("tag", "release/2026-01-01-1");
    git("switch", "-c", "lagging", base);
    write(
      ".nx/version-plans/pending.md",
      `---\n"${project}": patch\n---\n\nA pending note.\n`,
    );
    write(
      curatedPath,
      `export const QA_CHANGELOG = [\n  { version: "0.7.5", sections: [] },\n  { version: "0.7.4", sections: [] },\n];\n`,
    );
    assert.throws(
      () => verifyVersionPlans(root),
      /0\.7\.5 is already published/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a known wave whose manifest is malformed fails instead of weakening the check", () => {
  const { root, git, write } = fixture();
  try {
    write(`${directory}/package.json`, JSON.stringify({ name: project }));
    git("add", `${directory}/package.json`);
    git("commit", "-m", "fixture: malformed publication");
    git("tag", "release/2026-01-01-1");
    assert.throws(
      () => qaChangelogBaselines(root),
      /published manifest has no valid version/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the materialized release manifest remains the floor until its wave is tagged", () => {
  const { root, git, write } = fixture();
  try {
    git("tag", "release/2026-01-01-1");
    write(
      `${directory}/package.json`,
      JSON.stringify({ name: project, version: "0.7.5" }),
    );
    write(
      curatedPath,
      `export const QA_CHANGELOG = [\n  { version: "0.7.5", sections: [] },\n${curated(["Initial note."]).split("\n").slice(1, -2).join("\n")}\n];\n`,
    );
    assert.equal(verifyVersionPlans(root), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
