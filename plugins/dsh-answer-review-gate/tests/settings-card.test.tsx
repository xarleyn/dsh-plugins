// @vitest-environment jsdom
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerReviewGateConfig } from "../src/config.js";
import { ReviewSettingsCard, ReviewSettingsEntry } from "../src/client/card.js";

afterEach(cleanup);
function fixture(writable = true) {
  const state = {
    status: "ready",
    writable,
    value: {
      maxToolCallsPerRound: 120,
      reviewTimeoutMs: 300000,
      maxConsecutiveRefusalsPerRound: 5,
      maxReviewRounds: 3,
      reviewer: { roundTimeoutMs: 600000 },
      failMode: "warn",
    },
  };
  const mutate = vi.fn(async () => state);
  const settingsForm = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    mutate,
  } as unknown as ConfigForm<AnswerReviewGateConfig>;
  return { settingsForm, mutate };
}
describe("review settings card", () => {
  it("shows seconds and commits milliseconds through the profile form", async () => {
    const f = fixture();
    render(<ReviewSettingsCard settingsForm={f.settingsForm} />);
    const timeout = screen.getByRole("spinbutton", {
      name: /Review timeout/,
    }) as HTMLInputElement;
    expect(timeout.value).toBe("300");
    fireEvent.change(timeout, { target: { value: "420" } });
    fireEvent.blur(timeout);
    await waitFor(() =>
      expect(f.mutate).toHaveBeenCalledWith([
        { op: "set", path: ["reviewTimeoutMs"], value: 420000 },
      ]),
    );
  });
  it("writes the outer deadline to its nested reviewer path", async () => {
    const f = fixture();
    render(<ReviewSettingsCard settingsForm={f.settingsForm} />);
    const timeout = screen.getByRole("spinbutton", {
      name: /Outer round deadline/,
    });
    fireEvent.change(timeout, { target: { value: "900" } });
    fireEvent.blur(timeout);
    await waitFor(() =>
      expect(f.mutate).toHaveBeenCalledWith([
        { op: "set", path: ["reviewer", "roundTimeoutMs"], value: 900000 },
      ]),
    );
  });
  it("leaves read-only controls disabled and reports rejected writes", async () => {
    const f = fixture(false);
    const shown = render(<ReviewSettingsCard settingsForm={f.settingsForm} />);
    expect(
      (
        screen.getByRole("spinbutton", {
          name: /Tool calls/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(f.mutate).not.toHaveBeenCalled();
    shown.unmount();
    const editable = fixture();
    editable.mutate.mockRejectedValueOnce(
      new Error("Configuration changed; reload it."),
    );
    render(<ReviewSettingsCard settingsForm={editable.settingsForm} />);
    const calls = screen.getByRole("spinbutton", { name: /Tool calls/ });
    fireEvent.change(calls, { target: { value: "150" } });
    fireEvent.blur(calls);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Configuration changed",
      ),
    );
  });
  it("renders only a sentence in the Host's summary view", () => {
    const f = fixture();
    const shown = render(
      <ReviewSettingsEntry view="summary" settingsForm={f.settingsForm} />,
    );
    expect(shown.container.querySelector("input")).toBeNull();
    expect(shown.container.textContent).toContain("Independent review");
  });
});
