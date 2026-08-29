import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const manifest = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
const dshVersion = process.env.DSH_VERSION ?? "0.1.1-rc.2";
const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-sleev-packed-smoke-"));
const toolDirectory = join(temporaryRoot, "tool");
const packageDirectory = join(temporaryRoot, "package");
const dshHome = join(temporaryRoot, "home");
const workspacePath = join(temporaryRoot, "workspace");
let completed = false;

async function pnpmEntryPoint() {
  const corepack = join(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "pnpm.js",
  );
  if (
    await stat(corepack).then(
      () => true,
      () => false,
    )
  )
    return corepack;
  const pnpmHome = process.env.PNPM_HOME;
  if (pnpmHome === undefined) return undefined;
  const tools = join(pnpmHome, ".tools", "pnpm");
  const versions = await readdir(tools).catch(() => []);
  for (const version of versions.toSorted().reverse()) {
    const candidate = join(tools, version, "bin", "pnpm.cjs");
    if (
      await stat(candidate).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  return undefined;
}

const pnpmCli = await pnpmEntryPoint();

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repo,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${code ?? signal})\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
  });
}

function runPnpm(args, options = {}) {
  const command = pnpmCli === undefined ? "pnpm" : process.execPath;
  const commandArgs = pnpmCli === undefined ? args : [pnpmCli, ...args];
  return run(command, commandArgs, options);
}

async function suppliedTarball() {
  const configured = process.env.DSH_SLEEV_TARBALL;
  if (configured === undefined) return undefined;
  const target = resolve(repo, configured);
  const details = await stat(target);
  if (details.isFile()) {
    if (!target.endsWith(".tgz"))
      throw new Error("supplied package is not a .tgz");
    return target;
  }
  if (!details.isDirectory())
    throw new Error("supplied package path is unusable");
  const tarballs = (await readdir(target)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (tarballs.length !== 1) {
    throw new Error("supplied package directory must contain one .tgz");
  }
  return join(target, tarballs[0]);
}

try {
  await Promise.all([
    mkdir(toolDirectory, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(temporaryRoot, "package.json"),
      `${JSON.stringify({ private: true }, null, 2)}\n`,
    ),
    writeFile(
      join(temporaryRoot, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - tool",
        "minimumReleaseAgeExclude:",
        '  - "@deepseek-ai/*"',
        "allowBuilds:",
        '  "@deepseek-ai/dsh-subprocess-local": true',
        '  "@google/genai": true',
        "  koffi: true",
        '  "node-pty": true',
        "  protobufjs: true",
        "",
      ].join("\n"),
    ),
    writeFile(
      join(toolDirectory, "package.json"),
      `${JSON.stringify({ private: true }, null, 2)}\n`,
    ),
  ]);

  let tarball = await suppliedTarball();
  if (tarball === undefined) {
    await mkdir(packageDirectory, { recursive: true });
    await runPnpm(["pack", "--pack-destination", packageDirectory]);
    const tarballs = (await readdir(packageDirectory)).filter((name) =>
      name.endsWith(".tgz"),
    );
    if (tarballs.length !== 1)
      throw new Error("pnpm pack did not create one tarball");
    tarball = join(packageDirectory, tarballs[0]);
  }

  await runPnpm(["add", "--ignore-scripts", `@deepseek-ai/dsh@${dshVersion}`], {
    cwd: toolDirectory,
  });
  const dshBin = join(
    toolDirectory,
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
  const dshEnv = { ...process.env, DSH_HOME: dshHome };
  await run(
    process.execPath,
    [dshBin, "plugin", "--profile", "web", "add", tarball],
    {
      cwd: workspacePath,
      env: dshEnv,
    },
  );
  const composed = await run(
    process.execPath,
    [dshBin, "--profile", "web", "--dump-config"],
    { cwd: workspacePath, env: dshEnv },
  );
  if (!composed.stdout.includes("dsh-sleev")) {
    throw new Error("packed plugin is absent from the composed DSH profile");
  }

  const profileManifest = JSON.parse(
    await readFile(join(dshHome, "profiles", "web", "package.json"), "utf8"),
  );
  if (!(manifest.name in profileManifest.dependencies)) {
    throw new Error(
      "packed plugin is absent from the DSH profile dependencies",
    );
  }
  if (!profileManifest.dsh?.profile?.bundles?.includes(manifest.name)) {
    throw new Error("packed plugin is absent from dsh.profile.bundles");
  }

  completed = true;
  console.log(
    `packed dsh-sleev smoke passed with DSH ${dshVersion} on ${process.platform}`,
  );
} finally {
  if (completed) await rm(temporaryRoot, { recursive: true, force: true });
  else console.error(`smoke workspace retained at ${temporaryRoot}`);
}
