import { describe, expect, it, vi } from "vitest";
import { registerQaNavigationRoute } from "../src/host-route.js";
import { resolveConfig } from "../src/resolve-config.js";

describe("QA Host navigation route", () => {
  it("redirects GET through the canonical DSH index and preserves the target", () => {
    const register = vi.fn((route) => {
      const response = { writeHead: vi.fn(), end: vi.fn() };
      route.handler({ method: "GET", url: "/qa/topic?x=1" }, response);
      expect(response.writeHead).toHaveBeenCalledWith(302, {
        location: "/?__dsh_qa_route=%2Fqa%2Ftopic%3Fx%3D1",
        "cache-control": "no-store",
      });
      expect(response.end).toHaveBeenCalledOnce();
      return vi.fn();
    });
    registerQaNavigationRoute({ register } as never, resolveConfig());
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      kind: "prefix",
      path: "/qa",
    });
  });

  it("refuses non-navigation methods", () => {
    const register = vi.fn((route) => {
      const response = { writeHead: vi.fn(), end: vi.fn() };
      route.handler({ method: "POST", url: "/qa" }, response);
      expect(response.writeHead).toHaveBeenCalledWith(405, {
        allow: "GET, HEAD",
      });
      return vi.fn();
    });
    registerQaNavigationRoute({ register } as never, resolveConfig());
  });
});
