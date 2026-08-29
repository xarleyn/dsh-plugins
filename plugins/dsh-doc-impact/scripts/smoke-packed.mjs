// Packed-install smoke: install an npm tarball of this plugin into a clean
// temporary project and verify the shipped bundle actually works there.
//
// Usage: node scripts/smoke-packed.mjs <tarball-or-directory>
//
// Verifies, in order of increasing strength:
//   1. the required runtime files ship in the tarball
//     (dist/index.js, lib/client.js, cordis.patch.yml);
//   2. the client bundle registers itself under the expected ModuleLoader id;
//   3. the ESM entry imports in a clean environment (npm auto-installs peer
//      dependencies) and exports the plugin contract (name/inject/apply).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_NAME = "@yadsh/dsh-doc-impact";

function fail(message) {
  throw new Error(`smoke-packed: ${message}`);
}

function npm(args, cwd) {
  // Prefer the npm CLI shipped next to the running Node: no shell involved,
  // so arguments and output stay exact on every platform.
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const hasCli = existsSync(npmCli);
  const result = hasCli
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: "pipe", encoding: "utf8" })
    : spawnSync("npm", args, { cwd, shell: process.platform === "win32", stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    fail(`npm ${args.join(" ")} failed (exit ${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result.stdout;
}

const target = process.argv[2];
if (target === undefined) fail("usage: node scripts/smoke-packed.mjs <tarball-or-directory>");
const statTarget = await stat(target).catch(() => undefined);
if (statTarget === undefined) fail(`no such file or directory: ${target}`);

let tarball;
if (statTarget.isDirectory()) {
  const candidates = (await readdir(target)).filter((name) => name.endsWith(".tgz"));
  if (candidates.length === 0) fail(`no .tgz artifact in ${target}`);
  if (candidates.length > 1) fail(`ambiguous artifact directory: ${candidates.join(", ")}`);
  tarball = join(resolve(target), candidates[0]);
} else {
  if (!target.endsWith(".tgz")) fail(`not a tarball: ${target}`);
  tarball = resolve(target);
}

const root = await mkdtemp(join(tmpdir(), "dsh-doc-impact-smoke-"));
try {
  npm(["init", "--yes"], root);
  npm(["install", "--ignore-scripts", "--package-lock=false", tarball], root);

  const installed = join(root, "node_modules", PACKAGE_NAME);

  // 1. Required runtime files ship in the tarball.
  for (const relative of ["dist/index.js", "lib/client.js", "cordis.patch.yml"]) {
    const info = await stat(join(installed, relative)).catch(() => undefined);
    if (info === undefined || !info.isFile()) fail(`packed package is missing ${relative}`);
  }

  // 2. The client bundle registers the expected ModuleLoader id.
  const client = await readFile(join(installed, "lib/client.js"), "utf8");
  if (!client.includes('id: "dsh-doc-impact"')) {
    fail("client bundle does not register the dsh-doc-impact ModuleLoader id");
  }

  // 3. The ESM entry imports and exposes the plugin contract.
  const entry = join(installed, "dist", "index.js");
  const probe = `const plugin = await import(${JSON.stringify(pathToFileURL(entry).href)}); if (plugin.name !== ${JSON.stringify("doc-impact")}) throw new Error("unexpected plugin name: " + plugin.name); if (!Array.isArray(plugin.inject) || !plugin.inject.includes("tools")) throw new Error("plugin inject must include tools"); if (typeof plugin.apply !== "function") throw new Error("plugin.apply is not a function"); console.log("smoke-packed: entry OK (" + plugin.name + ")");`;
  const check = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: root,
    encoding: "utf8",
  });
  if (check.status !== 0) {
    fail(`entry import failed\n${check.stdout ?? ""}\n${check.stderr ?? ""}`);
  }
  process.stdout.write(`${check.stdout.trim()}\n`);
  process.stdout.write(`smoke-packed: OK (${PACKAGE_NAME} @ ${tarball})\n`);
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
