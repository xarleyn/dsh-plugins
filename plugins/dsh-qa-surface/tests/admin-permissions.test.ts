import { describe, expect, it } from "vitest";
import {
  allows,
  permissionsOf,
  readsEveryConversation,
} from "../src/admin/permissions.js";
import { QA_PERMISSIONS } from "../src/admin/permissions.js";

describe("administrative permissions", () => {
  it("grants the administrator every declared permission", () => {
    for (const permission of QA_PERMISSIONS) {
      expect(allows("admin", permission), permission).toBe(true);
    }
  });

  it("lets a reviewer answer conversations without managing the deployment", () => {
    expect(readsEveryConversation("reviewer")).toBe(true);
    expect(allows("reviewer", "reviews.write")).toBe(true);
    expect(allows("reviewer", "analytics.read")).toBe(true);
    expect(allows("reviewer", "users.read")).toBe(false);
    expect(allows("reviewer", "users.manage")).toBe(false);
    expect(allows("reviewer", "roles.manage")).toBe(false);
    expect(allows("reviewer", "audit.read")).toBe(false);
    expect(allows("reviewer", "settings.manage")).toBe(false);
  });

  it("keeps an ordinary user on their own conversations", () => {
    expect(readsEveryConversation("user")).toBe(false);
    expect(allows("user", "conversations.read.own")).toBe(true);
    expect(allows("user", "reviews.read")).toBe(false);
    expect(allows("user", "reviews.write")).toBe(false);
  });

  it("never lets a role grant the same permission twice", () => {
    for (const role of ["admin", "reviewer", "user"] as const) {
      const granted = permissionsOf(role);
      expect(new Set(granted).size).toBe(granted.length);
    }
  });
});
