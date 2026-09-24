import { describe, expect, it } from "vitest";
import { harness, refusal } from "./admin-service.helpers.js";

/**
 * The operator half of a forgotten password: who may see the queue, who may
 * answer it, and what the answer is worth afterwards.
 */
describe("QA admin password reset", () => {
  it("lists the queue and answers it with an audit trail", async () => {
    const { service, accounts, quality, admin, alice } = harness();
    accounts.requestPasswordReset("alice@example.com");
    accounts.requestPasswordReset("alice@example.com");

    const listed = await service.passwordResetRequests(admin.token);
    expect(listed).toMatchObject([
      {
        userId: alice.user.id,
        email: "alice@example.com",
        displayName: "alice",
        requestCount: 2,
        disabled: false,
      },
    ]);

    const detail = await service.resetUserPassword(
      admin.token,
      alice.user.id,
      "password-2",
    );
    expect(detail.user.email).toBe("alice@example.com");
    // The queue row is answered, and the sessions that existed under the old
    // password are over: the user signs in again with the new one.
    expect(await service.passwordResetRequests(admin.token)).toEqual([]);
    expect(accounts.whoami(alice.token)).toEqual({ authenticated: false });
    expect(accounts.login("alice@example.com", "password-2").user.id).toBe(
      alice.user.id,
    );
    expect(quality.auditEvents().map((event) => event.action)).toContain(
      "user.password-reset",
    );
  });

  it("keeps the queue away from a reviewer", async () => {
    const { service, reviewer } = harness();
    const refused = await refusal(() =>
      service.passwordResetRequests(reviewer.token),
    );
    expect(refused.reason).toBe("forbidden");
  });

  it("refuses a reset from anyone without users.manage", async () => {
    const { service, reviewer, alice } = harness();
    const refused = await refusal(() =>
      service.resetUserPassword(reviewer.token, alice.user.id, "password-2"),
    );
    expect(refused.reason).toBe("forbidden");
  });

  it("refuses an anonymous caller", async () => {
    const { service } = harness();
    const refused = await refusal(() => service.passwordResetRequests(""));
    expect(refused.reason).toBe("auth-required");
  });

  it("refuses a weak password and an unknown account", async () => {
    const { service, accounts, admin, alice } = harness();
    accounts.requestPasswordReset("alice@example.com");
    expect(
      (
        await refusal(() =>
          service.resetUserPassword(admin.token, alice.user.id, "short"),
        )
      ).reason,
    ).toBe("weak-password");
    expect(
      (
        await refusal(() =>
          service.resetUserPassword(admin.token, "ghost-user", "password-2"),
        )
      ).reason,
    ).toBe("invalid-credentials");
    // Both refusals left the queue and the credential alone.
    expect(await service.passwordResetRequests(admin.token)).toHaveLength(1);
    expect(accounts.login("alice@example.com", "password-1").user.id).toBe(
      alice.user.id,
    );
  });
});
