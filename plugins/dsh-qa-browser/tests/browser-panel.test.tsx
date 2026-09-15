// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        humanControlEnabled: true,
        humanControlLeaseSeconds: 30,
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
    expect(screen.getByRole("textbox", { name: "Адрес Browser" })).toHaveProperty(
      "value",
      "https://example.test/app",
    );
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

  it("takes explicit control and maps panel clicks to source viewport coordinates", async () => {
    let control:
      | { owner: "agent"; leaseExpiresAt: null }
      | {
          owner: "human";
          clientId: string;
          leaseExpiresAt: number;
        } = { owner: "agent", leaseExpiresAt: null };
    const panelState = vi.fn(async () => ({
      ok: true as const,
      value: {
        session: {
          sessionId: "session-a",
          status: "ready" as const,
          selectedTabId: "tab-a",
          tabIds: ["tab-a"],
          control,
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
            viewport: { width: 1_000, height: 500, deviceScaleFactor: 1 },
          },
        ],
        humanControlEnabled: true,
        humanControlLeaseSeconds: 30,
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
    const panelTakeControl = vi.fn(
      async (_token: string, _sessionId: string, nextClientId: string) => {
        control = {
          owner: "human",
          clientId: nextClientId,
          leaseExpiresAt: Date.now() + 30_000,
        };
        return { ok: true as const, value: control };
      },
    );
    const panelPointer = vi.fn(async () => ({
      ok: true as const,
      value: {
        ok: true,
        sessionId: "session-a",
        tabId: "tab-a",
        revision: 4,
        url: "https://example.test/app",
        title: "Example App",
        summary: "clicked",
      },
    }));
    const remote = {
      panelState,
      panelFrame,
      panelTakeControl,
      panelPointer,
      panelControlHeartbeat: vi.fn(),
      panelReleaseControl: vi.fn(async () => ({
        ok: true as const,
        value: { owner: "agent" as const, leaseExpiresAt: null },
      })),
    } as unknown as BrowserPanelRemote;
    render(<BrowserPanel {...owner(remote)} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Взять управление" }),
    );
    const image = (await screen.findByRole("img", {
      name: /Example App/u,
    })) as HTMLImageElement;
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      width: 500,
      height: 250,
      right: 600,
      bottom: 300,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });
    fireEvent.click(image, { clientX: 350, clientY: 175, detail: 1 });

    await waitFor(() => expect(panelPointer).toHaveBeenCalled());
    const call = panelPointer.mock.calls[0] as unknown[];
    expect(call.slice(0, 6)).toEqual([
      "secret-token",
      "session-a",
      "tab-a",
      expect.any(String),
      "click",
      500,
    ]);
    expect(call[6]).toBe(250);
    expect(call[7]).toBe("left");
    expect(call[8]).toBe(1);
  });
});
