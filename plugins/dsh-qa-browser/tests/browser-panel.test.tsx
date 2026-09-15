// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserPanel,
  type BrowserPanelRemote,
} from "../src/client/BrowserPanel.js";

afterEach(cleanup);

function owner(remote: BrowserPanelRemote, sessionId: string | null = "session-a") {
  return {
    panelId: "@yadsh/dsh-qa-browser",
    panelKind: "browser",
    sessionId,
    qaToken: "secret-token",
    visible: true,
    presentation: "side" as const,
    params: undefined,
    actions: { close: vi.fn(), reveal: vi.fn() },
    signal: new AbortController().signal,
    browserRemote: remote,
  };
}

describe("BrowserPanel", () => {
  it("renders the active tab and its bounded on-demand frame", async () => {
    const panelState = vi.fn(async () => ({
      ok: true as const,
      value: {
        session: {
          sessionId: "session-a",
          status: "ready" as const,
          selectedTabId: "tab-a",
          tabIds: ["tab-a"],
          control: { owner: "agent" as const, leaseExpiresAt: null },
          profileName: null,
          createdAt: 1,
          lastActivityAt: 2,
        },
        tabs: [
          {
            id: "tab-a",
            url: "https://example.test/app",
            title: "Example App",
            status: "ready" as const,
            revision: 3,
            viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
          },
        ],
        autoRevealOnAgentActivity: true,
        focusOnAutoReveal: false,
      },
    }));
    const panelFrame = vi.fn(async () => ({
      ok: true as const,
      value: {
        tabId: "tab-a",
        revision: 3,
        url: "https://example.test/app",
        title: "Example App",
        mediaType: "image/png" as const,
        bytes: 1,
        data: "AA==",
      },
    }));
    const remote = { panelState, panelFrame } as unknown as BrowserPanelRemote;

    render(<BrowserPanel {...owner(remote)} />);

    const image = (await screen.findByRole("img", {
      name: /Example App/u,
    })) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(screen.getByText("https://example.test/app")).toBeTruthy();
    expect(screen.getByText("1440×900")).toBeTruthy();
    expect(panelState).toHaveBeenCalledWith("secret-token", "session-a");
    expect(panelFrame).toHaveBeenCalledWith(
      "secret-token",
      "session-a",
      "tab-a",
    );
  });

  it("does not call Host remotes without a QA session", async () => {
    const panelState = vi.fn();
    const panelFrame = vi.fn();
    const remote = { panelState, panelFrame } as unknown as BrowserPanelRemote;
    render(<BrowserPanel {...owner(remote, null)} />);
    expect(screen.getByRole("status").textContent).toMatch(/создайте чат/iu);
    await waitFor(() => expect(panelState).not.toHaveBeenCalled());
    expect(panelFrame).not.toHaveBeenCalled();
  });
});
