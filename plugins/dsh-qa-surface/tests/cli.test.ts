import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main, run } from "../src/cli.js";
import { QaAccounts } from "../src/accounts/store.js";

function io() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    out: (line: string) => {
      lines.push(line);
    },
    err: (line: string) => {
      errors.push(line);
    },
    lines,
    errors,
  };
}

function file(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "qa-accounts-cli-")),
    "qa-accounts.json",
  );
}

function spawn(argv: readonly string[], stdinPassword?: string) {
  const capture = io();
  const code = run(argv, capture, () => stdinPassword ?? "");
  return { code, ...capture };
}

describe("qa-accounts CLI", () => {
  it("adds, lists, disables, enables, and revokes accounts", () => {
    const path = file();
    const argv = ["--file", path];
    // Every CLI command is a separate process: verify host-side effects
    // through a freshly loaded store, the way the running harness would.
    const reloaded = () =>
      new QaAccounts(path, { sessionTtlDays: 30, allowRegistration: false });
    expect(
      spawn(
        [...argv, "add", "a@b.co", "--password-stdin", "--name", "Alpha"],
        "password-1",
      ),
    ).toMatchObject({ code: 0, lines: ["added a@b.co (admin)"] });
    expect(
      spawn(
        [...argv, "add", "b@b.co", "--password-stdin", "--role", "user"],
        "password-2",
      ),
    ).toMatchObject({ code: 0, lines: ["added b@b.co (user)"] });
    // The CLI cannot create a second admin by accident; roles change explicitly.
    expect(spawn([...argv, "list"]).lines[0]).toContain("a@b.co\tAlpha\tadmin");
    expect(spawn([...argv, "list"]).lines[1]).toContain("b@b.co\tb\tuser");

    const session = reloaded().login("a@b.co", "password-1");
    expect(spawn([...argv, "disable", "a@b.co"]).lines).toEqual([
      "a@b.co disabled; live tokens revoked",
    ]);
    const disabled = reloaded();
    expect(disabled.whoami(session.token)).toEqual({ authenticated: false });
    expect(() => disabled.login("a@b.co", "password-1")).toThrowError(
      /disabled/u,
    );
    expect(spawn([...argv, "enable", "a@b.co"]).lines).toEqual([
      "a@b.co enabled",
    ]);
    // Enabling does not resurrect old tokens, but login mints a fresh one.
    expect(reloaded().whoami(session.token)).toEqual({ authenticated: false });
    const live = reloaded().login("a@b.co", "password-1").token;
    expect(spawn([...argv, "revoke", "a@b.co"]).lines).toEqual([
      "a@b.co tokens revoked",
    ]);
    expect(reloaded().whoami(live)).toEqual({ authenticated: false });
    expect(spawn([...argv, "set-role", "b@b.co", "admin"]).lines).toEqual([
      "b@b.co is now admin",
    ]);
    expect(reloaded().listUsers()).toMatchObject([
      { email: "a@b.co", role: "admin" },
      { email: "b@b.co", role: "admin" },
    ]);
  });

  it("prints usage for no arguments and fails on bad ones", () => {
    const path = file();
    expect(main([], io())).toBe(1);
    expect(main(["--file", path, "wat"], io())).toBe(1);
    // No --password-stdin flag: the refusal happens before any stdin read.
    expect(main(["--file", path, "add", "a@b.co"], io())).toBe(1);
    // With the flag the password comes from the injected reader; a broken
    // reader must surface as a normal failure, never a hang.
    expect(
      main(["--file", path, "add", "a@b.co", "--password-stdin"], io(), () => {
        throw new Error("no password available");
      }),
    ).toBe(1);
    expect(spawn(["--file", path, "--help"]).code).toBe(0);
  });

  it("maps store refusals to reason-tagged errors", () => {
    const path = file();
    const capture = io();
    const code = main(
      ["--file", path, "set-role", "ghost@b.co", "admin"],
      capture,
    );
    expect(code).toBe(1);
    expect(capture.errors[0]).toContain("(reason:");
  });
});
