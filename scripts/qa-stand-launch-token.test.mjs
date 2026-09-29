#!/usr/bin/env node
/**
 * Boundary coverage for the launch-token pattern of `qa-stand-run` §3.
 *
 * The pattern is the one place the stand skill turns a container log into a
 * credential, and `docs/plans/2026-09-28-skill-candidates.md` records that part
 * of §3 as re-checked by ad hoc runs in four separate review rounds of PR #615 —
 * its points 17, 25, 33 and 39, raised in rounds 5, 7, 8 and 11 — with nothing
 * keeping it pinned afterwards. This suite runs the recipe's own pipeline —
 * lifted out of `SKILL.md`, not copied, so the skill cannot drift away from what
 * is proven here — over the fake log lines §3 names, and asserts what the section
 * promises about each: which joined keys give no capture, where the value stops,
 * and what the greediness of `.*` and `tail -1` yields.
 *
 * Two of those four rounds were about the `$KIT` guard around this assignment,
 * not about the assignment, and a guard needs the kit's directory to mean
 * anything: the cases below cover the capture, not the guard branches.
 *
 * The boot line's real format belongs to the deployment kit and is not
 * checkable from this repository (SKILL.md §0), so no case here feeds a live
 * log or a real token: these are synthetic strings.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { discoverBash } from "./run-bash.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const skillFile = path.join(
  repoRoot,
  ".agents",
  "skills",
  "qa-stand-run",
  "SKILL.md",
);

/** The capture line of the §3 recipe, with its shell continuation joined. */
function tokenPipeline() {
  const lines = readFileSync(skillFile, "utf8").split(/\r?\n/u);
  const start = lines.findIndex((line) =>
    line.trim().startsWith("LAUNCH_TOKEN=$("),
  );
  assert.notEqual(
    start,
    -1,
    `${path.relative(repoRoot, skillFile)} no longer assigns LAUNCH_TOKEN=$(…); ` +
      "the recipe moved or was rewritten — update §3 and this test together",
  );
  const first = lines[start].trim();
  const rest = first.endsWith("\\")
    ? first.slice(0, -1).trim() + " " + lines[start + 1].trim()
    : first;
  assert.match(
    rest,
    /\bsed -nE\b[\s\S]*\|\s*tail -1\)$/u,
    `the capture is no longer a sed pipeline closed by tail -1:\n${rest}`,
  );
  return rest;
}

const pipeline = tokenPipeline();

/** Run the recipe over one fake log and return the capture it would assign. */
function capture(launchLog) {
  const result = spawnSync(
    discoverBash(),
    ["-c", `${pipeline}\nprintf '%s' "$LAUNCH_TOKEN"`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, LAUNCH_LOG: launchLog },
    },
  );
  assert.equal(
    result.status,
    0,
    `bash failed on ${launchLog}: ${result.stderr}`,
  );
  return result.stdout;
}

describe("qa-stand-run §3 launch-token pattern", () => {
  it("rejects a key joined to token by a hyphen or an underscore", () => {
    assert.equal(capture("qa pid 1 boot access-token=NOISE"), "");
    assert.equal(capture("qa pid 1 boot refresh_token=NOISE"), "");
    assert.equal(capture("qa pid 1 boot notoken=NOISE"), "");
  });

  it("matches a token= that opens the line", () => {
    assert.equal(
      capture("token=LINE_OPENER rest of the boot line"),
      "LINE_OPENER",
    );
  });

  it("takes the standalone token= that follows a joined one", () => {
    assert.equal(capture("refresh_token=JOINED_NOT_IT token=REAL"), "REAL");
  });

  it("keeps dot, plus, equals and colon inside the value", () => {
    assert.equal(
      capture("boot token=AbCd.123+xy:99=e now"),
      "AbCd.123+xy:99=e",
    );
  });

  it("stops the value at an ampersand and at a fragment", () => {
    assert.equal(capture("boot token=AbCd.123+xy:99&x=1"), "AbCd.123+xy:99");
    assert.equal(capture("GET /admin?token=abc#frag"), "abc");
  });

  it("captures nothing from a quoted value, which reads as NOT FOUND", () => {
    assert.equal(capture("boot token='abc' now"), "");
    assert.equal(capture('boot token="abc" now'), "");
  });

  it("yields the last of two standalone token= on one line", () => {
    assert.equal(capture("boot token=FIRST token=SECOND"), "SECOND");
  });

  it("takes the last matching line of the log", () => {
    assert.equal(
      capture("boot token=ONE_OF_EARLIER_LINE\nboot token=ONE_OF_LAST_LINE"),
      "ONE_OF_LAST_LINE",
    );
  });

  it("keeps the §3 sample token whole, which is what the length reports", () => {
    // §3 prints only `${#LAUNCH_TOKEN} characters`, so the length is the single
    // observable that tells a reader the capture was cut short.
    assert.equal(capture("boot token=AbCd.123+xy:99&x=1").length, 14);
    assert.match(
      readFileSync(skillFile, "utf8"),
      /\$\{#LAUNCH_TOKEN\} characters/u,
      "§3 no longer proves the capture by its length alone",
    );
  });
});
