import { spawnSync } from "node:child_process";
import { posix } from "node:path";

import {
  SESSION_SCOPE_ERROR,
  SessionScopeError,
  type EffectiveSessionScope,
} from "./session-scope.js";

export interface ScopeSandboxPolicy {
  mode: "read-only" | "workspace-write" | "danger-full-access" | string;
  workspaceRoot: string;
  [key: PropertyKey]: unknown;
}

export interface ScopeConfinedArgv {
  argv: string[];
  enforcement: "full" | "partial" | string;
  denialSignatures: readonly string[];
  runnerFailureRules: readonly unknown[];
  [key: string]: unknown;
}

export interface ScopeSandboxProvider {
  confine(argv: readonly string[], policy: ScopeSandboxPolicy): ScopeConfinedArgv;
}

export type BwrapProbeExecutor = (argv: readonly string[]) => boolean;

/** Same-world, non-serialized carrier added to DSH's per-call sandbox policy. */
export const SESSION_SCOPE_POLICY = Symbol.for("dsh-session-scope/policy");

const BWRAP_READ_ONLY_PROFILE = [
  "bwrap",
  "--ro-bind", "/", "/",
  "--dev", "/dev",
  "--proc", "/proc",
  "--die-with-parent",
] as const;
const BWRAP_STAGING_ROOT = "/dev/.dsh-session-scope";

function unavailable(detail: string): never {
  throw new SessionScopeError(
    SESSION_SCOPE_ERROR.ISOLATION_UNAVAILABLE,
    `Isolated session scope is unavailable: ${detail}.`,
  );
}

function normalizedAbsolute(path: string, label: string): string {
  if (!posix.isAbsolute(path) || path.includes("\0")) unavailable(`invalid ${label}`);
  return posix.normalize(path);
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expectedProfile(policy: ScopeSandboxPolicy): string[] {
  if (policy.mode === "read-only") return [...BWRAP_READ_ONLY_PROFILE];
  if (policy.mode === "workspace-write") {
    return [
      ...BWRAP_READ_ONLY_PROFILE,
      "--tmpfs", "/tmp",
      "--bind", policy.workspaceRoot, policy.workspaceRoot,
    ];
  }
  return unavailable("the active permission mode cannot be confined by the DSH bwrap provider");
}

function separatorIndex(argv: readonly string[]): number {
  const index = argv.indexOf("--");
  if (index < 0 || index === argv.length - 1) unavailable("the sandbox provider returned an invalid bwrap invocation");
  return index;
}

/** Require the exact, versioned DSH bwrap profile this plugin knows how to narrow. */
export function isSupportedBwrapInvocation(
  confined: ScopeConfinedArgv,
  policy: ScopeSandboxPolicy,
): boolean {
  if (confined.enforcement !== "full") return false;
  try {
    const separator = separatorIndex(confined.argv);
    return sameArray(confined.argv.slice(0, separator), expectedProfile(policy));
  } catch {
    return false;
  }
}

/**
 * Probe the official provider seam. The local provider performs its own
 * functional bwrap probe before returning this direct profile.
 */
export function detectBwrapIsolation(
  provider: ScopeSandboxProvider | undefined,
  workspaceRoot: string,
  platform = process.platform,
  execute: BwrapProbeExecutor = (argv) => {
    const result = spawnSync(argv[0], argv.slice(1), { stdio: "ignore", timeout: 5_000 });
    return result.error === undefined && result.status === 0;
  },
): boolean {
  if (platform !== "linux" || provider === undefined) return false;
  try {
    const policy: ScopeSandboxPolicy = { mode: "read-only", workspaceRoot };
    const confined = provider.confine(["true"], policy);
    if (!isSupportedBwrapInvocation(confined, policy)) return false;
    const probe = confineIsolatedBwrap(confined, policy, {
      mode: "isolated",
      workspaceRoot,
      roots: [],
      navigationRoots: [workspaceRoot],
    }, workspaceRoot);
    return execute(probe.argv);
  } catch {
    return false;
  }
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root === "/" ? "/" : `${root}/`);
}

function visibleWorkingDirectory(
  requested: string | undefined,
  workspaceRoot: string,
  roots: readonly string[],
): string {
  const workdir = normalizedAbsolute(
    requested === undefined ? workspaceRoot : posix.resolve(workspaceRoot, requested),
    "process working directory",
  );
  if (!isWithin(workdir, workspaceRoot)) unavailable("the process working directory is outside the session workspace");
  const content = roots.some((root) => isWithin(workdir, root));
  const navigation = workdir === workspaceRoot || roots.some((root) => isWithin(root, workdir));
  if (!content && !navigation) unavailable("the process working directory is outside the active session scope");
  return workdir;
}

