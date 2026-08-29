import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  SESSION_SCOPE_POLICY,
  attachSessionScopePolicy,
  confineIsolatedBwrap,
  detectBwrapIsolation,
  isSupportedBwrapInvocation,
  sessionScopeFromPolicy,
  type ScopeConfinedArgv,
  type ScopeSandboxPolicy,
} from "../src/scope-sandbox-linux.js";
import { SESSION_SCOPE_ERROR, type EffectiveSessionScope } from "../src/session-scope.js";

const workspace = "/workspace";
const bwrapWorks = process.platform === "linux" && spawnSync("bwrap", [
  "--ro-bind", "/", "/",
  "--dev", "/dev",
  "--proc", "/proc",
  "--die-with-parent",
  "--", "true",
], { encoding: "utf8" }).status === 0;
const policy = (mode: "read-only" | "workspace-write" = "read-only"): ScopeSandboxPolicy => ({
  mode,
  workspaceRoot: workspace,
});
const scope = (roots = ["/workspace/apps/a", "/workspace/libs/b"]): EffectiveSessionScope => ({
  mode: "isolated",
  workspaceRoot: workspace,
  roots,
  navigationRoots: [workspace, "/workspace/apps", "/workspace/libs"],
});

function wrap(mode: "read-only" | "workspace-write" = "read-only"): ScopeConfinedArgv {
  return {
    argv: [
      "bwrap",
      "--ro-bind", "/", "/",
      "--dev", "/dev",
      "--proc", "/proc",
      "--die-with-parent",
      ...(mode === "workspace-write"
        ? ["--tmpfs", "/tmp", "--bind", workspace, workspace]
        : []),
      "--", "bash", "-c", "pwd",
    ],
    enforcement: "full",
    denialSignatures: ["read-only file system"],
    runnerFailureRules: [],
  };
}

