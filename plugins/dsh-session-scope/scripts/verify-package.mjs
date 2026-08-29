import { access, readFile } from "node:fs/promises";

const packageUrl = new URL("../package.json", import.meta.url);
const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(packageUrl, "utf8"));

if (manifest.name !== "@yadsh/dsh-session-scope") {
  throw new Error(`unexpected package name ${JSON.stringify(manifest.name)}`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error(`package version is not SemVer: ${JSON.stringify(manifest.version)}`);
}
if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") {
  throw new Error("package does not expose the DSH bundle patch");
}
if (manifest.author !== "xarleyn") {
  throw new Error(`unexpected package author ${JSON.stringify(manifest.author)}`);
}
if (
  manifest.publishConfig?.access !== "public" ||
  manifest.publishConfig?.registry !== "https://registry.npmjs.org/"
) {
  throw new Error("package publishing must target the public npm registry");
}
if (
  manifest.repository?.type !== "git" ||
  manifest.repository?.url !== "git+https://github.com/xarleyn/dsh-plugins.git" ||
  manifest.repository?.directory !== "plugins/dsh-session-scope"
) {
  throw new Error("package repository must identify its canonical monorepo directory");
}

const requiredFiles = new Set([
  "lib",
  "cordis.patch.yml",
  "compatibility.json",
  "README.md",
  "LICENSE",
]);
for (const file of requiredFiles) {
  if (!manifest.files?.includes(file)) throw new Error(`package files omit ${file}`);
}

for (const [subpath, descriptor] of Object.entries(manifest.exports ?? {})) {
  if (subpath === "./package.json") continue;
  for (const field of ["types", "import"]) {
    const target = descriptor?.[field];
    if (typeof target !== "string") throw new Error(`${subpath} has no ${field} export`);
    await access(new URL(target.replace(/^\.\//, ""), root));
  }
}
if (manifest.exports?.["./client"]?.default !== "./lib/client.js") {
  throw new Error("./client must expose the default bundle path required by DSH client composition");
}

const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");
if (
  !patch.includes("id: dsh-session-scope") ||
  !patch.includes('name: "@yadsh/dsh-session-scope"')
) {
  throw new Error("bundle patch does not mount dsh-session-scope");
}
if (/dsh-draft-sessions|draftSessions\//.test(JSON.stringify(manifest) + patch)) {
  throw new Error("package metadata contains foreign draft-sessions identifiers");
}
