// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserPanel } from "../src/client/BrowserPanel.js";
import { useBrowserSession } from "../src/client/use-browser-session.js";
import type { BrowserPanelFrame } from "../src/types.js";
import { host, owner, panelState, tab } from "./browser-panel.helpers.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("slow Browser frame polling", () => {
  it.each([
    { sessionId: null, visible: true },
    { sessionId: "chat-b", visible: false },
  ])(
    "clears a pending status when the next panel cannot poll ($sessionId, visible=$visible)",
    async (next) => {
      const { remote, mocks } = host(panelState([tab()], "tab-a"));
      let fail!: (error: Error) => void;
      mocks.panelState.mockReturnValue(
        new Promise<never>((_resolve, reject) => {
          fail = reject;
        }),
      );
      const props = owner(remote, "chat-a");
      const hook = renderHook(
        ({ owner: currentOwner }) =>
          useBrowserSession({ browserRemote: remote, owner: currentOwner }),
        { initialProps: { owner: props } },
      );
      expect(hook.result.current.view.statusLine).toBe("Получаем состояние…");
      hook.rerender({ owner: { ...props, ...next } });
      expect(hook.result.current.view.statusLine).toBe("Нет данных о Browser");
      await act(async () => {
        fail(new Error("old read failed"));
      });
      expect(hook.result.current.view.statusLine).toBe("Нет данных о Browser");
      expect(hook.result.current.error).toBeNull();
      expect(mocks.panelState).toHaveBeenCalledOnce();
    },
  );

  it("renders a frame slower than the active poll interval without overlapping screenshots", async () => {
    vi.useFakeTimers();
    const { remote, mocks } = host(
      panelState([tab({ status: "loading" })], "tab-a"),
    );
    mocks.panelFrame.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                value: {
                  tabId: "tab-a",
                  revision: 3,
                  title: "Example App",
                  url: "https://example.test/app",
                  mediaType: "image/png",
                  bytes: 1,
                  data: "AA==",
                },
              }),
            2500,
          ),
        ),
    );
    render(<BrowserPanel {...owner(remote)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (const duration of [1000, 1000, 600])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(duration);
      });
    expect(screen.queryByRole("img", { name: /Example App/u })).not.toBeNull();
    expect(mocks.panelFrame).toHaveBeenCalledTimes(1);
  });

  it("retires a forced read queued for the previous chat while keeping the next chat's frame", async () => {
    const { remote, mocks } = host(panelState([tab()], "tab-a"));
    let finish!: (value: { ok: true; value: BrowserPanelFrame }) => void;
    const first = new Promise<{ ok: true; value: BrowserPanelFrame }>(
      (resolve) => {
        finish = resolve;
      },
    );
    const frame = (title: string): BrowserPanelFrame => ({
      tabId: "tab-a",
      revision: 3,
      title,
      url: "https://example.test/app",
      mediaType: "image/png",
      bytes: 1,
      data: "AA==",
    });
    mocks.panelFrame.mockImplementation((_token, sessionId) =>
      sessionId === "chat-a"
        ? first
        : Promise.resolve({ ok: true, value: frame("Chat B") }),
    );
    const props = { ...owner(remote), sessionId: "chat-a" };
    const hook = renderHook(
      ({ owner: currentOwner }) =>
        useBrowserSession({ browserRemote: remote, owner: currentOwner }),
      { initialProps: { owner: props } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      void hook.result.current.refresh(true);
    });
    hook.rerender({ owner: { ...props, sessionId: "chat-b" } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.frame?.title).toBe("Chat B");
    await act(async () => {
      finish({ ok: true, value: frame("Chat A") });
    });
    expect(hook.result.current.frame?.title).toBe("Chat B");
    expect(mocks.panelState.mock.calls.map((call) => call[1])).toEqual([
      "chat-a",
      "chat-b",
    ]);
  });

  it("ignores a late heartbeat failure from the previous chat and observes release failures", async () => {
    vi.useFakeTimers();
    const { remote } = host(panelState([tab()], "tab-a"));
    let fail!: (error: Error) => void;
    const heartbeat = vi
      .spyOn(remote, "panelControlHeartbeat")
      .mockImplementation(
        () =>
          new Promise<never>((_resolve, reject) => {
            fail = reject;
          }),
      );
    const props = { ...owner(remote), sessionId: "chat-a" };
    const hook = renderHook(
      ({ owner: currentOwner }) =>
        useBrowserSession({ browserRemote: remote, owner: currentOwner }),
      { initialProps: { owner: props } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await remote.panelTakeControl(
        props.qaToken,
        "chat-a",
        hook.result.current.clientId,
      );
      await hook.result.current.refresh(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(heartbeat).toHaveBeenCalled();
    vi.spyOn(remote, "panelReleaseControl").mockRejectedValue(
      new Error("retiring lease unavailable"),
    );
    hook.rerender({ owner: { ...props, sessionId: "chat-b" } });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fail(new Error("old heartbeat failed"));
    });
    expect(hook.result.current.error).toBeNull();
  });
});
