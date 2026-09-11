import { describe, expect, it, vi } from "vitest";
import {
  hasHostAuthCookie,
  registerQaNavigationRoute,
} from "../src/host-route.js";
import { resolveConfig } from "../src/resolve-config.js";

function capture(
  handler: (request: unknown, response: unknown) => void,
  request: unknown = { method: "GET", url: "/qa", headers: {} },
) {
  const response = {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
  handler(request, response);
  return response;
}

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

  it("sends cookie-less browsers through the launch-token exchange", () => {
    const register = vi.fn((route) => {
      const response = capture(route.handler);
      expect(response.writeHead).toHaveBeenCalledWith(302, {
        location: "/?token=secret-token",
        "cache-control": "no-store",
      });
      return vi.fn();
    });
    registerQaNavigationRoute({ register } as never, resolveConfig(), {
      launchToken: () => "secret-token",
    });
  });

  it("keeps the marker hand-off when the browser holds a host cookie", () => {
    const register = vi.fn((route) => {
      const response = capture(route.handler, {
        method: "GET",
        url: "/qa",
        headers: { cookie: "dsh-auth-abc=v1.sig" },
      });
      expect(response.writeHead).toHaveBeenCalledWith(302, {
        location: "/?__dsh_qa_route=%2Fqa",
        "cache-control": "no-store",
      });
      return vi.fn();
    });
    registerQaNavigationRoute({ register } as never, resolveConfig(), {
      launchToken: () => "secret-token",
    });
  });

  it("falls back to the marker hand-off without the bridge or the flag", () => {
    let calls = 0;
    const register = vi.fn((route) => {
      const response = capture(route.handler);
      expect(response.writeHead).toHaveBeenCalledWith(302, {
        location: "/?__dsh_qa_route=%2Fqa",
        "cache-control": "no-store",
      });
      calls += 1;
      return vi.fn();
    });
    // Bridge present but unable to resolve a token.
    registerQaNavigationRoute({ register } as never, resolveConfig(), {
      launchToken: () => undefined,
    });
    // Bridge present and the operator turned the bootstrap off.
    registerQaNavigationRoute(
      { register } as never,
      resolveConfig({ entry: { cookieBootstrap: false } }),
      { launchToken: () => "unused" },
    );
    expect(calls).toBe(2);
  });

  it("recognizes the dsh-auth cookie family by prefix", () => {
    expect(
      hasHostAuthCookie({
        headers: { cookie: "dsh-auth-abc123=v1.sig; other=1" },
      } as never),
    ).toBe(true);
    expect(
      hasHostAuthCookie({ headers: { cookie: "session=abc" } } as never),
    ).toBe(false);
    expect(hasHostAuthCookie({ headers: {} } as never)).toBe(false);
  });
});
