// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaSurfaceProps } from "../../../src/client/QaSurface.js";
import { QaSurfaceGuard } from "../../../src/client/QaSurfaceGuard.js";

vi.mock("../../../src/client/QaSurface.js", () => ({
  QaSurface: (props: { sessions: { label: string }; conversation: { label: string } }) => (
    <div data-testid="runtime">{props.sessions.label}/{props.conversation.label}</div>
  ),
}));

describe("runtime after Host configuration loads", () => {
  it("switches both session and conversation services to the authenticated transport", () => {
    let accountsEnabled = false;
    const listeners = new Set<() => void>();
    const native = { sessions: { label: "native" }, conversation: { label: "native" } };
    const authenticated = { sessions: { label: "account" }, conversation: { label: "account" } };
    const face = {
      ...native,
      config: {
        subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
        getSnapshot: () => ({ config: { accounts: { enabled: accountsEnabled }, branding: { logoUrl: null } } }),
      },
      resolveRuntime: (enabled: boolean) => enabled ? authenticated : native,
    } as unknown as QaSurfaceProps;
    render(<QaSurfaceGuard {...face} />);
    expect(screen.getByTestId("runtime").textContent).toBe("native/native");
    act(() => { accountsEnabled = true; for (const listener of listeners) listener(); });
    expect(screen.getByTestId("runtime").textContent).toBe("account/account");
    act(() => { accountsEnabled = false; for (const listener of listeners) listener(); });
    expect(screen.getByTestId("runtime").textContent).toBe("native/native");
  });
});
