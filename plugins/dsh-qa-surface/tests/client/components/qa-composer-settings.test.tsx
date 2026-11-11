// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaComposerSettings } from "../../../src/client/components/QaComposerSettings.js";
import type { QaModelOptions } from "../../../src/types.js";

afterEach(cleanup);
const deepseek = { provider: "deepseek", model: "chat" };
const local = { provider: "local", model: "small" };
const models = [
  { ...local, label: "Qwen", reasoningEfforts: [] },
  { ...deepseek, label: "DeepSeek", reasoningEfforts: [] },
];
const sources = {
  selectedSource: null,
  effectiveSource: "stable",
  entries: [
    { id: "stable", label: "Release 2.0" },
    { id: "preview", label: "Development 2.0" },
  ],
  writable: true,
  unavailable: false,
};
function fixture(
  input: { disabled?: boolean; writable?: boolean; singleModel?: boolean } = {},
) {
  let selected = deepseek;
  const api = vi.fn(async () => ({
    ok: true as const,
    value: {
      models: input.singleModel ? models.slice(1) : models,
      choices: [deepseek, local],
      defaultModel: deepseek,
      selected,
    } satisfies QaModelOptions,
  }));
  const selectModel = vi.fn(async (pair: typeof local) => {
    selected = pair;
    return "chat-demo";
  });
  const selectCode = vi.fn(async (_source: string | null) => true);
  function View() {
    const [source, setSource] = useState<string | null>(null);
    return (
      <>
        <QaComposerSettings
          model={{
            api,
            token: "demo-token",
            sessionId: "chat-demo",
            subroleId: "general",
            preview: false,
            disabled: input.disabled ?? false,
            onSelect: selectModel,
          }}
          code={{
            value: {
              ...sources,
              selectedSource: source,
              effectiveSource: source ?? "stable",
              writable: input.writable ?? true,
            },
            disabled: input.disabled ?? false,
            pending: false,
            error: null,
            defaultLabel: "Release 2.0",
            onSelect: async (next) => {
              const ok = await selectCode(next);
              if (ok) setSource(next);
              return ok;
            },
          }}
        />
        <textarea aria-label="Сообщение" />
      </>
    );
  }
  render(<View />);
  const trigger = () =>
    screen.getByRole("button", {
      name: "Параметры чата: модель и версия кода",
    });
  return { api, selectModel, selectCode, trigger };
}
async function ready(f: ReturnType<typeof fixture>) {
  await waitFor(() => expect(f.trigger().textContent).toContain("DeepSeek"));
}
function enterModel() {
  fireEvent.click(screen.getByTestId("qa-composer-settings-model"));
}
function enterCode() {
  fireEvent.click(screen.getByTestId("qa-composer-settings-code"));
}

describe("one nested menu for chat model and code version", () => {
  it("shows a compact summary and two nested entries, without separate selects", async () => {
    const f = fixture();
    await ready(f);
    expect(f.trigger().textContent).toContain("DeepSeek · Release 2.0");
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(f.trigger());
    expect(screen.getByRole("menu", { name: "Параметры чата" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(f.selectModel).not.toHaveBeenCalled();
    expect(f.selectCode).not.toHaveBeenCalled();
  });
  it("changes only the model, waits for confirmation, and restores focus", async () => {
    const f = fixture();
    await ready(f);
    fireEvent.click(f.trigger());
    enterModel();
    expect(
      screen
        .getByRole("menuitemradio", { name: /DeepSeek/u })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Qwen/u }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(f.selectModel).toHaveBeenCalledExactlyOnceWith(local);
    expect(f.selectCode).not.toHaveBeenCalled();
    expect(f.trigger().textContent).toContain("Qwen · Release 2.0");
    expect(document.activeElement).toBe(f.trigger());
  });
  it("changes a code version and resets it to the default without touching the model", async () => {
    const f = fixture();
    await ready(f);
    fireEvent.click(f.trigger());
    enterCode();
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Development 2.0" }),
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(f.selectCode).toHaveBeenLastCalledWith("preview");
    expect(f.trigger().textContent).toContain("Development 2.0");
    fireEvent.click(f.trigger());
    enterCode();
    expect(
      screen
        .getByRole("menuitemradio", { name: "Development 2.0" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /По умолчанию/u }),
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(f.selectCode).toHaveBeenLastCalledWith(null);
    expect(f.trigger().textContent).toContain("Release 2.0");
    expect(f.selectModel).not.toHaveBeenCalled();
  });
  it("supports nested arrow navigation, selected-item focus, Escape and Tab", async () => {
    const f = fixture();
    await ready(f);
    fireEvent.keyDown(f.trigger(), { key: "ArrowDown" });
    const modelRow = screen.getByTestId("qa-composer-settings-model");
    expect(document.activeElement).toBe(modelRow);
    fireEvent.keyDown(modelRow, { key: "ArrowRight" });
    const selected = screen.getByRole("menuitemradio", { name: /DeepSeek/u });
    expect(document.activeElement).toBe(selected);
    fireEvent.keyDown(selected, { key: "Home" });
    expect(document.activeElement).toBe(
      screen.getByTestId("qa-composer-settings-back"),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("menu", { name: "Параметры чата" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(f.trigger());
    fireEvent.click(f.trigger());
    enterCode();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getByRole("menu", { name: "Параметры чата" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("closes on an outside click or focus move without taking focus back", async () => {
    const f = fixture();
    await ready(f);
    fireEvent.click(f.trigger());
    const input = screen.getByLabelText("Сообщение");
    fireEvent.pointerDown(input);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(f.trigger());
    act(() => input.focus());
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(input);
  });
  it("keeps read-only and busy settings unavailable and does not issue writes", async () => {
    const f = fixture({ disabled: true, writable: false });
    await ready(f);
    fireEvent.click(f.trigger());
    expect(
      (screen.getByTestId("qa-composer-settings-model") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("qa-composer-settings-code") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(f.selectCode).not.toHaveBeenCalled();
    expect(f.selectModel).not.toHaveBeenCalled();
  });
  it("leaves the model submenu open with the previous selection on a failed write", async () => {
    const f = fixture();
    await ready(f);
    f.selectModel.mockRejectedValueOnce(new Error("Модель недоступна."));
    fireEvent.click(f.trigger());
    enterModel();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Qwen/u }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Модель недоступна.",
    );
    expect(
      screen
        .getByRole("menuitemradio", { name: /DeepSeek/u })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("menu", { name: "Модель чата" })).toBeTruthy();
    expect(f.selectCode).not.toHaveBeenCalled();
  });
  it("still offers the code version when only one model is allowed", async () => {
    const f = fixture({ singleModel: true });
    await ready(f);
    fireEvent.click(f.trigger());
    expect(screen.queryByTestId("qa-composer-settings-model")).toBeNull();
    expect(screen.getByTestId("qa-composer-settings-code")).toBeTruthy();
  });
});
