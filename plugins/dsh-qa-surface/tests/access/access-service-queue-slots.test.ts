import { describe, expect, it } from "vitest";
import { harness } from "./access-service.helpers.js";

/**
 * The effective request ceiling of one chat, read the way admission reads it:
 * the account's override, then the role the chat runs under, then the
 * deployment's `session.maxActiveRequests`. The pre-send read names no chat
 * yet, so it folds the account's own default role instead.
 */
describe("the queue ceiling of a chat", () => {
  it("serves each role's chats the ceiling that role was given", async () => {
    const { service, accounts, admin, user } = harness({
      session: { maxActiveRequests: 2 },
    });
    await service.createSubrole(admin.token, {
      id: "support",
      name: "Поддержка",
      enabled: true,
      capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
      maxActiveRequests: 4,
    });
    const support = accounts.register("support@example.com", "password-1");
    service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["general"],
      defaultSubrole: "general",
    });
    service.updateAssignment(admin.token, support.user.id, {
      allowedSubroles: ["support"],
      defaultSubrole: "support",
    });
    service.reserveSession(user.token, "session-a", null, false);
    service.reserveSession(support.token, "session-support", null, false);

    expect(service.queueSlotsFor("session-a")).toBe(2);
    expect(service.queueSlotsFor("session-support")).toBe(4);
  });

  it("puts one account above the ceiling its role names", async () => {
    const { service, admin, user } = harness({
      session: { maxActiveRequests: 2 },
    });
    await service.createSubrole(admin.token, {
      id: "analyst",
      name: "Аналитик",
      enabled: true,
      capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
      maxActiveRequests: 4,
    });
    await service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["analyst"],
      defaultSubrole: "analyst",
      maxActiveRequests: 1,
    });
    service.reserveSession(user.token, "session-a", null, false);

    expect(service.queueSlotsFor("session-a")).toBe(1);
  });

  it("reads the account's default role when the chat does not exist yet", async () => {
    const { service, admin, user } = harness({
      session: { maxActiveRequests: 2 },
    });
    await service.createSubrole(admin.token, {
      id: "analyst",
      name: "Аналитик",
      enabled: true,
      capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
      maxActiveRequests: 5,
    });
    await service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["analyst"],
      defaultSubrole: "analyst",
    });
    // The pre-send read carries a token but no session id to name.
    expect(service.queueSlotsForUser(user.user.id)).toBe(5);
  });

  it("falls back to the deployment number through a chat without an owner", () => {
    const { service } = harness({ session: { maxActiveRequests: 2 } });
    expect(service.queueSlotsFor("session-unknown")).toBe(2);
  });

  it("lifts the ceiling outright for an account that set zero", async () => {
    const { service, admin, user } = harness({
      session: { maxActiveRequests: 2 },
    });
    await service.updateAssignment(admin.token, user.user.id, {
      allowedSubroles: ["general"],
      defaultSubrole: "general",
      maxActiveRequests: 0,
    });
    expect(service.queueSlotsForUser(user.user.id)).toBe(0);
  });

  it("refuses a role override outside the deployment's own range", async () => {
    const { service, admin } = harness();
    await expect(
      service.createSubrole(admin.token, {
        id: "greedy",
        name: "Жадная",
        enabled: true,
        capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
        maxActiveRequests: 51,
      }),
    ).rejects.toThrow(/from 0 to 50/u);
  });

  it("refuses an account override outside the deployment's own range", async () => {
    const { service, admin, user } = harness();
    await expect(
      service.updateAssignment(admin.token, user.user.id, {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
        maxActiveRequests: -1,
      }),
    ).rejects.toThrow(/from 0 to 50/u);
  });
});