describe("Linux isolated bwrap profile", () => {
  test("recognizes only the exact full-enforcement DSH bwrap profile", () => {
    expect(isSupportedBwrapInvocation(wrap(), policy())).toBe(true);
    expect(isSupportedBwrapInvocation({ ...wrap(), enforcement: "partial" }, policy())).toBe(false);
    expect(isSupportedBwrapInvocation({ ...wrap(), argv: ["landlock-run", "--", "true"] }, policy())).toBe(false);
    expect(isSupportedBwrapInvocation({ ...wrap(), argv: ["sudo", ...wrap().argv] }, policy())).toBe(false);
  });

  test("uses the provider's functional selection result for capability detection", () => {
    const provider = { confine: vi.fn(() => ({ ...wrap(), argv: [...wrap().argv.slice(0, -3), "true"] })) };
    const execute = vi.fn(() => true);
    expect(detectBwrapIsolation(provider, workspace, "linux", execute)).toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.arrayContaining([
      "bwrap", "--tmpfs", workspace, "--remount-ro", "/dev/.dsh-session-scope", "true",
    ]));
    expect(detectBwrapIsolation(provider, workspace, "linux", () => false)).toBe(false);
    expect(detectBwrapIsolation(provider, workspace, "win32", execute)).toBe(false);
    expect(detectBwrapIsolation({ confine: () => { throw new Error("unavailable"); } }, workspace, "linux", execute)).toBe(false);
  });

  test("hides the workspace, creates ancestors, and read-only binds selected roots", () => {
    expect(confineIsolatedBwrap(wrap(), policy(), scope(), "/workspace/apps/a/src").argv).toEqual([
      "bwrap",
      "--ro-bind", "/", "/",
      "--dev", "/dev",
      "--proc", "/proc",
      "--die-with-parent",
      "--dir", "/dev/.dsh-session-scope",
      "--tmpfs", "/dev/.dsh-session-scope",
      "--dir", "/dev/.dsh-session-scope/0",
      "--ro-bind", "/workspace/apps/a", "/dev/.dsh-session-scope/0",
      "--dir", "/dev/.dsh-session-scope/1",
      "--ro-bind", "/workspace/libs/b", "/dev/.dsh-session-scope/1",
      "--tmpfs", workspace,
      "--dir", "/workspace/apps",
      "--dir", "/workspace/apps/a",
      "--dir", "/workspace/libs",
      "--dir", "/workspace/libs/b",
      "--ro-bind", "/dev/.dsh-session-scope/0", "/workspace/apps/a",
      "--ro-bind", "/dev/.dsh-session-scope/1", "/workspace/libs/b",
      "--tmpfs", "/dev/.dsh-session-scope",
      "--remount-ro", "/dev/.dsh-session-scope",
      "--chdir", "/workspace/apps/a/src",
      "--", "bash", "-c", "pwd",
    ]);
  });

  test("replaces the global writable workspace bind with selected writable binds", () => {
    const argv = confineIsolatedBwrap(wrap("workspace-write"), policy("workspace-write"), scope()).argv;
    expect(argv).toContain("/tmp");
    expect(argv).toContain("--tmpfs");
    expect(argv.join("\0")).not.toContain(["--bind", workspace, workspace].join("\0"));
    expect(argv.join("\0")).toContain(["--bind", "/workspace/apps/a", "/dev/.dsh-session-scope/0"].join("\0"));
    expect(argv.join("\0")).toContain(["--bind", "/dev/.dsh-session-scope/0", "/workspace/apps/a"].join("\0"));
  });

  test("supports an empty visible workspace and a navigation cwd", () => {
    const argv = confineIsolatedBwrap(wrap(), policy(), scope([])).argv;
    expect(argv).toContain("--tmpfs");
    expect(argv.slice(-6)).toEqual(["--chdir", workspace, "--", "bash", "-c", "pwd"]);
  });

  test("keeps a whole-workspace selection semantically full but pins cwd after mounts", () => {
    const argv = confineIsolatedBwrap(wrap("workspace-write"), policy("workspace-write"), scope([workspace]), "/workspace/sub").argv;
    expect(argv).not.toContain("--dir");
    expect(argv.slice(-6)).toEqual(["--chdir", "/workspace/sub", "--", "bash", "-c", "pwd"]);
  });

  test.each([
    [{ ...wrap(), enforcement: "partial" }, policy(), scope(), undefined],
    [{ ...wrap(), argv: ["landlock-run", "--", "bash"] }, policy(), scope(), undefined],
    [wrap(), { ...policy(), workspaceRoot: "/other" }, scope(), undefined],
    [wrap(), policy(), scope(["/other/secret"]), undefined],
    [wrap(), policy(), scope(), "/workspace/hidden"],
  ] as const)("fails closed for an unsafe or unsupported process plan", (confined, activePolicy, activeScope, cwd) => {
    expect(() => confineIsolatedBwrap(confined, activePolicy, activeScope, cwd)).toThrowError(
      expect.objectContaining({ code: SESSION_SCOPE_ERROR.ISOLATION_UNAVAILABLE }),
    );
  });

  test("carries scope on a non-serialized symbol through object spread", () => {
    const attached = attachSessionScopePolicy(policy(), scope());
    const copied = { ...attached };
    expect(sessionScopeFromPolicy(copied)).toEqual(scope());
    expect(Object.getOwnPropertySymbols(copied)).toContain(SESSION_SCOPE_POLICY);
    expect(JSON.stringify(copied)).not.toContain("isolated");
  });

  test.skipIf(!bwrapWorks)("functionally hides sibling workspace directories with bwrap", () => {
    const actualWorkspace = mkdtempSync(join(tmpdir(), "dsh-session-scope-bwrap-"));
    const selected = join(actualWorkspace, "a");
    const hidden = join(actualWorkspace, "b");
    mkdirSync(selected);
    mkdirSync(hidden);
    writeFileSync(join(selected, "visible.txt"), "visible");
    writeFileSync(join(hidden, "hidden.txt"), "hidden");
    try {
      const actualPolicy: ScopeSandboxPolicy = { mode: "read-only", workspaceRoot: actualWorkspace };
      const base: ScopeConfinedArgv = {
        ...wrap(),
        argv: [
          "bwrap",
          "--ro-bind", "/", "/",
          "--dev", "/dev",
          "--proc", "/proc",
          "--die-with-parent",
          "--", "bash", "-c",
          'printf "%s\\n" "$1"/*; cat "$1/a/visible.txt"; test ! -e "$1/b/hidden.txt"',
          "scope-test", actualWorkspace,
        ],
      };
      const isolated = confineIsolatedBwrap(base, actualPolicy, {
        mode: "isolated",
        workspaceRoot: actualWorkspace,
        roots: [selected],
        navigationRoots: [actualWorkspace],
      });
      const result = spawnSync(isolated.argv[0]!, isolated.argv.slice(1), {
        cwd: actualWorkspace,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`${actualWorkspace}/a`);
      expect(result.stdout).toContain("visible");
      expect(result.stdout).not.toContain(`${actualWorkspace}/b`);
      expect(result.stdout).not.toContain("hidden");
    } finally {
      rmSync(actualWorkspace, { recursive: true, force: true });
    }
  });
});
