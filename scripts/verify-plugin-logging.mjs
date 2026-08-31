import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const pluginsRoot = join(workspaceRoot, "plugins");

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

const pluginDirectories = (await readdir(pluginsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const checked = [];
const sharedLoggerImport = /(?:from\s+|import\s*\()\s*["']@yadsh\/dsh-plugin-log["']/u;
for (const directory of pluginDirectories) {
  let manifestText;
  try {
    manifestText = await readFile(new URL(`../plugins/${directory}/package.json`, import.meta.url), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }

  const manifest = JSON.parse(manifestText);
  assert.equal(
    manifest.dependencies?.["@yadsh/dsh-plugin-log"],
    "workspace:^",
    `${manifest.name} must depend on @yadsh/dsh-plugin-log`,
  );

  const sourceRoot = join(pluginsRoot, directory, "src");
  const sourceFiles = (await filesUnder(sourceRoot)).filter((path) => /\.[cm]?[jt]sx?$/u.test(path));
  const sources = await Promise.all(sourceFiles.map(async (path) => ({
    path,
    text: await readFile(path, "utf8"),
  })));
  assert.ok(
    sources.some(({ text }) => sharedLoggerImport.test(text)),
    `${manifest.name} host source must initialize shared logging`,
  );

  for (const source of sources) {
    const sourcePath = relative(workspaceRoot, source.path)
      .split(sep)
      .join("/");
    const isClient = /\/src\/client(?:\/|\.[^/]+$)/u.test(`/${sourcePath}`);
    if (isClient) {
      assert.ok(
        !sharedLoggerImport.test(source.text),
        `${sourcePath} must not import the server-only logger`,
      );
    }
  }
  checked.push(manifest.name);
}

assert.ok(checked.length > 0, "no plugin packages were discovered");
console.log(`plugin logging verified for ${checked.length} packages`);
