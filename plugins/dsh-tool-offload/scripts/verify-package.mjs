/**
 * Package gate for @yadsh/dsh-tool-offload (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, packaged file list, and the attribution contract without
 * hitting the network. The shared checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

async function jsFilesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await jsFilesUnder(path)));
    } else if (entry.name.endsWith(".js")) {
      files.push(path);
    }
  }
  return files;
}

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-tool-offload",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  exports: [".", "./package.json"],
  client: "none",
  files: [
    "lib",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "NOTICE.md",
    "LICENSE",
  ],
  patch: { headerComment: true, id: "dsh-tool-offload" },
  compatibility: {
    range: true,
    testedReleases: true,
    // The plugin requires the post-execute reshaping seam and the one-shot
    // subagent service.
    hostFeatures: ["tools/post-execute", "subagents/start"],
  },
  extra: async ({ packageRoot, readFile: readFromRoot }) => {
    // Safety-critical surface shipped by the build: no-tools worker invariant
    // and recursion label must stay part of the compiled runtime (SPEC §6.1,
    // §25).
    const libRoot = fileURLToPath(new URL("lib/", packageRoot));
    const libFiles = await jsFilesUnder(libRoot);
    assert.ok(libFiles.length > 0, "lib build output is missing");
    const libText = (
      await Promise.all(libFiles.map((path) => readFile(path, "utf8")))
    ).join("\n");
    assert.ok(
      libText.includes("dsh-tool-offload:"),
      "built runtime must keep the worker label prefix",
    );
    assert.ok(
      libText.includes('"subagent"'),
      "built runtime must reference the delegated-child origin guard",
    );
    assert.ok(
      libText.includes("allow: []"),
      "built runtime must keep the no-tools worker filter",
    );

    // Attribution contract of the plugin (SPEC §28).
    const readme = await readFromRoot("README.md");
    assert.match(readme, /## Credits/);
    assert.match(readme, /portal-ai-plugins\/shunt|Spotify/);
    const notice = await readFromRoot("NOTICE.md");
    assert.match(notice, /Spotify/);
    assert.match(notice, /shunt/);

    // Docs.
    await readFromRoot("SPEC.md");
  },
});
