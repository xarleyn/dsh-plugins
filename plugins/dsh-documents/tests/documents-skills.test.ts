/**
 * The shipped contract-review skill (§20, Phase 7).
 *
 * The skill is the model-facing half of the comparison: it states that the
 * change set is the fact and the interpretation is the model's, and it is
 * vendored so a restricted workspace cannot hide it. These assertions cover the
 * bytes that ship, the front matter the harness parses, and the provider mount
 * the plugin entry performs.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  buildDocumentSkillsConfig,
  CONTRACT_REVIEW_SKILL,
  DOCUMENT_SKILL_PROVIDER_NAME,
  DOCUMENT_SKILLS_DIR,
} from "../src/skills.js";

const SKILL_FILE = path.join(
  DOCUMENT_SKILLS_DIR,
  CONTRACT_REVIEW_SKILL,
  "SKILL.md",
);

function frontMatter(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(text);
  if (match?.[1] === undefined) throw new Error("no front matter");
  return match[1];
}

describe("the bundled skill", () => {
  test("ships as a Markdown file with the front matter the harness parses", async () => {
    expect((await stat(SKILL_FILE)).isFile()).toBe(true);
    const text = await readFile(SKILL_FILE, "utf8");
    const front = frontMatter(text);
    expect(front).toMatch(/^name:\s*contract-review$/mu);
    expect(front).toMatch(/^description:\s*>/mu);
    expect(front).toMatch(
      /^allowed-tools:\s*document_inspect document_compare document_diff_read$/mu,
    );
    expect(front).toMatch(/^version:\s*\d{4}-\d{2}-\d{2}$/mu);
  });

  test("tells the model which three tools the workflow needs", async () => {
    const text = await readFile(SKILL_FILE, "utf8");
    for (const tool of [
      "document_inspect",
      "document_compare",
      "document_diff_read",
    ]) {
      expect(text).toContain(`\`${tool}\``);
    }
    // No step of the workflow is a command: the skill never asks for one.
    expect(text).not.toMatch(/```(?:bash|sh|shell|console)/u);
    expect(text).not.toContain("git diff");
  });

  test("forbids comparing the documents independently", async () => {
    const text = await readFile(SKILL_FILE, "utf8");
    expect(text).toContain(
      "Do not\nindependently discover differences between the source documents",
    );
    expect(text).toContain(
      "If you do not have a `changeId`, you do not have a difference",
    );
  });

  test("names every signal the plugin can report", async () => {
    const text = await readFile(SKILL_FILE, "utf8");
    const { CHANGE_SIGNALS } =
      await import("../src/documents/comparison/types.js");
    for (const signal of CHANGE_SIGNALS) {
      expect(text).toContain(signal);
    }
  });

  test("keeps trigger phrases for the languages it is used in", async () => {
    const text = (await readFile(SKILL_FILE, "utf8")).replace(/\s+/gu, " ");
    expect(text).toContain("сравни редакции");
    expect(text).toContain("покажи риски");
  });
});

describe("the skill provider", () => {
  test("mounts an isolated provider over the vendored skill root", () => {
    const config = buildDocumentSkillsConfig();
    expect(config.providerName).toBe(DOCUMENT_SKILL_PROVIDER_NAME);
    expect(config.includeDefaultRoots).toBe(false);
    expect(config.bundledSkillDir).toBe(DOCUMENT_SKILLS_DIR);
    expect(path.basename(DOCUMENT_SKILLS_DIR)).toBe("skills");
  });
});
