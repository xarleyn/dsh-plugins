import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QA_SESSION_CLAIM_WINDOW_MS,
  QaAccounts,
} from "../src/accounts/store.js";
import { reasonOf, rowsOf, store } from "./accounts.helpers.js";

describe("QA accounts store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers the first account as admin and later ones as users", () => {
    const accounts = store();
    const first = accounts.register("op@example.com", "password-1");
    const second = accounts.register("user@example.com", "password-2");
    expect(first.user.role).toBe("admin");
    expect(second.user.role).toBe("user");
    expect(second.user.email).toBe("user@example.com");
    expect(second.user.displayName).toBe("user");
  });

  it("rejects duplicate emails, malformed input, and respects the toggle", () => {
    const accounts = store({ allowRegistration: false });
    expect(reasonOf(() => accounts.register("a@b.co", "password-1"))).toBe(
      "registration-disabled",
    );
    const open = store();
    open.register("a@b.co", "password-1");
    expect(reasonOf(() => open.register("A@B.CO", "password-2"))).toBe(
      "email-taken",
    );
    expect(reasonOf(() => open.register("nope", "password-1"))).toBe(
      "invalid-email",
    );
    expect(reasonOf(() => open.register("c@d.co", "short"))).toBe(
      "weak-password",
    );
  });

  it("logs in with the normalized email and refuses bad credentials", () => {
    const accounts = store();
    accounts.register("User@Example.COM", "password-1");
    const session = accounts.login("user@example.com", "password-1");
    expect(session.user.email).toBe("user@example.com");
    expect(accounts.login("USER@example.com", "password-1").user.id).toBe(
      session.user.id,
    );
    expect(
      reasonOf(() => accounts.login("user@example.com", "wrong-pass")),
    ).toBe("invalid-credentials");
    expect(
      reasonOf(() => accounts.login("ghost@example.com", "password-1")),
    ).toBe("invalid-credentials");
  });

  it("rate-limits authentication attempts", () => {
    const accounts = store({ maxAuthAttemptsPerMinute: 2 });
    accounts.register("a@b.co", "password-1");
    accounts.login("a@b.co", "password-1");
    expect(reasonOf(() => accounts.login("a@b.co", "wrong-pass"))).toBe(
      "rate-limited",
    );
    vi.advanceTimersByTime(61_000);
    expect(accounts.login("a@b.co", "password-1").user.email).toBe("a@b.co");
  });

  it("round-trips tokens through whoami and expires them", () => {
    const accounts = store({ sessionTtlDays: 1 });
    const { token } = accounts.register("a@b.co", "password-1");
    expect(accounts.whoami(token)).toMatchObject({
      authenticated: true,
      user: { email: "a@b.co" },
    });
    expect(accounts.whoami("garbage")).toEqual({ authenticated: false });
    expect(accounts.whoami("v1.not.a-real-signature")).toEqual({
      authenticated: false,
    });
    vi.advanceTimersByTime(2 * 86_400_000);
    expect(accounts.whoami(token)).toEqual({ authenticated: false });
  });

  it("persists users and ownership across store instances", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-"));
    const filePath = path.join(dir, "qa-accounts.db");
    let userId: string;
    {
      const accounts = new QaAccounts(filePath, {
        sessionTtlDays: 30,
        allowRegistration: true,
      });
      const session = accounts.register("a@b.co", "password-1");
      userId = session.user.id;
      accounts.claimSessions(session.token, ["s-1", "s-2"]);
      accounts.ensureSessionAccess(session.token, "s-3", {
        createdAt: Date.now(),
      });
      accounts.close();
    }
    expect(existsSync(filePath)).toBe(true);
    // Every mutation landed as a row of its own: the store is the database.
    expect(rowsOf(filePath, "SELECT id FROM qa_accounts")).toEqual([userId]);
    expect(
      rowsOf(
        filePath,
        "SELECT session_id FROM qa_ownership ORDER BY session_id",
      ),
    ).toEqual(["s-1", "s-2", "s-3"]);
    const reopened = new QaAccounts(filePath, {
      sessionTtlDays: 30,
      allowRegistration: true,
    });
    expect(reopened.whoami("")).toEqual({ authenticated: false });
    const session = reopened.login("a@b.co", "password-1");
    expect([...reopened.ownedSessionIds(session.token)].sort()).toEqual([
      "s-1",
      "s-2",
      "s-3",
    ]);
    reopened.close();
  });

  it("refuses a path it cannot open instead of starting an empty store", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-"));
    // A directory at the database path cannot be opened, which must surface:
    // silently starting a fresh store would lock every account out.
    const filePath = path.join(dir, "qa-accounts.db");
    mkdirSync(filePath);
    expect(
      () =>
        new QaAccounts(filePath, {
          sessionTtlDays: 30,
          allowRegistration: true,
        }),
    ).toThrow(/unable to open database/u);
    expect(readdirSync(dir)).toEqual(["qa-accounts.db"]);
  });

  it("sees another process's file changes instead of overwriting them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-"));
    const filePath = path.join(dir, "qa-accounts.db");
    const host = new QaAccounts(filePath, {
      sessionTtlDays: 30,
      allowRegistration: true,
    });
    const session = host.register("op@example.com", "password-1");
    expect(host.whoami(session.token)).toMatchObject({ authenticated: true });

    // The CLI is a separate process with its own store instance.
    const cli = new QaAccounts(filePath, {
      sessionTtlDays: 30,
      allowRegistration: false,
    });
    cli.setUserDisabled("op@example.com", true);

    // The running Host must see the revocation on its next account check...
    expect(host.whoami(session.token)).toEqual({ authenticated: false });
    // ...and a later Host write must not resurrect the disabled account.
    host.register("second@example.com", "password-2");
    const reopened = new QaAccounts(filePath, {
      sessionTtlDays: 30,
      allowRegistration: false,
    });
    expect(reasonOf(() => reopened.login("op@example.com", "password-1"))).toBe(
      "account-disabled",
    );
  });

  it("claims unowned sessions first-come and reports foreign conflicts", () => {
    const accounts = store();
    const a = accounts.register("a@b.co", "password-1");
    const b = accounts.register("b@b.co", "password-2");
    expect(accounts.claimSessions(a.token, ["s-1", "s-2"])).toEqual({
      claimed: 2,
      conflicts: [],
    });
    // Re-claiming is idempotent for the owner.
    expect(accounts.claimSessions(a.token, ["s-1"])).toEqual({
      claimed: 0,
      conflicts: [],
    });
    expect(accounts.claimSessions(b.token, ["s-1", "s-3"])).toEqual({
      claimed: 1,
      conflicts: ["s-1"],
    });
    expect(accounts.ownedSessionIds(b.token)).toEqual(["s-3"]);
  });

  it("reclaims ownership records of sessions that are not chats", () => {
    // Residue: releases that claimed a session without knowing its lineage
    // left the users' chat lists carrying subagent sessions.
    const accounts = store();
    const a = accounts.register("a@b.co", "password-1");
    const b = accounts.register("b@b.co", "password-2");
    accounts.claimSessions(a.token, ["s-chat", "s-child"]);
    accounts.claimSessions(b.token, ["s-child-2"]);

    expect(accounts.pruneDelegatedOwnership(new Set(["s-child"]))).toEqual([
      "s-child",
    ]);
    expect(accounts.ownedSessionIds(a.token)).toEqual(["s-chat"]);
    // Only the named ids go: a record the caller did not identify keeps its
    // owner, and re-running the sweep is a no-op.
    expect(accounts.ownedSessionIds(b.token)).toEqual(["s-child-2"]);
    expect(accounts.pruneDelegatedOwnership(new Set(["s-child"]))).toEqual([]);
    expect(accounts.ownedSessionIds(b.token)).toEqual(["s-child-2"]);
  });

  it("refuses a role outside the role union on the administrative write", () => {
    const accounts = store();
    const session = accounts.register("a@b.co", "password-1");
    // The console sends the role over the wire as a string; a hand-rolled
    // request can name a role the permission tables do not know. Storing it
    // would crash every later permission check for the account.
    const garbage = "superadmin" as unknown as "user";
    expect(
      reasonOf(() => accounts.setAccessRole(session.user.id, garbage)),
    ).toBe("invalid-role");
    expect(accounts.whoami(session.token)).toMatchObject({
      authenticated: true,
      user: { role: "admin" },
    });
    // The operator CLI path validates against the same union.
    expect(
      reasonOf(() =>
        accounts.addUser("b@b.co", "password-2", { role: garbage }),
      ),
    ).toBe("invalid-role");
  });

  it("bounds the first-come auto-claim to fresh root sessions", () => {
    const accounts = store();
    const user = accounts.register("a@b.co", "password-1");
    const now = Date.now();
    // A delegated subagent session is never claimable: it has no QA owner.
    expect(
      reasonOf(() =>
        accounts.ensureSessionAccess(user.token, "session-child", {
          hasParent: true,
        }),
      ),
    ).toBe("session-owned-elsewhere");
    // A fresh session joins the attesting user...
    accounts.ensureSessionAccess(user.token, "s-fresh", {
      createdAt: now - QA_SESSION_CLAIM_WINDOW_MS + 1_000,
    });
    expect(accounts.ownedSessionIds(user.token)).toEqual(["s-fresh"]);
    // ...an established one is refused instead of silently attached...
    expect(
      reasonOf(() =>
        accounts.ensureSessionAccess(user.token, "s-established", {
          createdAt: now - QA_SESSION_CLAIM_WINDOW_MS - 1_000,
        }),
      ),
    ).toBe("session-owned-elsewhere");
    // ...and stays unowned, so ownership is never granted by a drive-by open.
    expect(accounts.ownedSessionIds(user.token)).toEqual(["s-fresh"]);
    // Unknown facts (a session this Host has not materialized yet) defer the
    // claim: a delegated child from a previous run must not gain an owner
    // from a drive-by open.
    accounts.ensureSessionAccess(user.token, "s-unknown");
    expect(accounts.ownedSessionIds(user.token)).not.toContain("s-unknown");
  });

  it("creates the accounts file readable by its owner only", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-mode-"));
    const filePath = path.join(dir, "qa-accounts.db");
    new QaAccounts(filePath, {
      sessionTtlDays: 30,
      allowRegistration: true,
    }).register("a@b.co", "password-1");
    // Windows ignores the creation mode; the platform's own ACLs cover it.
    if (process.platform !== "win32") {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });

  it("reloads the ownership map before an admin lists it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-ownership-"));
    const filePath = path.join(dir, "qa-accounts.json");
    const options = { sessionTtlDays: 30, allowRegistration: true };
    const host = new QaAccounts(filePath, options);
    const admin = host.register("op@example.com", "password-1");
    const user = host.register("user@example.com", "password-2");
    // The CLI is another process writing the same file; it attests a live
    // session, so the facts are known.
    const cli = new QaAccounts(filePath, options);
    cli.ensureSessionAccess(user.token, "s-external", {
      createdAt: Date.now(),
    });
    expect(
      host
        .listOwnership(admin.token)
        .map((row) => row.sessionId)
        .sort(),
    ).toContain("s-external");
  });
});
