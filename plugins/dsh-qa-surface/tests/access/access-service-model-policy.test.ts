import { describe, expect, it } from "vitest";
import { harness } from "./access-service.helpers.js";

/**
 * The provider and model a QA policy fixes, rather than the one pair the whole
 * stand shares.
 *
 * A support desk answered by a local model and every other role answered by a
 * paid one is the operator's decision; the interface's own model picker is not.
 * These cases read the policy the way the session opens on it: the account
 * first, then the role it runs under, then the deployment, and nothing at all
 * where no layer spoke.
 */
describe("the model policy of a QA role", () => {
  it("opens each role's chat on the pair that role was given", async () => {
    const { service, accounts, admin, user } = harness();
    await service.createSubrole(admin.token, {
      id: "support",
      name: "Поддержка",
      enabled: true,
      capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
      model: { provider: "local", model: "small" },
    });
    await service.createSubrole(admin.token, {
      id: "analyst",
      name: "Аналитик",
      enabled: true,
      capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
      model: { provider: "deepseek", model: "chat" },
    });
    const analyst = user;
    const support = accounts.register("support@example.com", "password-1");
    service.updateAssignment(admin.token, analyst.user.id, {
      allowedSubroles: ["analyst"],
      defaultSubrole: "analyst",
    });
    service.updateAssignment(admin.token, support.user.id, {
      allowedSubroles: ["support"],
      defaultSubrole: "support",
    });
    service.reserveSession(analyst.token, "session-analyst", null, false);
    service.reserveSession(support.token, "session-support", null, false);

    expect(service.modelPolicyFor("session-analyst").pair).toEqual({
      provider: "deepseek",
      model: "chat",
    });
    expect(service.modelPolicyFor("session-support").pair).toEqual({
      provider: "local",
      model: "small",
    });
    expect(service.modelPolicyFor("session-support").layer).toBe("subrole");
  });

  it("puts one account above the pair its role names", async () => {
    const { service, admin, user } = harness();
    await service.createSubrole(admin.token, {
      id: "analyst",
      name: "Аналитик",
      enabled: true,
      capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
      model: { provider: "deepseek", model: "chat", reasoningEffort: "high" },
    });
    await service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["analyst"],
      defaultSubrole: "analyst",
      model: { provider: "local", model: "small" },
    });
    service.reserveSession(user.token, "session-a", null, false);

    const policy = service.modelPolicyFor("session-a");
    expect(policy.pair).toEqual({ provider: "local", model: "small" });
    expect(policy.layer).toBe("account");
  });

  it("falls back to the deployment pair when no role names one", () => {
    const { service, admin, user } = harness({
      session: { provider: "premium", model: "top", reasoningEffort: "low" },
    });
    service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["general"],
      defaultSubrole: "general",
    });
    service.reserveSession(user.token, "session-a", null, false);

    const policy = service.modelPolicyFor("session-a");
    expect(policy.pair).toEqual({
      provider: "premium",
      model: "top",
      reasoningEffort: "low",
    });
    expect(policy.layer).toBe("deployment");
  });

  it("names no pair for a chat behind which no policy stands", () => {
    const { service } = harness();
    const policy = service.modelPolicyFor("session-unknown");
    expect(policy.pair).toBeUndefined();
    expect(policy.layer).toBeUndefined();
  });

  it("refuses a role pair the Host does not offer, and stores nothing", async () => {
    const { service, admin } = harness();
    await expect(
      service.createSubrole(admin.token, {
        id: "typo",
        name: "Опечатка",
        enabled: true,
        capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
        model: { provider: "local", model: "smal" },
      }),
    ).rejects.toThrow(/does not offer/u);
    expect(service.roles.snapshot().subroles.map(({ id }) => id)).not.toContain(
      "typo",
    );
  });

  it("names the provider that really offers a model", async () => {
    const { service, admin } = harness();
    await expect(
      service.createSubrole(admin.token, {
        id: "typo",
        name: "Опечатка",
        enabled: true,
        capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
        model: { provider: "deepseek", model: "small" },
      }),
    ).rejects.toThrow(/only offered by local/u);
  });

  it("refuses an account pair the Host does not offer", async () => {
    const { service, accounts, admin, user } = harness();
    await expect(
      service.updateAssignment(admin.token, user.user.id, {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
        model: { provider: "nobody", model: "nothing" },
      }),
    ).rejects.toThrow(/does not offer/u);
    expect(accounts.accessOf(user.user.id)?.model).toBeUndefined();
  });

  it("keeps a half pair out of the store", async () => {
    const { service, admin, user } = harness();
    await expect(
      service.updateAssignment(admin.token, user.user.id, {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
        // Only the provider: the Host refuses a pair it cannot complete.
        model: { provider: "local", model: "" },
      }),
    ).rejects.toThrow(/set together/u);
  });
});
