// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaPreviewBrowser } from "../../../src/client/role/preview.js";
import {
  previewEntryState,
  useQaAdminPreview,
} from "../../../src/client/role/preview.js";

/**
 * A history the test drives by hand, standing in for the browser's: `navigate`
 * is the Back button, and `pushState` stands in for the navigation that opens
 * the chat route (which React only learns about through a route change).
 */
function fakeBrowser(initial: unknown = null) {
  let state = initial;
  const listeners = new Set<() => void>();
  const browser: QaPreviewBrowser = {
    get state() {
      return state;
    },
    pushState: (data) => {
      state = data;
    },
    replaceState: (data) => {
      state = data;
    },
    onPopState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    browser,
    read: () => state,
    navigate(next: unknown) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

const PREVIEW = previewEntryState({ id: "analyst", name: "Аналитик" });

function Probe(props: {
  readonly history: ReturnType<typeof fakeBrowser>;
  readonly isAdmin: boolean;
  readonly fallback?: string | null;
  readonly routeKey?: string;
  readonly onSelect: (roleId: string | null) => void;
}) {
  const mode = useQaAdminPreview({
    isAdmin: props.isAdmin,
    fallbackSubrole: props.fallback ?? null,
    previewUrl: "/qa",
    routeKey: props.routeKey ?? "/qa",
    onSelect: props.onSelect,
    target: props.history.browser,
  });
  return (
    <div>
      <output data-testid="role">{mode.preview?.roleId ?? "none"}</output>
      <output data-testid="name">{mode.preview?.name ?? "none"}</output>
      <button
        type="button"
        onClick={() => mode.enter({ id: "analyst", name: "Аналитик" })}
      >
        войти
      </button>
      <button type="button" onClick={() => mode.leave()}>
        выйти
      </button>
      <button type="button" onClick={() => mode.clear()}>
        сбросить
      </button>
    </div>
  );
}

function roleText(): string {
  return screen.getByTestId("role").textContent ?? "";
}

describe("administrator preview mode", () => {
  it("enters the preview an administrator's entry asks for", () => {
    const history = fakeBrowser(PREVIEW);
    const onSelect = vi.fn();
    render(
      <Probe
        history={history}
        isAdmin
        onSelect={onSelect}
        fallback="general"
      />,
    );
    expect(roleText()).toBe("analyst");
    expect(screen.getByTestId("name").textContent).toBe("Аналитик");
    expect(onSelect).toHaveBeenCalledWith("analyst");
  });

  it("never enters a preview for an ordinary account", () => {
    const history = fakeBrowser(PREVIEW);
    const onSelect = vi.fn();
    render(
      <Probe
        history={history}
        isAdmin={false}
        onSelect={onSelect}
        fallback="general"
      />,
    );
    expect(roleText()).toBe("none");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("leaves the preview when a navigation drops the marker", () => {
    // The leak this replaces: the mode was latched on mount, so "← В чат" and
    // the Back button both left it in force, and every later new chat ran as
    // the previewed profile instead of the account's default one.
    const history = fakeBrowser(PREVIEW);
    const onSelect = vi.fn();
    render(
      <Probe
        history={history}
        isAdmin
        onSelect={onSelect}
        fallback="general"
      />,
    );
    expect(roleText()).toBe("analyst");
    act(() => history.navigate(null));
    expect(roleText()).toBe("none");
    expect(onSelect).toHaveBeenLastCalledWith("general");
  });

  it("leaves the preview when the chat route is entered again", () => {
    const history = fakeBrowser(PREVIEW);
    const onSelect = vi.fn();
    const { rerender } = render(
      <Probe
        history={history}
        isAdmin
        onSelect={onSelect}
        fallback="general"
        routeKey="/qa/admin"
      />,
    );
    expect(roleText()).toBe("analyst");
    // "← В чат" navigates without a popstate event; the route change is what
    // the tab learns about, and the entry it lands on carries no marker.
    history.browser.pushState(null, "", "/qa");
    rerender(
      <Probe
        history={history}
        isAdmin
        onSelect={onSelect}
        fallback="general"
        routeKey="/qa"
      />,
    );
    expect(roleText()).toBe("none");
  });

  it("leaves a marker another account left behind", () => {
    const history = fakeBrowser(PREVIEW);
    const onSelect = vi.fn();
    const { rerender } = render(
      <Probe
        history={history}
        isAdmin
        onSelect={onSelect}
        fallback="general"
      />,
    );
    expect(roleText()).toBe("analyst");
    // The marker survives in the entry across a sign-out; latching it again
    // would hand the next account a chat under a profile it never held.
    rerender(
      <Probe
        history={history}
        isAdmin={false}
        onSelect={onSelect}
        fallback="general"
      />,
    );
    expect(roleText()).toBe("none");
  });

  it("keeps the mode while the same entry stays current", () => {
    const history = fakeBrowser(PREVIEW);
    const onSelect = vi.fn();
    render(
      <Probe
        history={history}
        isAdmin
        onSelect={onSelect}
        fallback="general"
      />,
    );
    act(() => history.navigate(PREVIEW));
    expect(roleText()).toBe("analyst");
  });

  it("enters the console's preview and clears it on the way out", () => {
    const history = fakeBrowser(null);
    const onSelect = vi.fn();
    render(
      <Probe
        history={history}
        isAdmin
        onSelect={onSelect}
        fallback="general"
      />,
    );
    fireEvent.click(screen.getByText("войти"));
    expect(roleText()).toBe("analyst");
    expect(history.read()).toEqual(PREVIEW);
    fireEvent.click(screen.getByText("выйти"));
    expect(roleText()).toBe("none");
    expect(history.read()).toBeNull();
    expect(onSelect).toHaveBeenLastCalledWith("general");
  });

  it("clears the mode without rewriting the entry", () => {
    // An ordinary chat opened from the list ends the mode, but the entry that
    // asked for the preview stays navigable: Back enters it again.
    const history = fakeBrowser(PREVIEW);
    const onSelect = vi.fn();
    render(
      <Probe
        history={history}
        isAdmin
        onSelect={onSelect}
        fallback="general"
      />,
    );
    expect(roleText()).toBe("analyst");
    fireEvent.click(screen.getByText("сбросить"));
    expect(roleText()).toBe("none");
    expect(history.read()).toEqual(PREVIEW);
  });
});
