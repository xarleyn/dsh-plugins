// Build a pnpm tarball in a temporary directory and exercise the exact files
// consumers will install. The directory is always removed, so this check does
// not leave release artifacts in the working tree.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = await mkdtemp(join(tmpdir(), "dsh-doc-impact-package-"));

function run(command, args) {
  let executable = command;
  let commandArgs = args;
  let shell = false;
  if (command === "npm") {
    const bundledNpm = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const npmCli = process.env.npm_execpath ?? (existsSync(bundledNpm) ? bundledNpm : undefined);
    if (npmCli === undefined) {
      throw new Error("cannot locate the npm CLI used to run the package check");
    }
    executable = process.execPath;
    commandArgs = [npmCli, ...args];
  } else if (command === "pnpm" && process.platform === "win32") {
    executable = "pnpm.cmd";
    shell = true;
  }

  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    shell,
  });
  if (result.status !== 0) {
    const detail = result.error === undefined ? "" : `: ${result.error.message}`;
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${detail}`);
  }
}

try {
  // pnpm rewrites catalog:/workspace: protocols to publishable semver ranges.
  // Pack the still-local runtime dependency as well so first-release
  // verification never relies on it already existing in the npm registry.
  run("pnpm", [
    "--dir",
    "../../packages/plugin-log",
    "pack",
    "--pack-destination",
    artifactDirectory,
  ]);
  run("pnpm", ["pack", "--pack-destination", artifactDirectory]);
  const artifacts = (await readdir(artifactDirectory)).filter((name) => name.endsWith(".tgz"));
  const pluginArtifact = artifacts.find((name) => name.startsWith("yadsh-dsh-doc-impact-"));
  const loggerArtifact = artifacts.find((name) => name.startsWith("yadsh-dsh-plugin-log-"));
  if (pluginArtifact === undefined || loggerArtifact === undefined || artifacts.length !== 2) {
    throw new Error(`expected plugin and logger pnpm tarballs, found ${artifacts.join(", ")}`);
  }
  run(process.execPath, [
    "scripts/smoke-packed.mjs",
    join(artifactDirectory, pluginArtifact),
    join(artifactDirectory, loggerArtifact),
  ]);
  process.stdout.write("verify-package: publish artifact is ready\n");
} finally {
  await rm(artifactDirectory, { recursive: true, force: true });
}
