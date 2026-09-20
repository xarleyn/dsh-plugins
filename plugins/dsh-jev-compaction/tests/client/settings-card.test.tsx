// @vitest-environment jsdom

/**
 * The settings card itself (result-shaping SPEC §51, §56): the shell contract,
 * the values it projects, the writes it issues, and the two safety
 * affordances — the archive warning and the read-only state.
 */

import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { JevCompactionConfig } from "../../src/config.js";
import { JevCompactionCard } from "../../src/client/card.js";

afterEach(cleanup);

interface Op {
  readonly op: string;
  readonly path: string[];
  readonly value?: unknown;
}

/** A settings scope stub that applies writes onto a fake user layer. */
function stubScope(
  options: {
    readonly value?: JevCompactionConfig;
    readonly user?: unknown;
    readonly status?: "loading" | "ready" | "unavailable";
    readonly writable?: boolean;
  } = {},
) {
  const ops: Op[] = [];
  // One stable snapshot object: `useSyncExternalStore` re-renders whenever the
  // identity changes, so a fresh object per call would loop forever.
  const snapshot = {
    status: options.status ?? "ready",
    value: options.value ?? {},
    base: {},
    user: options.user ?? {},
    revision: 1,
    writable: options.writable ?? true,
    mode: "host" as const,
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (issued: Op[]) => {
      ops.push(...issued);
    },
    set: async () => {},
    unset: async () => {},
  } as unknown as SettingsScope<JevCompactionConfig>;
  return { scope, ops };
}

function renderCard(options: Parameters<typeof stubScope>[0] = {}) {
  const { scope, ops } = stubScope(options);
  const result = render(<JevCompactionCard scope={scope} />);
  return { ...result, ops };
}

/** Expand the card the way a user does, through its own header button. */
function expand(): void {
  fireEvent.click(
    screen.getByRole("button", { name: "Show settings: Jev Compaction" }),
  );
}

describe("JevCompactionCard shell", () => {
  it("renders the canonical shell as a list item child", () => {
    const { container } = renderCard();
    const root = container.querySelector("li.dsh-plugin-card");
    expect(root).not.toBeNull();
    expect(root!.querySelector(".dsh-plugin-card__header")).not.toBeNull();
    expect(root!.querySelector(".dsh-plugin-card__name")!.textContent).toBe(
      "Jev Compaction",
    );
    expect(
      root!.querySelector(".dsh-plugin-card__description")!.textContent,
    ).toContain("Semantic result shaping and historical context compaction");
    expect(root!.querySelector(".dsh-plugin-card__chevron")).not.toBeNull();
    // The body only exists while the card is open.
    expect(root!.querySelector(".dsh-plugin-card__body")).toBeNull();
  });

  it("opens and closes through the header button", () => {
    const { container } = renderCard();
    expand();
    const root = container.querySelector("li.dsh-plugin-card")!;
    expect(root.classList.contains("dsh-plugin-card--open")).toBe(true);
    expect(root.querySelector(".dsh-plugin-card__body")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Hide settings: Jev Compaction" }),
    ).toBeTruthy();
  });

  it("uses no font-glyph chevron", () => {
    const { container } = renderCard();
    expect(container.textContent).not.toMatch(/[\u2304\u25be]/u);
    expect(container.querySelector("svg path")!.getAttribute("d")).toBe(
      "m3.5 5.25 3.5 3.5 3.5-3.5",
    );
  });

  it("renders nothing when the namespace is unavailable", () => {
    const { container } = renderCard({ status: "unavailable" });
    expect(container.childElementCount).toBe(0);
  });
});

