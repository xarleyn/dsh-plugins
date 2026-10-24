// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ConfigForm,
  ConfigFormSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import { ProviderCard, type ProviderSettings } from "../src/client/card.js";
import type { PiAiProviderProfile } from "../src/upstream/config.js";
afterEach(cleanup);
const profile: PiAiProviderProfile = {
  displayName: "Demo gateway",
  api: "openai-completions",
  baseURL: "https://gateway.example.com/v1",
  headers: { "x-demo": "retained" },
  retryPolicy: { mode: "normal" },
  models: [{ id: "m", contextWindow: 8192, input: ["text"] }],
};
function fixture(writable = true, status: "ready" | "unavailable" = "ready") {
  let snapshot: ConfigFormSnapshot<ProviderSettings> = {
    status,
    writable,
    revision: 7,
    value: { providers: { demo: profile } },
    base: {},
    user: {},
  };
  const listeners = new Set<() => void>();
  const mutate = vi.fn(async (_ops: unknown, _revision?: number) => true);
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mutate,
  } as unknown as ConfigForm<ProviderSettings>;
  return {
    form,
    mutate,
    update: (patch: Partial<ConfigFormSnapshot<ProviderSettings>>) => {
      snapshot = { ...snapshot, ...patch };
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}
it("saves generation defaults without discarding advanced fields and uses the revision captured at edit start", async () => {
  const f = fixture();
  const view = render(<ProviderCard settingsForm={f.form} />);
  fireEvent.click(screen.getByRole("button", { name: /Demo gateway/ }));
  fireEvent.change(screen.getAllByLabelText("Temperature")[0]!, {
    target: { value: "0" },
  });
  f.update({ revision: 8 });
  fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
  await waitFor(() => expect(f.mutate).toHaveBeenCalledOnce());
  expect(f.mutate.mock.calls[0]).toEqual([
    [
      {
        op: "set",
        path: ["providers", "demo"],
        value: { ...profile, generation: { temperature: 0 } },
      },
    ],
    7,
  ]);
  expect(view.container.querySelector("[class*=dsh-plugin-card]")).toBeNull();
});
it("keeps read-only settings visible and disables edits", () => {
  const f = fixture(false);
  render(<ProviderCard settingsForm={f.form} />);
  fireEvent.click(screen.getByRole("button", { name: /Demo gateway/ }));
  expect(screen.getByRole("status").textContent).toMatch(/read-only/);
  expect(
    screen.getAllByLabelText("Temperature")[0]!.closest("fieldset")?.disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Add provider" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("offers System One with explicit capability limits and accepts the whole advanced profile as a draft", async () => {
  const f = fixture();
  render(<ProviderCard settingsForm={f.form} />);
  fireEvent.click(screen.getByRole("button", { name: /Demo gateway/ }));
  fireEvent.change(screen.getByLabelText("API protocol"), {
    target: { value: "systemone" },
  });
  expect(screen.queryByLabelText("Temperature")).toBeNull();
  expect(screen.getByText(/System One takes a JSON/).textContent).toMatch(
    /no chat, tools/,
  );
  fireEvent.change(screen.getByLabelText("Advanced profile JSON"), {
    target: {
      value: JSON.stringify({
        api: "systemone",
        baseURL: "https://gateway.example.com/v1",
        models: [{ id: "jev-test" }],
      }),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply JSON to draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
  await waitFor(() => expect(f.mutate).toHaveBeenCalledOnce());
  expect(f.mutate.mock.calls[0]?.[0]).toEqual([
    {
      op: "set",
      path: ["providers", "demo"],
      value: {
        api: "systemone",
        baseURL: "https://gateway.example.com/v1",
        models: [{ id: "jev-test" }],
      },
    },
  ]);
});
it("shows unavailable status and distinguishes composition reset from deleting a user provider", () => {
  const f = fixture(false, "unavailable");
  render(<ProviderCard settingsForm={f.form} />);
  expect(screen.getByRole("status").textContent).toMatch(/unavailable/);
  f.update({
    status: "ready",
    writable: true,
    base: { providers: { demo: profile } },
  });
  fireEvent.click(screen.getByRole("button", { name: /Demo gateway/ }));
  expect(
    screen.getByRole("button", { name: "Restore composition provider" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete provider" })).toBeNull();
});
