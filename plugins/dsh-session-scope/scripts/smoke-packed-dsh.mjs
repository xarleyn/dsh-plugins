import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const testedReleases = compatibility.deepseekHarness?.testedReleases;
if (!Array.isArray(testedReleases) || testedReleases.length === 0) {
  throw new Error("compatibility.json must declare testedReleases");
}

const dshVersion = process.env.DSH_VERSION ?? testedReleases.at(-1);
if (!testedReleases.includes(dshVersion)) {
  throw new Error(`DSH ${dshVersion} is not present in testedReleases`);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-session-scope-smoke-"));
const artifactDirectory = join(temporaryRoot, "artifact");
const toolDirectory = join(temporaryRoot, "tool");
const dshHome = join(temporaryRoot, "home");
const workspace = join(temporaryRoot, "workspace");
let completed = false;

async function pnpmEntryPoint() {
  const corepackPnpm = join(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "pnpm.js",
  );
  if (await stat(corepackPnpm).then(() => true, () => false)) return corepackPnpm;

  const pnpmHome = process.env.PNPM_HOME;
  if (pnpmHome === undefined) return undefined;
  const tools = join(pnpmHome, ".tools", "pnpm");
  const versions = await readdir(tools).catch(() => []);
  for (const version of versions.toSorted().reverse()) {
    const candidate = join(tools, version, "bin", "pnpm.cjs");
    if (await stat(candidate).then(() => true, () => false)) return candidate;
  }
  return undefined;
}

const pnpmCli = await pnpmEntryPoint();

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repo,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: options.shell ?? false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else reject(new Error(
        `${command} ${args.join(" ")} failed (${code ?? signal})\n${stdout}\n${stderr}`,
      ));
    });
  });
}

function runPnpm(args, options = {}) {
  if (pnpmCli === undefined) {
    return run("pnpm", args, { ...options, shell: process.platform === "win32" });
  }
  return run(process.execPath, [pnpmCli, ...args], {
    ...options,
    env: { ...(options.env ?? process.env), NODE_OPTIONS: "--max-old-space-size=4096" },
  });
}

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  if (npmCli !== undefined) return run(process.execPath, [npmCli, ...args], options);
  return run("npm", args, { ...options, shell: process.platform === "win32" });
}

async function suppliedTarball() {
  const configured = process.env.DSH_SESSION_SCOPE_TARBALL;
  if (configured === undefined) return undefined;
  const target = resolve(repo, configured);
  const details = await stat(target);
  if (details.isFile()) {
    if (!target.endsWith(".tgz")) throw new Error("supplied package is not a .tgz");
    return target;
  }
  if (!details.isDirectory()) throw new Error("supplied package path is unusable");
  const tarballs = (await readdir(target)).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error("supplied package directory must contain exactly one .tgz");
  }
  return join(target, tarballs[0]);
}

try {
  await Promise.all([
    mkdir(artifactDirectory, { recursive: true }),
    mkdir(toolDirectory, { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ]);
  await writeFile(
    join(toolDirectory, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );

  let tarball = await suppliedTarball();
  if (tarball === undefined) {
    await runNpm(["pack", "--pack-destination", artifactDirectory]);
    const tarballs = (await readdir(artifactDirectory)).filter((name) => name.endsWith(".tgz"));
    if (tarballs.length !== 1) throw new Error("npm pack did not create exactly one tarball");
    tarball = join(artifactDirectory, tarballs[0]);
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

  await run(process.execPath, [dshBin, "plugin", "--profile", "web", "add", tarball], {
    cwd: workspace,
    env: dshEnv,
  });
  const composed = await run(
    process.execPath,
    [dshBin, "--profile", "web", "--dump-config"],
    { cwd: workspace, env: dshEnv },
  );
  if (!composed.stdout.includes("dsh-session-scope")) {
    throw new Error("packed plugin is absent from the composed DSH web profile");
  }

  const profileManifest = JSON.parse(
    await readFile(join(dshHome, "profiles", "web", "package.json"), "utf8"),
  );
  const installed = {
    ...profileManifest.dependencies,
    ...profileManifest.devDependencies,
  };
  if (!("@yadsh/dsh-session-scope" in installed)) {
    throw new Error("DSH profile manifest does not contain @yadsh/dsh-session-scope");
  }

  completed = true;
  console.log(`packed DSH ${dshVersion} composition smoke passed on ${process.platform}`);
} finally {
  if (completed || process.env.KEEP_SMOKE_TEMP !== "1") {
    await rm(temporaryRoot, { recursive: true, force: true });
  } else {
    console.error(`smoke workspace retained at ${temporaryRoot}`);
  }
}
