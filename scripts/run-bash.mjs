import { existsSync } from "node:fs";
import { win32 as windowsPath } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

function findWithWhere(executable) {
  const result = spawnSync("where.exe", [executable], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isMsysBash(candidate) {
  const normalized = windowsPath.normalize(candidate).toLowerCase();
  if (normalized.endsWith("\\windows\\system32\\bash.exe")) return false;
  return normalized.endsWith("\\bin\\bash.exe") || normalized.endsWith("\\usr\\bin\\bash.exe");
}

function bashCandidatesFromGit(gitExecutable) {
  const gitDirectory = windowsPath.dirname(gitExecutable);
  const directoryName = gitDirectory.split(/[\\/]/u).at(-1)?.toLowerCase();
  if (directoryName !== "cmd" && directoryName !== "bin") return [];

  const gitRoot = windowsPath.dirname(gitDirectory);
  return [
    windowsPath.join(gitRoot, "bin", "bash.exe"),
    windowsPath.join(gitRoot, "usr", "bin", "bash.exe"),
  ];
}

/**
 * Find the MSYS Git Bash executable used by repository shell gates.
 * Dependencies are injectable so discovery stays deterministic in unit tests.
 */
export function discoverBash({
  platform = process.platform,
  env = process.env,
  exists = existsSync,
  findOnPath = findWithWhere,
} = {}) {
  if (platform !== "win32") return "bash";

  const checked = [];
  const tryCandidate = (candidate, source, requireMsysLayout = true) => {
    if (!candidate) return undefined;
    if (requireMsysLayout && !isMsysBash(candidate)) {
      checked.push(`${source}: ${candidate} (not an MSYS Git Bash path)`);
      return undefined;
    }
    if (!exists(candidate)) {
      checked.push(`${source}: ${candidate} (not found)`);
      return undefined;
    }
    checked.push(`${source}: ${candidate}`);
    return candidate;
  };

  const explicit = tryCandidate(env.DSH_BASH_PATH, "DSH_BASH_PATH", false);
  if (explicit) return explicit;

  const pathBashCandidates = findOnPath("bash.exe");
  if (pathBashCandidates.length === 0) {
    checked.push("PATH (where.exe bash.exe): no candidates");
  }
  for (const candidate of pathBashCandidates) {
    const bash = tryCandidate(candidate, "PATH (where.exe bash.exe)");
    if (bash) return bash;
  }

  const pathGitCandidates = findOnPath("git.exe");
  if (pathGitCandidates.length === 0) {
    checked.push("PATH (where.exe git.exe): no candidates");
  }
  for (const gitExecutable of pathGitCandidates) {
    checked.push(`PATH (where.exe git.exe): ${gitExecutable}`);
    for (const candidate of bashCandidatesFromGit(gitExecutable)) {
      const bash = tryCandidate(candidate, `derived from ${gitExecutable}`);
      if (bash) return bash;
    }
  }

  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  for (const candidate of [
    windowsPath.join(programFiles, "Git", "bin", "bash.exe"),
    windowsPath.join(programFiles, "Git", "usr", "bin", "bash.exe"),
  ]) {
    const bash = tryCandidate(candidate, "ProgramFiles");
    if (bash) return bash;
  }

  if (checked.length === 0) checked.push("no candidates were returned");
  throw new Error([
    "Git Bash is required on Windows to run repository shell gates.",
    "Checked candidates:",
    ...checked.map((candidate) => `- ${candidate}`),
    "Set DSH_BASH_PATH to an existing Git Bash executable to override discovery.",
  ].join("\n"));
}

export function main(argv = process.argv.slice(2)) {
  const [script, ...args] = argv;

  if (!script) {
    console.error("Usage: node scripts/run-bash.mjs <script> [...args]");
    return 2;
  }

  let bash;
  try {
    bash = discoverBash();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const result = spawnSync(bash, [script, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(main());
}
