import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import {
  matchesQaRoute,
  QaRouteController,
} from "../src/client/QaRouteController.js";

function fakeWindow(pathname = "/") {
  const listeners = new Set<() => void>();
  const location = { pathname, search: "" };
  const setUrl = (url?: string | URL | null) => {
    if (url !== undefined && url !== null) {
      const next = new URL(String(url), "https://example.test");
      location.pathname = next.pathname;
      location.search = next.search;
    }
  };
  const history = {
    pushState: vi.fn(
      (_data: unknown, _unused: string, url?: string | URL | null) =>
        setUrl(url),
    ),
    replaceState: vi.fn(
      (_data: unknown, _unused: string, url?: string | URL | null) =>
        setUrl(url),
    ),
  };
  return {
    target: {
      location,
      history,
      addEventListener: (_type: "popstate", listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: "popstate", listener: () => void) =>
        listeners.delete(listener),
    },
    listeners,
  };
}

describe("QA route matching", () => {
  const route = resolveConfig().route;

  it.each(["/qa", "/qa/", "/qa/topic"])("matches %s", (path) => {
    expect(matchesQaRoute(path, route)).toBe(true);
  });

  it.each(["/", "/qabc", "/api/qa"])("does not match %s", (path) => {
    expect(matchesQaRoute(path, route)).toBe(false);
  });

  it("does not let an exact root route capture children", () => {
    expect(matchesQaRoute("/other", { path: "/", matchChildren: false })).toBe(
      false,
    );
  });

  it("observes history changes and restores patched methods", () => {
    const { target, listeners } = fakeWindow();
    const originalPush = target.history.pushState;
    const originalReplace = target.history.replaceState;
    const controller = new QaRouteController(target);
    controller.configure(resolveConfig());
    const changed = vi.fn();
    controller.subscribe(changed);

    target.history.pushState({}, "", "/qa");
    expect(controller.getSnapshot()).toEqual({ pathname: "/qa", active: true });
    expect(changed).toHaveBeenCalledOnce();

    target.location.pathname = "/";
    for (const listener of listeners) listener();
    expect(controller.getSnapshot().active).toBe(false);

    controller.dispose();
    expect(target.history.pushState).toBe(originalPush);
    expect(target.history.replaceState).toBe(originalReplace);
    expect(listeners).toHaveLength(0);
  });

  it("restores a Host-redirected QA pathname before matching", () => {
    const { target } = fakeWindow("/");
    target.location.search = "?__dsh_qa_route=%2Fqa%3Fsource%3Ddirect";
    const controller = new QaRouteController(target);
    controller.configure(resolveConfig());
    expect(controller.getSnapshot()).toEqual({ pathname: "/qa", active: true });
    expect(target.location.search).toBe("?source=direct");
    controller.dispose();
  });
});
