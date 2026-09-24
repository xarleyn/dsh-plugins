import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main, run } from "../../src/cli.js";
import { QaAccounts } from "../../src/accounts/store.js";

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
    "qa-accounts.db",
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

  it("shows and edits an account profile field by field", () => {
    const path = file();
    const argv = ["--file", path];
    const reloaded = () =>
      new QaAccounts(path, { sessionTtlDays: 30, allowRegistration: false });
    spawn([...argv, "add", "a@b.co", "--password-stdin"], "password-1");
    // A fresh account carries no profile, and `show` says so.
    expect(spawn([...argv, "show", "a@b.co"]).lines).toMatchObject([
      expect.stringContaining("a@b.co\ta\tadmin"),
      "  full name: (unset)",
      "  identities: (none)",
      "  instructions: (none)",
      "  updated: (never)",
    ]);
    expect(
      spawn([
        ...argv,
        "profile",
        "a@b.co",
        "--full-name",
        "Иван Иванов",
        "--identity",
        "jira=i.ivanov",
        "--identity",
        "gitlab=@iivanov",
      ]).lines[0],
    ).toBe("profile updated for a@b.co");
    expect(reloaded().findUser("a@b.co")?.profile).toMatchObject({
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov", gitlab: "@iivanov" },
    });
    // A later field-level edit keeps what the command line does not mention.
    spawn([...argv, "profile", "a@b.co", "--clear-identity", "gitlab"]);
    expect(reloaded().findUser("a@b.co")?.profile).toMatchObject({
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov" },
    });
    // Clearing the two text fields leaves the handles alone.
    spawn([
      ...argv,
      "profile",
      "a@b.co",
      "--clear-full-name",
      "--clear-instructions",
    ]);
    expect(reloaded().findUser("a@b.co")?.profile).toMatchObject({
      fullName: "",
      identities: { jira: "i.ivanov" },
      instructions: "",
    });
  });

  it("resets a forgotten password without stranding the account's chats", () => {
    const path = file();
    const argv = ["--file", path];
    const reloaded = () =>
      new QaAccounts(path, { sessionTtlDays: 30, allowRegistration: false });
    spawn(
      [...argv, "add", "a@b.co", "--password-stdin", "--role", "user"],
      "password-1",
    );
    // A weak replacement is refused by the same rule registration uses, and the
    // account keeps signing in with what it already had.
    const weak = io();
    expect(
      main(
        [...argv, "set-password", "a@b.co", "--password-stdin"],
        weak,
        () => "short",
      ),
    ).toBe(1);
    expect(weak.errors[0]).toContain("(reason: weak-password)");
    expect(reloaded().login("a@b.co", "password-1").user.email).toBe("a@b.co");

    const before = reloaded().login("a@b.co", "password-1");
    reloaded().ensureSessionAccess(before.token, "s-1", {
      createdAt: Date.now(),
    });
    expect(
      spawn(
        [...argv, "set-password", "a@b.co", "--password-stdin"],
        "password-2",
      ).lines,
    ).toEqual(["a@b.co password updated; live tokens revoked"]);
    // The old password is gone, and so is every token minted under it.
    expect(reloaded().whoami(before.token)).toEqual({ authenticated: false });
    expect(() => reloaded().login("a@b.co", "password-1")).toThrowError(
      /incorrect/u,
    );
    // The account keeps its id, so the chat it claimed is still its own.
    const after = reloaded().login("a@b.co", "password-2");
    expect(after.user.id).toBe(before.user.id);
    expect(reloaded().ownerIdOf("s-1")).toBe(before.user.id);
    expect(reloaded().ensureSessionAccess(after.token, "s-1").email).toBe(
      "a@b.co",
    );

    // The password arrives on stdin behind a flag, exactly like `add`; without
    // the flag the command refuses, and an unknown address is a normal failure.
    expect(main([...argv, "set-password", "a@b.co"], io())).toBe(1);
    const ghost = io();
    expect(
      main(
        [...argv, "set-password", "ghost@b.co", "--password-stdin"],
        ghost,
        () => "password-2",
      ),
    ).toBe(1);
    expect(ghost.errors[0]).toContain("no such account");
  });

  it("reads agent instructions from a file and from stdin", () => {
    const path = file();
    const argv = ["--file", path];
    spawn([...argv, "add", "a@b.co", "--password-stdin"], "password-1");
    const instructions = path.replace(/qa-accounts\.json$/u, "instructions.md");
    writeFileSync(instructions, "Отвечай кратко.\nВсегда давай ссылки.\n");
    spawn([...argv, "profile", "a@b.co", "--instructions-file", instructions]);
    expect(
      new QaAccounts(path, {
        sessionTtlDays: 30,
        allowRegistration: false,
      }).findUser("a@b.co")?.profile.instructions,
    ).toBe("Отвечай кратко.\nВсегда давай ссылки.");

    // "-" takes the same text from stdin, so a pipe works without a temp file.
    spawn(
      [...argv, "profile", "a@b.co", "--instructions-file", "-"],
      "Из stdin",
    );
    expect(
      new QaAccounts(path, {
        sessionTtlDays: 30,
        allowRegistration: false,
      }).findUser("a@b.co")?.profile.instructions,
    ).toBe("Из stdin");
  });

  it("refuses malformed profile flags and unknown accounts", () => {
    const path = file();
    const argv = ["--file", path];
    spawn([...argv, "add", "a@b.co", "--password-stdin"], "password-1");
    expect(main([...argv, "profile"], io())).toBe(1);
    const missingValue = io();
    expect(
      main([...argv, "profile", "a@b.co", "--identity"], missingValue),
    ).toBe(1);
    expect(missingValue.errors[0]).toMatch(/requires a value/u);
    const noKey = io();
    expect(
      main([...argv, "profile", "a@b.co", "--identity", "ivanov"], noKey),
    ).toBe(1);
    expect(noKey.errors[0]).toMatch(/key>=<value/u);
    const ghost = io();
    expect(main([...argv, "show", "ghost@b.co"], ghost)).toBe(1);
    expect(ghost.errors[0]).toContain("no account for ghost@b.co");
  });

  it("issues, lists and revokes integration tokens for one account", () => {
    const path = file();
    const argv = ["--file", path];
    spawn([...argv, "add", "a@b.co", "--password-stdin"], "password-1");

    const created = spawn([
      ...argv,
      "token",
      "create",
      "a@b.co",
      "--label",
      "ticket bridge",
      "--scopes",
      "ask",
      "--days",
      "30",
    ]);
    expect(created.code).toBe(0);
    const tokenLine = created.lines.find((line) => line.startsWith("token: "));
    const token = tokenLine?.slice("token: ".length) ?? "";
    expect(token.startsWith("qsat.")).toBe(true);
    expect(created.lines[0]).toMatch(/created integration token/u);
    const id = created.lines[0]?.split(" ")[3] ?? "";

    // A second process sees the token: the store is the database, not a cache.
    const reloaded = new QaAccounts(path, {
      sessionTtlDays: 30,
      allowRegistration: false,
    });
    expect(reloaded.verifyServiceToken(token)).toMatchObject({
      tokenId: id,
      scopes: ["ask"],
    });

    const listed = spawn([...argv, "token", "list", "a@b.co"]);
    expect(listed.code).toBe(0);
    expect(listed.lines[0]).toContain("ticket bridge");
    expect(listed.lines[0]).not.toContain(token);

    expect(spawn([...argv, "token", "revoke", "a@b.co", id])).toMatchObject({
      code: 0,
    });
    expect(reloaded.verifyServiceToken(token)).toBeNull();
    expect(
      spawn([...argv, "token", "revoke", "a@b.co", id]).lines[0],
    ).toContain("already revoked");

    const empty = spawn([...argv, "token", "list", "a@b.co"]);
    expect(empty.lines[0]).toContain("revoked");
  });

  it("refuses malformed token commands", () => {
    const path = file();
    const argv = ["--file", path];
    spawn([...argv, "add", "a@b.co", "--password-stdin"], "password-1");
    expect(main([...argv, "token"], io())).toBe(1);
    const noEmail = io();
    expect(main([...argv, "token", "create"], noEmail)).toBe(1);
    expect(noEmail.errors[0]).toMatch(/requires an account email/u);
    const noId = io();
    expect(main([...argv, "token", "revoke", "a@b.co"], noId)).toBe(1);
    expect(noId.errors[0]).toMatch(/requires a token id/u);
    const badDays = io();
    expect(
      main([...argv, "token", "create", "a@b.co", "--days", "soon"], badDays),
    ).toBe(1);
    expect(badDays.errors[0]).toMatch(/--days expects/u);
    const ghost = io();
    expect(main([...argv, "token", "list", "ghost@b.co"], ghost)).toBe(1);
    expect(ghost.errors[0]).toContain("no account for ghost@b.co");
  });
});
