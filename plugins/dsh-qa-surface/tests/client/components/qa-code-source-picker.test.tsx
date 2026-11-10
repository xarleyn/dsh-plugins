// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCodeSources } from "@yadsh/dsh-plugin-kit/code-sources";
import { QaCodeSourcePicker } from "../../../src/client/components/QaCodeSourcePicker.js";
import { useChatCodeSource } from "../../../src/client/use-chat-code-source.js";
import type { QaChatCodeSourceApi } from "../../../src/client/types.js";
import type { QaChatCodeSources } from "../../../src/types/code-sources.js";

afterEach(cleanup);
const catalog = resolveCodeSources({
  defaultSource: "stable",
  entries: [
    { id: "stable", label: "Release", path: "/srv/code/one" },
    { id: "preview", label: "Development", path: "/srv/code/two" },
  ],
});
function view(id = "stable"): QaChatCodeSources {
  return {
    selectedSource: id,
    effectiveSource: id,
    entries: catalog.entries,
    writable: true,
    unavailable: false,
  };
}
const props = (
  api: QaChatCodeSourceApi,
  sessionId: string | null = null,
  chatKey = 1,
) => ({ api, token: "test-token", sessionId, chatKey, catalog });

describe("chat source picker", () => {
  it("allows keyboard-native source selection and represents saving/read-only/error states", () => {
    const onSelect = vi.fn(async () => undefined);
    const rendered = render(
      <QaCodeSourcePicker
        value={view()}
        pending={false}
        disabled={false}
        error={null}
        onSelect={onSelect}
      />,
    );
    const select = screen.getByRole("combobox", {
      name: "Версия кода",
    }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "preview" } });
    expect(onSelect).toHaveBeenCalledWith("preview");
    rendered.rerender(
      <QaCodeSourcePicker
        value={{ ...view(), writable: false }}
        pending={false}
        disabled={false}
        error="Не сохранено"
        onSelect={onSelect}
      />,
    );
    expect(select.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Не сохранено");
  });
  it("keeps draft selection local and persists it before the first prompt", async () => {
    const api: QaChatCodeSourceApi = {
      read: vi.fn<QaChatCodeSourceApi["read"]>(async () => ({
        ok: true,
        value: view(),
      })),
      select: vi.fn<QaChatCodeSourceApi["select"]>(
        async (_token, _id, source) => ({
          ok: true,
          value: view(source ?? "stable"),
        }),
      ),
    };
    const h = renderHook(() => useChatCodeSource(props(api)));
    await act(async () => {
      await h.result.current.select("preview");
    });
    expect(api.select).not.toHaveBeenCalled();
    expect(h.result.current.value.selectedSource).toBe("preview");
    await act(async () => {
      await h.result.current.prepareSession("new-session");
    });
    expect(api.select).toHaveBeenCalledWith(
      "test-token",
      "new-session",
      "preview",
    );
  });
  it("loads server state on reopening and prevents a stale response from another chat overwriting it", async () => {
    let resolveOld!: (
      result: Awaited<ReturnType<QaChatCodeSourceApi["read"]>>,
    ) => void;
    const api: QaChatCodeSourceApi = {
      read: vi.fn<QaChatCodeSourceApi["read"]>((_token, id) =>
        id === "old"
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve({ ok: true, value: view("preview") }),
      ),
      select: vi.fn(),
    };
    const h = renderHook((p) => useChatCodeSource(p), {
      initialProps: props(api, "old", 1),
    });
    h.rerender(props(api, "new", 2));
    await waitFor(() =>
      expect(h.result.current.value.selectedSource).toBe("preview"),
    );
    await act(async () => {
      resolveOld({ ok: true, value: view("stable") });
    });
    expect(h.result.current.value.selectedSource).toBe("preview");
  });
  it("keeps the last confirmed choice when saving fails", async () => {
    const api: QaChatCodeSourceApi = {
      read: vi.fn<QaChatCodeSourceApi["read"]>(async () => ({
        ok: true,
        value: view(),
      })),
      select: vi.fn<QaChatCodeSourceApi["select"]>(async () => ({
        ok: false,
        error: "busy",
      })),
    };
    const h = renderHook(() => useChatCodeSource(props(api, "chat")));
    await waitFor(() => expect(h.result.current.pending).toBe(false));
    await act(async () => {
      await h.result.current.select("preview");
    });
    expect(h.result.current.value.selectedSource).toBe("stable");
    expect(h.result.current.error).toContain("не изменён");
  });
});
