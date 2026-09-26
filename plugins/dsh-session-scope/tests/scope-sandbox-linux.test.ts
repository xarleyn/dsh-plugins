import { spawn, spawnSync } from "node:child_process";
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
import {
  SESSION_SCOPE_ERROR,
  type EffectiveSessionScope,
} from "../src/session-scope.js";

const workspace = "/workspace";
const bwrapProfile = [
  "bwrap",
  "--ro-bind",
  "/",
  "/",
  "--dev",
  "/dev",
  "--proc",
  "/proc",
  "--die-with-parent",
] as const;
const bwrapWorks =
  process.platform === "linux" &&
  spawnSync(bwrapProfile[0]!, [...bwrapProfile.slice(1), "--", "true"], {
    encoding: "utf8",
  }).status === 0;
/** Whether this kernel lets bwrap take a private PID namespace at all. */
const pidNamespaceWorks =
  bwrapWorks &&
  spawnSync(
    bwrapProfile[0]!,
    ["--unshare-pid", ...bwrapProfile.slice(1), "--", "true"],
    { encoding: "utf8" },
  ).status === 0;
const policy = (
  mode: "read-only" | "workspace-write" = "read-only",
): ScopeSandboxPolicy => ({
  mode,
  workspaceRoot: workspace,
});
const scope = (
  roots = ["/workspace/apps/a", "/workspace/libs/b"],
): EffectiveSessionScope => ({
  mode: "isolated",
  workspaceRoot: workspace,
  roots,
  navigationRoots: [workspace, "/workspace/apps", "/workspace/libs"],
});

function wrap(
  mode: "read-only" | "workspace-write" = "read-only",
): ScopeConfinedArgv {
  return {
    argv: [
      ...bwrapProfile,
      ...(mode === "workspace-write"
        ? ["--tmpfs", "/tmp", "--bind", workspace, workspace]
        : []),
      "--",
      "bash",
      "-c",
      "pwd",
    ],
    enforcement: "full",
    denialSignatures: ["read-only file system"],
    runnerFailureRules: [],
  };
}

