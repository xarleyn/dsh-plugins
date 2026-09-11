import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QaAccounts, QaAccountsError } from "../src/accounts/store.js";
import { QaAttestationError } from "../src/attestation.js";
import { QaPolicyAdmission } from "../src/secure-session.js";
import { resolveConfig } from "../src/resolve-config.js";
import type { QaAccountsGate } from "../src/secure-session.js";

function store(options?: {
  allowRegistration?: boolean;
  maxAuthAttemptsPerMinute?: number;
  sessionTtlDays?: number;
}): QaAccounts {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-"));
  return new QaAccounts(path.join(dir, "qa-accounts.json"), {
    sessionTtlDays: options?.sessionTtlDays ?? 30,
    allowRegistration: options?.allowRegistration ?? true,
    maxAuthAttemptsPerMinute: options?.maxAuthAttemptsPerMinute ?? 100,
  });
}

function reasonOf(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    if (error instanceof QaAccountsError) return error.reason;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

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
    const filePath = path.join(dir, "qa-accounts.json");
    let userId: string;
    {
      const accounts = new QaAccounts(filePath, {
        sessionTtlDays: 30,
        allowRegistration: true,
      });
      const session = accounts.register("a@b.co", "password-1");
      userId = session.user.id;
      accounts.claimSessions(session.token, ["s-1", "s-2"]);
      accounts.ensureSessionAccess(session.token, "s-3");
    }
    expect(existsSync(path.join(dir, "qa-accounts.json.tmp"))).toBe(false);
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      users: { id: string }[];
      ownership: Record<string, { userId: string }>;
    };
    expect(raw.users).toHaveLength(1);
    expect(raw.ownership).toMatchObject({
      "s-1": { userId },
      "s-3": { userId },
    });
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

  it("enforces ownership before the admission boundary resolves agents", () => {
    const accounts = store();
    const a = accounts.register("a@b.co", "password-1");
    const b = accounts.register("b@b.co", "password-2");
    accounts.claimSessions(a.token, ["s-owned"]);

    const gate: QaAccountsGate = {
      enforceSessionAccess: (token, sessionId) => {
        accounts.ensureSessionAccess(token, sessionId);
      },
    };
    const admission = new QaPolicyAdmission(
      // The fake context cannot resolve agents on purpose: the account gate
      // must refuse before the boundary reaches the agent lookup.
      {
        on: () => () => undefined,
        agents: { get: () => undefined },
      } as never,
      () => resolveConfig(),
      {
        debug() {},
        info() {},
        warn() {},
        error() {},
        close() {},
      } as never,
      gate,
    );

    // A bad token is refused with auth-required, not the later agent error.
    expect(() => admission.secureSession("", "anything")).toThrow(
      QaAttestationError,
    );
    try {
      admission.secureSession("", "anything");
      expect.unreachable("anonymous calls must be refused");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe("auth-required");
      expect((error as Error).message).not.toContain("agent");
    }
    // Foreign sessions are refused with the dedicated reason before the
    // agent lookup would answer.
    try {
      admission.secureSession(b.token, "s-owned");
      expect.unreachable("foreign sessions must be refused");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe(
        "session-owned-elsewhere",
      );
    }
    // The admin's own token passes the gate (and then hits the fake context's
    // missing agent, proving the gate no longer blocks).
    try {
      admission.secureSession(a.token, "s-owned");
      expect.unreachable("the fake context has no agents");
    } catch (error) {
      expect((error as QaAttestationError).reason).toBe("agent-unavailable");
    }
  });

  it("claims unowned sessions at access time and honors the admin role", () => {
    const accounts = store();
    const admin = accounts.register("a@b.co", "password-1");
    const user = accounts.register("b@b.co", "password-2");
    const outsider = accounts.register("c@b.co", "password-3");
    // First come, first served: an unowned session joins the attesting user.
    accounts.ensureSessionAccess(user.token, "s-fresh");
    expect(accounts.ownedSessionIds(user.token)).toEqual(["s-fresh"]);
    // Another user's session is refused with the dedicated reason...
    expect(
      reasonOf(() => accounts.ensureSessionAccess(outsider.token, "s-fresh")),
    ).toBe("session-owned-elsewhere");
    // ...unless the account administers the deployment.
    expect(accounts.ensureSessionAccess(admin.token, "s-fresh")).toMatchObject({
      id: admin.user.id,
      role: "admin",
    });
    // Unowned sessions are claimed for whoever attests first.
    expect(accounts.ensureSessionAccess(admin.token, "s-other")).toMatchObject({
      id: admin.user.id,
    });
    expect(accounts.ownedSessionIds(admin.token)).toContain("s-other");
    // Anonymous tokens are refused outright.
    expect(reasonOf(() => accounts.ensureSessionAccess("", "s-fresh"))).toBe(
      "auth-required",
    );
  });

  it("disables accounts and revokes their live tokens", () => {
    const accounts = store();
    const session = accounts.register("a@b.co", "password-1");
    expect(accounts.whoami(session.token)).toMatchObject({
      authenticated: true,
    });
    expect(accounts.setUserDisabled("a@b.co", true).disabled).toBe(true);
    expect(accounts.whoami(session.token)).toEqual({ authenticated: false });
    expect(reasonOf(() => accounts.login("a@b.co", "password-1"))).toBe(
      "account-disabled",
    );
    expect(
      reasonOf(() => accounts.ensureSessionAccess(session.token, "s-1")),
    ).toBe("auth-required");
    // Re-enabling requires a fresh sign-in; the old token stays dead.
    accounts.setUserDisabled("a@b.co", false);
    expect(accounts.whoami(session.token)).toEqual({ authenticated: false });
    expect(accounts.login("a@b.co", "password-1").user.email).toBe("a@b.co");
  });

  it("revokes tokens on demand and rejects unknown emails", () => {
    const accounts = store();
    const session = accounts.register("a@b.co", "password-1");
    accounts.revokeTokens("a@b.co");
    expect(accounts.whoami(session.token)).toEqual({ authenticated: false });
    expect(accounts.login("a@b.co", "password-1").user.email).toBe("a@b.co");
    expect(reasonOf(() => accounts.revokeTokens("ghost@b.co"))).toBe(
      "invalid-credentials",
    );
  });
});
