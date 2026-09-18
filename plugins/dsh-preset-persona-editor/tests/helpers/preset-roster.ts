/**
 * The roster fixture the file-layer tests share: presets in a real temporary
 * directory, resolved through the same face the plugin reads the host with.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PresetRosterFace } from "../../src/host/preset-reader.js";

/** One preset the fixture knows: where its composition is, and who owns it. */
export interface FixturePreset {
  readonly path: string;
  readonly trust: "system" | "user";
}

/** A roster over the presets a test registered, keyed by id. */
export function rosterOf(
  entries: Record<string, FixturePreset>,
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

/** Write one composition into a temporary root and answer its path. */
export async function writePresetFile(
  root: string,
  id: string,
  text: string,
): Promise<string> {
  const directory = join(root, id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const path = join(directory, "agent.cordis.yml");
  await writeFile(path, text, "utf8");
  return path;
}
