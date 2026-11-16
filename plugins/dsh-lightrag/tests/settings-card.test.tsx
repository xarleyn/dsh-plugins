// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  ConfigForm,
  ConfigFormSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LightRagConfig } from "../src/config.js";
import { LightRagCard, type LightRagCardProps } from "../src/client/card.js";
import { LightRagSettingsEntry } from "../src/client/index.js";

afterEach(cleanup);

function makeForm(
  options: {
    writable?: boolean;
    status?: ConfigFormSnapshot<LightRagConfig>["status"];
    value?: LightRagConfig;
  } = {},
) {
  let snapshot: ConfigFormSnapshot<LightRagConfig> = {
    status: options.status ?? "ready",
    writable: options.writable ?? true,
    value: options.value ?? {},
    base: {},
    user: {},
    revision: 4,
  };
  const listeners = new Set<() => void>();
  const publish = (value: LightRagConfig): void => {
    snapshot = { ...snapshot, value, revision: (snapshot.revision ?? 0) + 1 };
    for (const listener of listeners) listener();
  };
  const mutate = vi.fn<ConfigForm<LightRagConfig>["mutate"]>(
    async (ops, revision) => {
      if (revision !== snapshot.revision) return false;
      const value = structuredClone(snapshot.value ?? {}) as Record<
        string,
        unknown
      >;
      for (const op of ops) {
        let target = value;
        for (const segment of op.path.slice(0, -1)) {
          target[segment] ??= {};
          target = target[segment] as Record<string, unknown>;
        }
        const key = op.path.at(-1)!;
        if (op.op === "unset") delete target[key];
        else if (op.op === "set") target[key] = op.value;
      }
      publish(value as LightRagConfig);
      return true;
    },
  );
  const form: ConfigForm<LightRagConfig> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mutate,
    set: async () => false,
    unset: async () => false,
  };
  return { form, mutate, publish };
}

function mount(form: ConfigForm<LightRagConfig>) {
  return render(
    <LightRagCard
      {...({ view: "page", settingsForm: form } as LightRagCardProps)}
    />,
  );
}

describe("LightRAG settings card", () => {
  it("answers summary as text without mounting a form", () => {
    expect(typeof LightRagSettingsEntry({ view: "summary" } as never)).toBe(
      "string",
    );
  });

  it("shows every setting and masks the API key", () => {
    mount(makeForm().form);
    expect(screen.getByTestId("lightrag-endpoint").getAttribute("value")).toBe(
      "http://127.0.0.1:9621",
    );
    expect(screen.getByTestId("lightrag-api-key").getAttribute("type")).toBe(
      "password",
    );
    expect(screen.getAllByRole("option")).toHaveLength(6);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(5);
    expect(
      (screen.getByTestId("lightrag-enabled") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId("lightrag-writes-enabled") as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it("saves only edited leaves atomically with the draft revision and reloads them", async () => {
    const { form, mutate } = makeForm();
    mount(form);
    fireEvent.change(screen.getByTestId("lightrag-endpoint"), {
      target: { value: "https://kb.example.com" },
    });
    fireEvent.change(screen.getByTestId("lightrag-timeout-ms"), {
      target: { value: "120000" },
    });
    fireEvent.change(screen.getByTestId("lightrag-query-mode"), {
      target: { value: "hybrid" },
    });
    fireEvent.click(screen.getByTestId("lightrag-writes-enabled"));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("lightrag-save"));
    await screen.findByText("Настройки сохранены и применены к новым вызовам.");
    expect(mutate).toHaveBeenCalledWith(
      [
        { op: "set", path: ["endpoint"], value: "https://kb.example.com" },
        { op: "set", path: ["query", "mode"], value: "hybrid" },
        { op: "set", path: ["writes", "enabled"], value: true },
        { op: "set", path: ["timeoutMs"], value: 120000 },
      ],
      4,
    );
    cleanup();
    mount(form);
    expect(
      (screen.getByTestId("lightrag-timeout-ms") as HTMLInputElement).value,
    ).toBe("120000");
    expect(
      (screen.getByTestId("lightrag-writes-enabled") as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it.each([
    "http://kb.example.com/query",
    "ftp://kb.example.com",
    "http://user:pass@kb.example.com",
    "http://kb.example.com?q=1",
  ])("refuses invalid origin %s before writing", async (endpoint) => {
    const { form, mutate } = makeForm();
    mount(form);
    fireEvent.change(screen.getByTestId("lightrag-endpoint"), {
      target: { value: endpoint },
    });
    expect(screen.getByRole("alert").textContent).toContain("без пути");
    fireEvent.submit(screen.getByTestId("lightrag-settings"));
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each(["999", "300001", "1000.5"])(
    "rejects invalid timeout %s",
    (timeout) => {
      const { form, mutate } = makeForm();
      mount(form);
      fireEvent.change(screen.getByTestId("lightrag-timeout-ms"), {
        target: { value: timeout },
      });
      expect(screen.getByRole("alert").textContent).toContain("целое число");
      fireEvent.submit(screen.getByTestId("lightrag-settings"));
      expect(mutate).not.toHaveBeenCalled();
    },
  );

  it("clears a numeric override with unset and leaves other sections alone", async () => {
    const { form, mutate } = makeForm({
      value: { timeoutMs: 70000, query: { topK: 37 } },
    });
    mount(form);
    fireEvent.change(screen.getByTestId("lightrag-timeout-ms"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("lightrag-save"));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        [{ op: "unset", path: ["timeoutMs"] }],
        4,
      ),
    );
    expect(form.getSnapshot().value?.query?.topK).toBe(37);
  });

  it("keeps a conflicting draft and lets Cancel reload the current host values", async () => {
    const { form, publish } = makeForm();
    mount(form);
    fireEvent.change(screen.getByTestId("lightrag-timeout-ms"), {
      target: { value: "80000" },
    });
    act(() => publish({ timeoutMs: 90000 }));
    fireEvent.click(screen.getByTestId("lightrag-save"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "не сохранены",
    );
    expect(
      (screen.getByTestId("lightrag-timeout-ms") as HTMLInputElement).value,
    ).toBe("80000");
    fireEvent.click(screen.getByTestId("lightrag-cancel"));
    expect(
      (screen.getByTestId("lightrag-timeout-ms") as HTMLInputElement).value,
    ).toBe("90000");
  });

  it("handles a transport rejection without losing the draft or displaying secrets", async () => {
    const { form, mutate } = makeForm();
    mutate.mockRejectedValueOnce(new Error("synthetic-private-key"));
    mount(form);
    fireEvent.change(screen.getByTestId("lightrag-api-key"), {
      target: { value: "synthetic-test-key" },
    });
    fireEvent.click(screen.getByTestId("lightrag-save"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Не удалось сохранить",
    );
    expect(screen.getByRole("alert").textContent).not.toContain(
      "synthetic-private-key",
    );
    expect(
      (screen.getByTestId("lightrag-api-key") as HTMLInputElement).value,
    ).toBe("synthetic-test-key");
  });

  it("renders read-only values with disabled controls", () => {
    mount(makeForm({ writable: false }).form);
    for (const control of document.querySelectorAll("input, select, button")) {
      expect((control as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText(/только для чтения/u)).toBeDefined();
  });

  it.each(["loading", "unavailable"] as const)(
    "explains %s without inventing editable defaults",
    (status) => {
      mount(makeForm({ status }).form);
      expect(screen.getByRole("status").textContent).toContain("LightRAG");
      expect(document.querySelector("input")).toBeNull();
    },
  );
});
