import { describe, expect, it } from "vitest";
import { reasonOf, store } from "./accounts.helpers.js";

/**
 * The two halves of a forgotten password: the account-holder's own change, and
 * the request that reaches an operator when they cannot sign in at all.
 */
describe("QA accounts password recovery", () => {
  it("changes a password for the token's own account and keeps that session", () => {
    const accounts = store();
    const alice = accounts.register("alice@example.com", "password-1");
    const changed = accounts.changePassword(
      alice.token,
      "password-1",
      "password-2",
    );
    expect(changed.user.email).toBe("alice@example.com");
    // The write bumps the token version, so the caller's old token dies and
    // the token in the answer is the only thing keeping this browser in.
    expect(accounts.whoami(alice.token)).toEqual({ authenticated: false });
    expect(accounts.whoami(changed.token)).toMatchObject({
      authenticated: true,
    });
    expect(
      reasonOf(() => accounts.login("alice@example.com", "password-1")),
    ).toBe("invalid-credentials");
    expect(accounts.login("alice@example.com", "password-2").user.id).toBe(
      alice.user.id,
    );
  });

  it("refuses a wrong current password without writing anything", () => {
    const accounts = store();
    const alice = accounts.register("alice@example.com", "password-1");
    expect(
      reasonOf(() =>
        accounts.changePassword(alice.token, "password-9", "password-2"),
      ),
    ).toBe("invalid-current-password");
    // Nothing moved: the old password signs in and the old token still works.
    expect(accounts.whoami(alice.token)).toMatchObject({ authenticated: true });
    expect(accounts.login("alice@example.com", "password-1").user.id).toBe(
      alice.user.id,
    );
  });

  it("refuses a weak next password before touching the stored hash", () => {
    const accounts = store();
    const alice = accounts.register("alice@example.com", "password-1");
    expect(
      reasonOf(() =>
        accounts.changePassword(alice.token, "password-1", "short"),
      ),
    ).toBe("weak-password");
    expect(accounts.whoami(alice.token)).toMatchObject({ authenticated: true });
  });

  it("refuses an anonymous or expired token", () => {
    const accounts = store();
    expect(
      reasonOf(() =>
        accounts.changePassword("v1.bogus.bogus", "password-1", "password-2"),
      ),
    ).toBe("auth-required");
  });

  it("queues a request for a real address and stays silent about the rest", () => {
    const accounts = store();
    accounts.register("alice@example.com", "password-1");
    accounts.requestPasswordReset("alice@example.com");
    expect(accounts.passwordResetRequests()).toMatchObject([
      {
        email: "alice@example.com",
        displayName: "alice",
        requestCount: 1,
        disabled: false,
      },
    ]);
    // An unknown address takes the same path out of the store and records
    // nothing: the caller cannot tell the two apart.
    accounts.requestPasswordReset("ghost@example.com");
    expect(accounts.passwordResetRequests()).toHaveLength(1);
  });

  it("counts a repeated request instead of queueing a second row", () => {
    const accounts = store();
    accounts.register("alice@example.com", "password-1");
    accounts.requestPasswordReset("alice@example.com");
    accounts.requestPasswordReset("ALICE@example.com");
    const requests = accounts.passwordResetRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.requestCount).toBe(2);
  });

  it("queues nothing for a disabled account", () => {
    const accounts = store();
    accounts.register("alice@example.com", "password-1");
    accounts.setUserDisabled("alice@example.com", true);
    accounts.requestPasswordReset("alice@example.com");
    expect(accounts.passwordResetRequests()).toEqual([]);
  });

  it("spends the authentication budget, so the queue cannot be flooded", () => {
    const accounts = store({ maxAuthAttemptsPerMinute: 2 });
    accounts.register("alice@example.com", "password-1");
    accounts.requestPasswordReset("alice@example.com");
    expect(
      reasonOf(() => accounts.requestPasswordReset("alice@example.com")),
    ).toBe("rate-limited");
  });

  it("answers a request: new password, dead sessions, empty queue", () => {
    const accounts = store();
    const alice = accounts.register("alice@example.com", "password-1");
    accounts.requestPasswordReset("alice@example.com");
    const updated = accounts.resetUserPassword(alice.user.id, "password-2");
    expect(updated.email).toBe("alice@example.com");
    expect(accounts.passwordResetRequests()).toEqual([]);
    expect(accounts.whoami(alice.token)).toEqual({ authenticated: false });
    expect(accounts.login("alice@example.com", "password-2").user.id).toBe(
      alice.user.id,
    );
  });

  it("clears the request when the user changes the password themselves", () => {
    const accounts = store();
    const alice = accounts.register("alice@example.com", "password-1");
    accounts.requestPasswordReset("alice@example.com");
    expect(accounts.passwordResetRequests()).toHaveLength(1);
    accounts.changePassword(alice.token, "password-1", "password-2");
    // The operator has nothing left to do for this account.
    expect(accounts.passwordResetRequests()).toEqual([]);
  });

  it("keeps a request from one account out of another's queue row", () => {
    const accounts = store();
    accounts.register("alice@example.com", "password-1");
    const bob = accounts.register("bob@example.com", "password-1");
    accounts.requestPasswordReset("alice@example.com");
    accounts.requestPasswordReset("bob@example.com");
    const requests = accounts.passwordResetRequests();
    expect(requests.map((entry) => entry.email).sort()).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    accounts.resetUserPassword(bob.user.id, "password-2");
    expect(accounts.passwordResetRequests()).toMatchObject([
      { email: "alice@example.com" },
    ]);
  });
});
