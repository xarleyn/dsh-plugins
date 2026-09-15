import { describe, expect, it } from "vitest";
import {
  adminPath,
  adminSectionOf,
  parseAdminRoute,
} from "../src/client/admin/routes.js";

/**
 * Deep links are the console's working surface: a reviewer pastes a finding
 * into a chat, and the link has to open the exact message. These are the
 * round-trip rules the pages rely on.
 */
describe("admin console routes", () => {
  it("treats the bare route as the overview", () => {
    expect(parseAdminRoute("/qa/admin", "/qa")).toEqual({ page: "overview" });
    expect(parseAdminRoute("/qa/admin/", "/qa")).toEqual({ page: "overview" });
  });

  it("parses each section", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["/qa/admin/users", "users"],
      ["/qa/admin/access/subroles", "subroles"],
      ["/qa/admin/access/common", "common"],
      ["/qa/admin/conversations", "conversations"],
      ["/qa/admin/review", "review"],
      ["/qa/admin/quality/feedback", "feedback"],
      ["/qa/admin/quality/analytics", "quality"],
      ["/qa/admin/audit", "audit"],
    ];
    for (const [path, page] of cases) {
      expect(parseAdminRoute(path, "/qa").page, path).toBe(page);
    }
  });

  it("carries the entity id and the deep-linked message", () => {
    expect(parseAdminRoute("/qa/admin/users/user-1", "/qa")).toEqual({
      page: "user",
      userId: "user-1",
    });
    expect(
      parseAdminRoute("/qa/admin/conversations/session-1/42", "/qa"),
    ).toEqual({
      page: "conversation",
      conversationId: "session-1",
      messageId: "42",
    });
    expect(parseAdminRoute("/qa/admin/conversations/session-1", "/qa")).toEqual(
      {
        page: "conversation",
        conversationId: "session-1",
      },
    );
  });

  it("round-trips every route through its path", () => {
    const routes = [
      { page: "overview" },
      { page: "users" },
      { page: "user", userId: "user-1" },
      { page: "subroles" },
      { page: "common" },
      { page: "conversations" },
      { page: "conversation", conversationId: "session-1", messageId: "42" },
      { page: "review" },
      { page: "feedback" },
      { page: "quality" },
      { page: "audit" },
    ] as const;
    for (const route of routes) {
      const path = adminPath("/qa", route);
      expect(parseAdminRoute(path, "/qa"), path).toEqual(route);
    }
  });

  it("works under a custom base route", () => {
    expect(adminPath("/assistant", { page: "review" })).toBe(
      "/assistant/admin/review",
    );
    expect(parseAdminRoute("/assistant/admin/users/u2", "/assistant")).toEqual({
      page: "user",
      userId: "u2",
    });
  });

  it("falls back to a section rather than an error page", () => {
    // A stale or truncated link should still land somewhere useful.
    expect(parseAdminRoute("/qa/admin/nonsense", "/qa")).toEqual({
      page: "overview",
    });
    expect(parseAdminRoute("/qa/admin/users/u1/extra", "/qa")).toEqual({
      page: "user",
      userId: "u1",
    });
  });

  it("names the section a route belongs to", () => {
    expect(adminSectionOf({ page: "user", userId: "u" })).toBe("users");
    expect(adminSectionOf({ page: "conversation", conversationId: "c" })).toBe(
      "conversations",
    );
    expect(adminSectionOf({ page: "common" })).toBe("access");
    expect(adminSectionOf({ page: "review" })).toBe("review");
  });
});
