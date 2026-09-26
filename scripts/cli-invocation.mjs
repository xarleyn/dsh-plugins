import { statSync } from "node:fs";
import path from "node:path";

const scriptEntry = /\.(?:c|m)?js$/iu;
const shellShim = /\.(?:cmd|bat)$/iu;

/**
 * Where a package-manager CLI is, and how to spawn it.
 *
 * `npm_execpath` names the entry point of the manager that started a script,
 * and that entry is a JS wrapper only for an npm-global or corepack install
 * (`pnpm.cjs`); a self-managed or standalone install points it at an executable
 * (`pnpm.exe`). An executable is not node source - node reads a PE header as a
 * script and dies - so the hint is a location, never a script: the suffix of
 * the file decides the spawn. A `.js`/`.cjs`/`.mjs` entry runs through node,
 * anything else runs itself, and a `.cmd`/`.bat` shim goes through a shell
 * because it is not a CreateProcess target.
 */
export function resolveCliInvocation({
  name,
  entryCandidates = [],
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  isFile = (entry) =>
    statSync(entry, { throwIfNoEntry: false })?.isFile() ?? false,
} = {}) {
  const pathApi = pathApiFor(platform);
  const hint = ownEntry(env.npm_execpath, name, pathApi);
  const candidates = [
    hint,
    ...entryCandidates,
    ...fromPath(name, { pathApi, platform, env }),
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || !isFile(candidate)) continue;
    if (scriptEntry.test(candidate)) {
      return { command: execPath, prefix: [candidate], shell: false };
    }
    return { command: candidate, prefix: [], shell: shellShim.test(candidate) };
  }

  return undefined;
}

/**
 * `npm_execpath` names whichever manager started the run, so a tool takes the
 * hint only when the hint is that tool's own CLI.
 */
function ownEntry(entry, name, pathApi) {
  if (entry === undefined) return undefined;
  return pathApi.basename(entry).toLowerCase().startsWith(name)
    ? entry
    : undefined;
}

function fromPath(name, { pathApi, platform, env }) {
  // Windows runs a PATH hit only when its suffix is in PATHEXT, so the
  // extensionless POSIX script shipped beside `pnpm.CMD` is not what `pnpm` is.
  const suffixes =
    platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  const hits = [];
  for (const directory of (env.PATH ?? "").split(pathApi.delimiter)) {
    if (directory === "") continue;
    for (const suffix of suffixes) {
      hits.push(pathApi.join(directory, `${name}${suffix}`));
    }
  }
  return hits;
}

/** A path flavour that matches the platform under test, not just this host. */
function pathApiFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}