describe("JevCompactionCard content", () => {
  it("projects the resolved configuration", () => {
    renderCard({
      value: {
        enabled: true,
        jev: {
          model: "jev-latest",
          apiKeyEnv: "TYPESAFE_API_KEY",
          baseUrl: "https://api.typesafe.ai/v1/systemone",
        },
        resultShaping: { enabled: false, thresholdChars: 15000 },
      },
    });
    expand();
    expect(screen.getByText("jev-latest")).toBeTruthy();
    expect(
      screen.getByDisplayValue("https://api.typesafe.ai/v1/systemone"),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("TYPESAFE_API_KEY")).toBeTruthy();
    expect(screen.getByDisplayValue("15000")).toBeTruthy();
    // The status line never claims a health check it did not perform.
    expect(screen.getByText(/Enabled/)).toBeTruthy();
  });

  it("never renders a resolved secret, only the variable name", () => {
    renderCard({
      value: {
        jev: {
          model: "jev-latest",
          apiKeyEnv: "TYPESAFE_API_KEY",
          baseUrl: "https://api.typesafe.ai/v1/systemone",
        },
      },
    });
    expand();
    expect(screen.getByText(/never reaches this page/u)).toBeTruthy();
    // No password-style input exists on the card at all.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("writes an enable toggle as one path-addressed set", () => {
    const { ops } = renderCard({ value: { enabled: false } });
    expand();
    fireEvent.click(screen.getByLabelText("Enable Jev Compaction"));
    expect(ops).toEqual([{ op: "set", path: ["enabled"], value: true }]);
  });

  it("writes a shaping toggle under its own section", () => {
    const { ops } = renderCard({
      value: { resultShaping: { enabled: false } },
    });
    expand();
    fireEvent.click(
      screen.getByLabelText("Shape tool results before they are persisted"),
    );
    expect(ops).toEqual([
      { op: "set", path: ["resultShaping", "enabled"], value: true },
    ]);
  });

  it("warns visibly when shaping is on and the archive is off", () => {
    renderCard({
      value: { resultShaping: { enabled: true }, archive: { enabled: false } },
    });
    expand();
    expect(
      screen.getAllByText(/may not be recoverable from session replay/u).length,
    ).toBeGreaterThan(0);
  });

  it("stays quiet about recovery when the archive is on", () => {
    renderCard({
      value: { resultShaping: { enabled: true }, archive: { enabled: true } },
    });
    expand();
    expect(
      screen.queryByText(/may not be recoverable from session replay/u),
    ).toBeNull();
  });

  it("marks a field the user layer overrides", () => {
    renderCard({ value: { enabled: true }, user: { enabled: true } });
    expand();
    expect(screen.getAllByText(/overridden/u).length).toBeGreaterThan(0);
  });

  it("resets every override with one unset per key", () => {
    const { ops } = renderCard({
      value: { enabled: true, resultShaping: { enabled: true } },
      user: { enabled: true, resultShaping: { enabled: false } },
    });
    expand();
    fireEvent.click(screen.getByRole("button", { name: /Reset overrides/u }));
    expect(ops).toEqual([
      { op: "unset", path: ["enabled"] },
      { op: "unset", path: ["resultShaping"] },
    ]);
  });

  it("disables every control on a read-only profile", () => {
    renderCard({ writable: false, value: { enabled: true } });
    expand();
    expect(
      screen.getByLabelText<HTMLInputElement>("Enable Jev Compaction").disabled,
    ).toBe(true);
    expect(screen.getByText(/read-only/u)).toBeTruthy();
  });

  it("adds a tool to the allow list", () => {
    const { ops } = renderCard({
      value: { resultShaping: { includeTools: ["bash"] } },
    });
    expand();
    const input = screen.getByPlaceholderText("add a tool name");
    fireEvent.change(input, { target: { value: "cargo" } });
    // Two lists on the card each own an Add button; the eligible-tools one is
    // the first, and its input is the one just typed into.
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]!);
    expect(ops).toEqual([
      {
        op: "set",
        path: ["resultShaping", "includeTools"],
        value: ["bash", "cargo"],
      },
    ]);
  });

  it("removes a tool from the allow list", () => {
    const { ops } = renderCard({
      value: { resultShaping: { includeTools: ["bash", "pwsh"] } },
    });
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Remove bash" }));
    expect(ops).toEqual([
      { op: "set", path: ["resultShaping", "includeTools"], value: ["pwsh"] },
    ]);
  });
});
