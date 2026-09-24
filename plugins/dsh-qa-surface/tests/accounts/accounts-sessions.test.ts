import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reasonOf, store } from "./accounts.helpers.js";

describe("QA accounts store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("claims unowned sessions at access time and honors the admin role", () => {
    const accounts = store();
    const admin = accounts.register("a@b.co", "password-1");
    const user = accounts.register("b@b.co", "password-2");
    const outsider = accounts.register("c@b.co", "password-3");
    // First come, first served: an unowned session joins the attesting user.
    accounts.ensureSessionAccess(user.token, "s-fresh", {
      createdAt: Date.now(),
    });
    expect(accounts.ownedSessionIds(user.token)).toEqual(["s-fresh"]);
    // Another user's session is refused with the dedicated reason...
    expect(
      reasonOf(() => accounts.ensureSessionAccess(outsider.token, "s-fresh")),
    ).toBe("session-owned-elsewhere");
    // ...unless the account administers the deployment.
    expect(accounts.ensureSessionAccess(admin.token, "s-fresh")).toMatchObject({
      id: user.user.id,
      role: "user",
    });
    // Unowned sessions are claimed for whoever attests first.
    expect(
      accounts.ensureSessionAccess(admin.token, "s-other", {
        createdAt: Date.now(),
      }),
    ).toMatchObject({
      id: admin.user.id,
    });
    expect(accounts.ownedSessionIds(admin.token)).toContain("s-other");
    // Anonymous tokens are refused outright.
    expect(reasonOf(() => accounts.ensureSessionAccess("", "s-fresh"))).toBe(
      "auth-required",
    );
  });

  it("reserves Host-created session ids atomically and can roll back failures", () => {
    const accounts = store();
    const user = accounts.register("owner@b.co", "password-1");
    const other = accounts.register("other@b.co", "password-2");

    expect(
      accounts.reserveSession(user.token, "session-created"),
    ).toMatchObject({
      id: user.user.id,
    });
    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-created"]);
    expect(() =>
      accounts.reserveSession(other.token, "session-created"),
    ).toThrow(/unavailable/u);

    accounts.releaseSessionReservation(other.user.id, "session-created");
    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-created"]);
    accounts.releaseSessionReservation(user.user.id, "session-created");
    expect(accounts.ownedSessionIds(user.token)).toEqual([]);
  });

  it("lists chat ownership for admins with resolved display names", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const user = accounts.register("user@example.com", "password-2");
    accounts.ensureSessionAccess(admin.token, "s-1", { createdAt: Date.now() });
    accounts.claimSessions(user.token, ["s-2"]);
    // Disabled accounts still name their chats in the admin view.
    accounts.setUserDisabled("user@example.com", true);
    expect(accounts.listOwnership(admin.token)).toEqual([
      {
        sessionId: "s-1",
        userId: admin.user.id,
        displayName: "op",
        claimedAt: expect.any(String),
      },
      {
        sessionId: "s-2",
        userId: user.user.id,
        displayName: "user",
        claimedAt: expect.any(String),
      },
    ]);
  });

  it("refuses the ownership listing to ordinary and anonymous callers", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const user = accounts.register("user@example.com", "password-2");
    expect(reasonOf(() => accounts.listOwnership(user.token))).toBe(
      "admin-required",
    );
    expect(reasonOf(() => accounts.listOwnership(""))).toBe("auth-required");
    expect(accounts.listOwnership(admin.token)).toEqual([]);
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

  it("replaces a password and burns the tokens the old one minted", () => {
    const accounts = store();
    const first = accounts.register("a@b.co", "password-1");
    const second = accounts.login("a@b.co", "password-1");
    const updated = accounts.setPassword("a@b.co", "password-2");
    // Both live tokens die with the old password; the account itself stays put,
    // so the chats it owns are still reachable after signing in again.
    expect(accounts.whoami(first.token)).toEqual({ authenticated: false });
    expect(accounts.whoami(second.token)).toEqual({ authenticated: false });
    expect(updated.id).toBe(first.user.id);
    expect(updated.role).toBe(first.user.role);
    expect(reasonOf(() => accounts.login("a@b.co", "password-1"))).toBe(
      "invalid-credentials",
    );
    expect(accounts.login("a@b.co", "password-2").user.email).toBe("a@b.co");
  });

  it("refuses a weak replacement password and leaves the stored one alone", () => {
    const accounts = store();
    accounts.register("a@b.co", "password-1");
    expect(reasonOf(() => accounts.setPassword("a@b.co", "short"))).toBe(
      "weak-password",
    );
    expect(
      reasonOf(() => accounts.setPassword("ghost@b.co", "password-2")),
    ).toBe("invalid-credentials");
    expect(accounts.login("a@b.co", "password-1").user.email).toBe("a@b.co");
  });
});