describe("Linux isolated bwrap profile", () => {
  test("recognizes only the exact full-enforcement DSH bwrap profile", () => {
    expect(isSupportedBwrapInvocation(wrap(), policy())).toBe(true);
    expect(
      isSupportedBwrapInvocation(
        { ...wrap(), enforcement: "partial" },
        policy(),
      ),
    ).toBe(false);
    expect(
      isSupportedBwrapInvocation(
        { ...wrap(), argv: ["landlock-run", "--", "true"] },
        policy(),
      ),
    ).toBe(false);
    expect(
      isSupportedBwrapInvocation(
        { ...wrap(), argv: ["sudo", ...wrap().argv] },
        policy(),
      ),
    ).toBe(false);
  });

  test("uses the provider's functional selection result for capability detection", () => {
    const provider = {
      confine: vi.fn(() => ({
        ...wrap(),
        argv: [...wrap().argv.slice(0, -3), "true"],
      })),
    };
    const execute = vi.fn(() => true);
    expect(detectBwrapIsolation(provider, workspace, "linux", execute)).toBe(
      true,
    );
    expect(execute).toHaveBeenCalledWith(
      expect.arrayContaining([
        "bwrap",
        "--tmpfs",
        workspace,
        "--remount-ro",
        "/dev/.dsh-session-scope",
        "true",
      ]),
    );
    expect(
      detectBwrapIsolation(provider, workspace, "linux", () => false),
    ).toBe(false);
    expect(detectBwrapIsolation(provider, workspace, "win32", execute)).toBe(
      false,
    );
    expect(
      detectBwrapIsolation(
        {
          confine: () => {
            throw new Error("unavailable");
          },
        },
        workspace,
        "linux",
        execute,
      ),
    ).toBe(false);
  });

  test("hides the workspace, creates ancestors, and read-only binds selected roots", () => {
    expect(
      confineIsolatedBwrap(wrap(), policy(), scope(), "/workspace/apps/a/src")
        .argv,
    ).toEqual([
      "bwrap",
      "--unshare-pid",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--die-with-parent",
      "--dir",
      "/dev/.dsh-session-scope",
      "--tmpfs",
      "/dev/.dsh-session-scope",
      "--dir",
      "/dev/.dsh-session-scope/0",
      "--ro-bind",
      "/workspace/apps/a",
      "/dev/.dsh-session-scope/0",
      "--dir",
      "/dev/.dsh-session-scope/1",
      "--ro-bind",
      "/workspace/libs/b",
      "/dev/.dsh-session-scope/1",
      "--tmpfs",
      workspace,
      "--dir",
      "/workspace/apps",
      "--dir",
      "/workspace/apps/a",
      "--dir",
      "/workspace/libs",
      "--dir",
      "/workspace/libs/b",
      "--ro-bind",
      "/dev/.dsh-session-scope/0",
      "/workspace/apps/a",
      "--ro-bind",
      "/dev/.dsh-session-scope/1",
      "/workspace/libs/b",
      "--tmpfs",
      "/dev/.dsh-session-scope",
      "--remount-ro",
      "/dev/.dsh-session-scope",
      "--chdir",
      "/workspace/apps/a/src",
      "--",
      "bash",
      "-c",
      "pwd",
    ]);
  });

  test("replaces the global writable workspace bind with selected writable binds", () => {
    const argv = confineIsolatedBwrap(
      wrap("workspace-write"),
      policy("workspace-write"),
      scope(),
    ).argv;
    expect(argv).toContain("/tmp");
    expect(argv).toContain("--tmpfs");
    expect(argv.join("\0")).not.toContain(
      ["--bind", workspace, workspace].join("\0"),
    );
    expect(argv.join("\0")).toContain(
      ["--bind", "/workspace/apps/a", "/dev/.dsh-session-scope/0"].join("\0"),
    );
    expect(argv.join("\0")).toContain(
      ["--bind", "/dev/.dsh-session-scope/0", "/workspace/apps/a"].join("\0"),
    );
  });

  test("supports an empty visible workspace and a navigation cwd", () => {
    const argv = confineIsolatedBwrap(wrap(), policy(), scope([])).argv;
    expect(argv).toContain("--tmpfs");
    expect(argv.slice(-6)).toEqual([
      "--chdir",
      workspace,
      "--",
      "bash",
      "-c",
      "pwd",
    ]);
  });

  test("keeps a whole-workspace selection semantically full but pins cwd after mounts", () => {
    const argv = confineIsolatedBwrap(
      wrap("workspace-write"),
      policy("workspace-write"),
      scope([workspace]),
      "/workspace/sub",
    ).argv;
    expect(argv).not.toContain("--dir");
    expect(argv.slice(-6)).toEqual([
      "--chdir",
      "/workspace/sub",
      "--",
      "bash",
      "-c",
      "pwd",
    ]);
  });

  test("confines every isolated profile to its own PID namespace", () => {
    const profiles = [
      confineIsolatedBwrap(wrap(), policy(), scope()).argv,
      confineIsolatedBwrap(
        wrap("workspace-write"),
        policy("workspace-write"),
        scope(),
      ).argv,
      confineIsolatedBwrap(wrap(), policy(), scope([workspace]), workspace)
        .argv,
    ];
    for (const argv of profiles) {
      expect(argv.filter((arg) => arg === "--unshare-pid")).toHaveLength(1);
      // The private pid namespace is only airtight behind a procfs mounted for
      // it, so the provider's mount has to survive the rewrite.
      expect(
        argv.slice(argv.indexOf("--proc"), argv.indexOf("--proc") + 2),
      ).toEqual(["--proc", "/proc"]);
    }
    // The flag joins the head of the profile, not the tail the writable mode
    // trims: dropping the whole-workspace bind must still leave `/tmp` tmpfs.
    const writable = profiles[1]!;
    expect(writable.join("\0")).not.toContain(
      ["--bind", workspace, workspace].join("\0"),
    );
    expect(
      writable.slice(
        writable.indexOf("--tmpfs"),
        writable.indexOf("--tmpfs") + 2,
      ),
    ).toEqual(["--tmpfs", "/tmp"]);
  });

  test.each([
    [{ ...wrap(), enforcement: "partial" }, policy(), scope(), undefined],
    [
      { ...wrap(), argv: ["landlock-run", "--", "bash"] },
      policy(),
      scope(),
      undefined,
    ],
    [wrap(), { ...policy(), workspaceRoot: "/other" }, scope(), undefined],
    [wrap(), policy(), scope(["/other/secret"]), undefined],
    [wrap(), policy(), scope(), "/workspace/hidden"],
  ] as const)(
    "fails closed for an unsafe or unsupported process plan",
    (confined, activePolicy, activeScope, cwd) => {
      expect(() =>
        confineIsolatedBwrap(
          confined as ScopeConfinedArgv,
          activePolicy,
          activeScope,
          cwd,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: SESSION_SCOPE_ERROR.ISOLATION_UNAVAILABLE,
        }),
      );
    },
  );

  test("carries scope on a non-serialized symbol through object spread", () => {
    const attached = attachSessionScopePolicy(policy(), scope());
    const copied = { ...attached };
    expect(sessionScopeFromPolicy(copied)).toEqual(scope());
    expect(Object.getOwnPropertySymbols(copied)).toContain(
      SESSION_SCOPE_POLICY,
    );
    expect(JSON.stringify(copied)).not.toContain("isolated");
  });

  test.skipIf(!bwrapWorks)(
    "functionally hides sibling workspace directories with bwrap",
    () => {
      const actualWorkspace = mkdtempSync(
        join(tmpdir(), "dsh-session-scope-bwrap-"),
      );
      const selected = join(actualWorkspace, "a");
      const hidden = join(actualWorkspace, "b");
      mkdirSync(selected);
      mkdirSync(hidden);
      writeFileSync(join(selected, "visible.txt"), "visible");
      writeFileSync(join(hidden, "hidden.txt"), "hidden");
      try {
        const actualPolicy: ScopeSandboxPolicy = {
          mode: "read-only",
          workspaceRoot: actualWorkspace,
        };
        const base: ScopeConfinedArgv = {
          ...wrap(),
          argv: [
            ...bwrapProfile,
            "--",
            "bash",
            "-c",
            'printf "%s\\n" "$1"/*; cat "$1/a/visible.txt"; test ! -e "$1/b/hidden.txt"',
            "scope-test",
            actualWorkspace,
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
    },
  );

  test.skipIf(!pidNamespaceWorks)(
    "closes the procfs route an unconfined same-UID process would open",
    () => {
      // Every process the confined one can name in /proc carries that process's
      // own `/proc/<pid>/root`, which is a second path to the workspace these
      // mounts just masked — and it stays nameable exactly as long as the
      // sandbox shares a PID namespace with it. Whether the kernel then lets a
      // same-UID reader resolve the link is Yama, `hidepid=` and dumpability, so
      // on a permissive host the escape is real and on a strict one the kernel,
      // not the sandbox, is what saved the promise. This fixture therefore
      // compares what the sandbox owns: the PID namespace the confined process
      // sees, and whether an unconfined bystander of the same UID is still
      // identifiable in it. `/proc/<pid>/cmdline` is world-readable, so the
      // bystander is recognised by its own argv rather than by the mere presence
      // of its pid — a fresh namespace reuses small pids for its own processes.
      const actualWorkspace = mkdtempSync(
        join(tmpdir(), "dsh-session-scope-proc-"),
      );
      const selected = join(actualWorkspace, "a");
      const hidden = join(actualWorkspace, "b");
      mkdirSync(selected);
      mkdirSync(hidden);
      writeFileSync(join(selected, "visible.txt"), "visible");
      writeFileSync(join(hidden, "hidden.txt"), "hidden");
      const marker = "dsh-session-scope-bystander";
      const probe = [
        'printf "pidns=%s\\n" "$(stat -Lc %i /proc/self/ns/pid)"',
        'if grep -q "$3" "/proc/$2/cmdline" 2>/dev/null',
        'then printf "addressable=yes\\n"; else printf "addressable=no\\n"; fi',
        'printf "hidden=%s\\n" "$(cat "/proc/$2/root$1/b/hidden.txt" 2>/dev/null || echo unreachable)"',
        'printf "selected=%s\\n" "$(cat "$1/a/visible.txt" 2>/dev/null || echo unreachable)"',
      ].join("; ");
      const run = (argv: readonly string[]) => {
        const result = spawnSync(argv[0]!, argv.slice(1), {
          cwd: actualWorkspace,
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      };
      const pidNamespaceOf = (stdout: string) =>
        /^pidns=(\d+)$/m.exec(stdout)?.[1];
      // `exec -a` keeps the marker in the bystander's own argv and leaves one
      // killable process behind, so nothing is orphaned when the fixture ends.
      const bystander = spawn("bash", ["-c", 'exec -a "$0" sleep 300', marker]);
      try {
        const confinedCommand = (scriptArgv: readonly string[]): string[] => [
          ...scriptArgv,
          "--",
          "bash",
          "-c",
          probe,
          "scope-probe",
          actualWorkspace,
          String(bystander.pid),
          marker,
        ];
        const hostPidNs = spawnSync(
          "stat",
          ["-Lc", "%i", "/proc/self/ns/pid"],
          { encoding: "utf8" },
        ).stdout.trim();
        expect(hostPidNs).toMatch(/^\d+$/);

        const shared = run(confinedCommand(bwrapProfile));
        expect(pidNamespaceOf(shared)).toBe(hostPidNs);
        expect(shared).toContain("addressable=yes");

        const isolated = confineIsolatedBwrap(
          { ...wrap(), argv: confinedCommand(bwrapProfile) },
          { mode: "read-only", workspaceRoot: actualWorkspace },
          {
            mode: "isolated",
            workspaceRoot: actualWorkspace,
            roots: [selected],
            navigationRoots: [actualWorkspace],
          },
        );
        const output = run(isolated.argv);
        expect(pidNamespaceOf(output)).not.toBe(hostPidNs);
        expect(output).toContain("addressable=no");
        expect(output).toContain("hidden=unreachable");
        expect(output).toContain("selected=visible");
      } finally {
        bystander.kill();
        rmSync(actualWorkspace, { recursive: true, force: true });
      }
    },
  );
});
