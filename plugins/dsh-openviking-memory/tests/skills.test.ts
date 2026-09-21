/**
 * The skill surface (SPEC §22.3, §35).
 *
 * The `openviking-memory` skill teaches the model how to use OpenViking whether
 * or not automatic injection is on, and it is vendored inside the package so a
 * restricted workspace filesystem cannot hide it. These assertions cover the
 * provider config, the shipped bytes, and the mount the entry performs.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Config as SkillFilesystemConfig } from "@deepseek-ai/dsh-skill-filesystem";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildSkillsConfig,
  SKILL_PROVIDER_NAME,
  SKILLS_DIR,
} from "../src/skills.js";
import { createHarness, type Harness } from "./helpers/harness.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const SKILL_FILE = join(SKILLS_DIR, "openviking-memory", "SKILL.md");

/** The YAML front matter block of a Markdown skill, without the fences. */
function frontMatterOf(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error("the skill has no YAML front matter");
  return match[1]!;
}

/** The value of one top-level front-matter key, including its block content. */
function frontMatterValue(frontMatter: string, key: string): string {
  const lines = frontMatter.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return "";
  const value: string[] = [lines[index]!.slice(key.length + 1)];
  for (
    let i = index + 1;
    i < lines.length && /^\s+\S/.test(lines[i]!);
    i += 1
  ) {
    value.push(lines[i]!);
  }
  return value.join("\n").trim();
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe("buildSkillsConfig", () => {
  it("mounts an isolated provider over the vendored skill root", () => {
    const config = buildSkillsConfig();

    // Must not collide with DSH's own `filesystem` provider, which already
    // scans the project and user roots.
    expect(config.providerName).toBe("openviking");
    expect(config.providerName).toBe(SKILL_PROVIDER_NAME);
    expect(config.includeDefaultRoots).toBe(false);
    expect(config.bundledSkillDir).toBe(SKILLS_DIR);
  });

  it("the provider config validates against the pinned provider's own schema", async () => {
    const result =
      await SkillFilesystemConfig["~standard"].validate(buildSkillsConfig());

    expect(result.issues).toBeUndefined();
  });
});

describe("the vendored skill", () => {
  it("ships at the served path under the package root", () => {
    expect(SKILLS_DIR.replaceAll("\\", "/").endsWith("/skills")).toBe(true);
    expect(SKILLS_DIR.startsWith(packageRoot)).toBe(true);

    expect(existsSync(SKILL_FILE)).toBe(true);
    // The same file also sits under the working directory's package root, which
    // is what a checkout without a build step serves.
    expect(
      existsSync(
        join(process.cwd(), "skills", "openviking-memory", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("carries the YAML front matter the catalog parses", async () => {
    const text = await readFile(SKILL_FILE, "utf8");

    expect(text.startsWith("---\nname: openviking-memory\n")).toBe(true);

    const frontMatter = frontMatterOf(text);
    expect(frontMatterValue(frontMatter, "name")).toBe("openviking-memory");
    // A non-empty description, parsed rather than snapshot-compared: the
    // catalog only needs a usable trigger description, and the wording is free
    // to change.
    expect(frontMatterValue(frontMatter, "description").length).toBeGreaterThan(
      0,
    );
  });

  it("scopes its trigger to memory and names the sources that outrank it", async () => {
    const text = await readFile(SKILL_FILE, "utf8");
    const description = frontMatterValue(frontMatterOf(text), "description");

    // The defect this guards: the description claimed the skill for any task
    // that lacked context, so a model that could not read an attached document
    // read that gap as a reason to go to memory. A trigger that owns every gap
    // is a trigger the model cannot decline.
    expect(description).not.toContain("even if nobody says the word");
    expect(description).not.toMatch(/task needs\s+context/i);
    expect(description).toContain("not the default");

    // The order, and the habits that follow from it, are in the body: the
    // skill has to say what to read instead, not only what not to.
    expect(text).toContain("## Memory is not the first source");
    expect(text).toContain("Product documentation and the domain expert");
    expect(text).toContain("A memory miss is not an answer");
  });

  it("stays readable outside a restricted workspace filesystem", async () => {
    // A plain package read rather than a walk through the workspace filesystem
    // service, which refuses paths outside the project.
    await expect(readFile(SKILL_FILE, "utf8")).resolves.toBeTypeOf("string");
  });
});

describe("the entry's skill mount", () => {
  it("mounting passes the provider plugin and its config to the host context", async () => {
    harness = await createHarness({ endpoint: "http://127.0.0.1:1933" });

    const providers = harness.mounted.filter(
      (entry) =>
        (entry.config as { providerName?: string } | undefined)
          ?.providerName === "openviking",
    );

    expect(providers).toHaveLength(1);
    const provider = providers[0]!;
    expect((provider.plugin as { name?: string }).name).toBe(
      "skill-filesystem",
    );
    expect(typeof (provider.plugin as { apply?: unknown }).apply).toBe(
      "function",
    );
    expect(
      (provider.config as { bundledSkillDir?: string }).bundledSkillDir,
    ).toBe(SKILLS_DIR);
  });

  it("apply mounts both the tool surface and the skill", async () => {
    harness = await createHarness({ autoInject: false, syncTurns: false });

    expect(harness.mounted).toHaveLength(2);
    expect(
      harness.mounted.filter(
        (entry) =>
          (entry.config as { serverName?: string } | undefined)?.serverName ===
          "openviking",
      ),
    ).toHaveLength(1);
    expect(
      harness.mounted.filter(
        (entry) =>
          (entry.config as { providerName?: string } | undefined)
            ?.providerName === "openviking",
      ),
    ).toHaveLength(1);
  });
});
