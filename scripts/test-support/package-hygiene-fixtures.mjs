import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Builds a `root/plugins/dsh-fixture` (and optionally `packages/*`) tree so the
 * discoverability checks can resolve a monorepo-relative directory.
 */
export async function workspaceFixture({ plugins = {}, packages = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-catalog-"));
  for (const [group, entries] of [
    ["plugins", plugins],
    ["packages", packages],
  ]) {
    for (const [name, manifest] of Object.entries(entries)) {
      const directory = path.join(root, group, name);
      mkdirSync(directory, { recursive: true });
      writeJson(path.join(directory, "package.json"), manifest);
    }
  }
  return root;
}
