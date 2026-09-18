/**
 * Shared fixtures for the preset file-layer tests, moved here verbatim from
 * the single-file original.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

import type { PresetRosterFace } from "../src/host/preset-reader.js";
import {
  savePersona as writePreset,
  type WriteContext,
} from "../src/host/preset-writer.js";
import type { PersonaDraft, PresetDraft } from "../src/types.js";

/**
 * The persona-only form of a save: these tests all start from a preset with no
 * prompt sections, so the sections half is empty.
 */
export function savePersona(
  context: WriteContext,
  id: string,
  persona: Partial<PersonaDraft> | undefined,
  expectedRevision: string,
): ReturnType<typeof writePreset> {
  const draft: Partial<PresetDraft> = {
    persona: persona as PersonaDraft,
    sections: [],
  };
  return writePreset(context, id, draft, expectedRevision);
}

/** A composition with a persona row and one row this editor must not touch. */
export const OWNED_PRESET = [
  "- id: persona",
  "  name: '@deepseek-ai/dsh-persona'",
  "  config:",
  "    prefix: You are the shipped demo persona.",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "",
].join("\n");

/** A composition that inherits the deployment's persona. */
export const INHERITED_PRESET = [
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "",
].join("\n");

export const DRAFT: PersonaDraft = {
  prefix: "You are a careful reviewer.\nPrefer small, reviewable changes.",
  suffix: "Answer in the user's language.",
  complete: false,
  includeRuntimeContext: false,
};

export let root = "";
let writes = 0;

/** Write one composition into the temporary root. */
export async function preset(
  text: string,
  id = `preset-${writes}`,
): Promise<string> {
  writes += 1;
  const directory = join(root, id);
  await rm(directory, { recursive: true, force: true });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "agent.cordis.yml");
  await writeFile(path, text, "utf8");
  return path;
}

/** A roster over the presets a test registered, keyed by id. */
export function rosterOf(
  entries: Record<string, { path: string; trust: "system" | "user" }>,
  defaultId = "",
): PresetRosterFace {
  const resolve = async (id?: string) => {
    const entry = entries[id ?? ""];
    if (entry === undefined) throw new Error("agent-preset/not-found");
    return {
      id: id ?? "",
      trust: entry.trust,
      path: entry.path,
      name: `preset ${id ?? ""}`,
    };
  };
  return {
    list: async () =>
      await Promise.all(
        Object.keys(entries).map(async (id) => await resolve(id)),
      ),
    resolve,
    authorable: Object.values(entries).some((entry) => entry.trust === "user"),
    defaultId,
    copy: async () => undefined,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "preset-persona-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