function mountPointDirectories(workspaceRoot: string, roots: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (root === workspaceRoot) continue;
    const relative = posix.relative(workspaceRoot, root);
    let current = workspaceRoot;
    for (const segment of relative.split("/").filter(Boolean)) {
      current = posix.join(current, segment);
      if (!seen.has(current)) {
        seen.add(current);
        result.push(current);
      }
    }
  }
  return result;
}

/**
 * Replace DSH's whole-workspace bwrap view with an empty workspace plus only
 * the selected roots. Unknown argv dialects and partial enforcement fail closed.
 */
export function confineIsolatedBwrap(
  confined: ScopeConfinedArgv,
  policy: ScopeSandboxPolicy,
  scope: EffectiveSessionScope,
  requestedWorkingDirectory?: string,
): ScopeConfinedArgv {
  if (scope.mode !== "isolated") return confined;
  if (confined.enforcement !== "full") unavailable("the selected sandbox backend reports partial enforcement");

  const workspaceRoot = normalizedAbsolute(scope.workspaceRoot, "session workspace");
  if (workspaceRoot === "/") unavailable("the filesystem root cannot be used as an isolated workspace");
  if (isWithin(workspaceRoot, "/dev")) unavailable("a workspace under /dev cannot be isolated safely");
  if (normalizedAbsolute(policy.workspaceRoot, "sandbox workspace") !== workspaceRoot) {
    unavailable("the sandbox and session workspace boundaries do not match");
  }
  if (!isSupportedBwrapInvocation(confined, policy)) {
    unavailable("the sandbox provider is not the supported DSH bwrap profile");
  }

  const roots = scope.roots.map((root) => normalizedAbsolute(root, "scope root"));
  if (roots.some((root) => !isWithin(root, workspaceRoot))) unavailable("a selected root is outside the session workspace");
  const workdir = visibleWorkingDirectory(requestedWorkingDirectory, workspaceRoot, roots);
  const separator = separatorIndex(confined.argv);
  const command = confined.argv.slice(separator + 1);

  // Selecting the workspace root means the requested visible view is already
  // the whole workspace. Still pin cwd after bwrap establishes its mounts.
  if (roots.includes(workspaceRoot)) {
    return {
      ...confined,
      argv: [...confined.argv.slice(0, separator), "--chdir", workdir, "--", ...command],
    };
  }

  const profile = confined.argv.slice(0, separator);
  if (policy.mode === "workspace-write") profile.splice(profile.length - 3, 3);
  const bindFlag = policy.mode === "workspace-write" ? "--bind" : "--ro-bind";
  const mounts: string[] = ["--dir", BWRAP_STAGING_ROOT, "--tmpfs", BWRAP_STAGING_ROOT];
  for (let index = 0; index < roots.length; index += 1) {
    const staging = `${BWRAP_STAGING_ROOT}/${index}`;
    mounts.push("--dir", staging, bindFlag, roots[index]!, staging);
  }
  mounts.push("--tmpfs", workspaceRoot);
  for (const directory of mountPointDirectories(workspaceRoot, roots)) mounts.push("--dir", directory);
  for (let index = 0; index < roots.length; index += 1) {
    mounts.push(bindFlag, `${BWRAP_STAGING_ROOT}/${index}`, roots[index]!);
  }
  // Drop the alternate path to selected content and leave no new writable
  // scratch area behind, including under read-only permission.
  mounts.push("--tmpfs", BWRAP_STAGING_ROOT, "--remount-ro", BWRAP_STAGING_ROOT);

  return {
    ...confined,
    argv: [...profile, ...mounts, "--chdir", workdir, "--", ...command],
  };
}

/** Attach the effective scope without changing DSH's public policy shape. */
export function attachSessionScopePolicy<T extends object>(policy: T, scope: EffectiveSessionScope): T {
  return Object.assign({}, policy, { [SESSION_SCOPE_POLICY]: scope });
}

export function sessionScopeFromPolicy(policy: object): EffectiveSessionScope | undefined {
  return (policy as { [SESSION_SCOPE_POLICY]?: EffectiveSessionScope })[SESSION_SCOPE_POLICY];
}
