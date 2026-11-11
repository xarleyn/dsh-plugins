// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaModelSelector } from "../../../src/client/components/QaModelSelector.js";
import type { QaModelOptions } from "../../../src/types.js";

afterEach(cleanup);
const deepseek = { provider: "deepseek", model: "chat" };
const local = { provider: "local", model: "small" };
const options: QaModelOptions = {
  models: [
    { ...deepseek, label: "DeepSeek", reasoningEfforts: [] },
    { ...local, label: "Qwen", reasoningEfforts: [] },
  ],
  choices: [deepseek, local],
  defaultModel: deepseek,
  selected: deepseek,
};
const key = (pair: typeof local) => JSON.stringify([pair.provider, pair.model]);
const ok = (value: QaModelOptions) => ({ ok: true as const, value });
function fixture(value = options) {
  const api = vi.fn(async () => ok(value));
  const onSelect = vi.fn(async () => "chat-demo");
  const props = {
    api,
    onSelect,
    token: "demo-token",
    sessionId: null,
    subroleId: "general",
    preview: false,
    disabled: false,
  };
  return { ...render(<QaModelSelector {...props} />), props, api, onSelect };
}

describe("the user chat model picker", () => {
  it("hides a single model and never changes a default merely by rendering", async () => {
    const f = fixture({
      ...options,
      models: options.models.slice(0, 1),
      choices: [deepseek],
    });
    await waitFor(() =>
      expect(screen.queryByTestId("qa-model-selector")).toBeNull(),
    );
    expect(f.onSelect).not.toHaveBeenCalled();
  });
  it("switches from the configured default to an allowed alternative and shows the server-confirmed selection", async () => {
    const f = fixture();
    const select = await screen.findByRole("combobox", { name: "Модель чата" });
    await waitFor(() =>
      expect((select as HTMLSelectElement).disabled).toBe(false),
    );
    expect((select as HTMLSelectElement).value).toBe(key(deepseek));
    expect(screen.getByTestId("qa-model-selector-name").textContent).toBe(
      "DeepSeek",
    );
    expect(
      screen.getByRole("option", { name: /по умолчанию/u }).textContent,
    ).toContain("DeepSeek");
    f.api.mockResolvedValue(ok({ ...options, selected: local }));
    fireEvent.change(select, { target: { value: key(local) } });
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe(key(local)),
    );
    expect(f.onSelect).toHaveBeenCalledExactlyOnceWith(local);
    expect(f.api).toHaveBeenLastCalledWith(
      "demo-token",
      "chat-demo",
      "general",
      false,
    );
  });
  it("retains the previous selection on refusal and lets a failed catalog reload recover", async () => {
    const f = fixture();
    const select = await screen.findByRole("combobox", { name: "Модель чата" });
    await waitFor(() =>
      expect((select as HTMLSelectElement).disabled).toBe(false),
    );
    f.onSelect.mockRejectedValueOnce(new Error("Модель больше не доступна."));
    fireEvent.change(select, { target: { value: key(local) } });
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Модель больше не доступна.",
    );
    expect((select as HTMLSelectElement).value).toBe(key(deepseek));
    f.api.mockRejectedValueOnce(new Error("Offline"));
    fireEvent.click(screen.getByRole("button", { name: "Обновить модели" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("загрузить"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Обновить модели" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
  it("ignores an obsolete catalog after a role change and respects the busy/read-only disable flag", async () => {
    let settle!: (value: ReturnType<typeof ok>) => void;
    const api = vi.fn(
      () =>
        new Promise<ReturnType<typeof ok>>((resolve) => {
          settle = resolve;
        }),
    );
    const onSelect = vi.fn();
    const props = {
      api,
      onSelect,
      token: "demo-token",
      sessionId: null,
      subroleId: "general",
      preview: false,
      disabled: false,
    };
    const f = render(<QaModelSelector {...props} />);
    const old = settle;
    f.rerender(<QaModelSelector {...props} subroleId="analyst" disabled />);
    settle(ok(options));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    old(ok({ ...options, models: [] }));
    expect(
      (
        screen.getByRole("combobox", {
          name: "Модель чата",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
