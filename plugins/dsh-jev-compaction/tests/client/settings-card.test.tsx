// @vitest-environment jsdom

/**
 * The settings card itself (result-shaping SPEC §51, §56): the shell contract,
 * the values it projects, the writes it issues, and the two safety
 * affordances — the archive warning and the read-only state.
 *
 * A control reached through its own markup is addressed by `data-testid`, so a
 * reworded caption cannot break the test; the helper behind those lookups keeps
 * asserting the caption still labels the node it points at.
 */

import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { JevCompactionConfig } from "../../src/config/index.js";
import { JevCompactionCard } from "../../src/client/card.js";

afterEach(cleanup);

interface Op {
  readonly op: string;
  readonly path: string[];
  readonly value?: unknown;
}

/** A config form stub that records the writes the card issues. */
function stubForm(
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
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (issued: Op[]) => {
      ops.push(...issued);
    },
    set: async () => {},
    unset: async () => {},
  } as unknown as ConfigForm<JevCompactionConfig>;
  return { form, ops };
}

function renderCard(options: Parameters<typeof stubForm>[0] = {}) {
  const { form, ops } = stubForm(options);
  const result = render(<JevCompactionCard form={form} />);
  return { ...result, ops };
}

/** Expand the card the way a user does, through its own header button. */
function expand(): void {
  fireEvent.click(
    screen.getByRole("button", { name: "Show settings: Jev Compaction" }),
  );
}

/**
 * The control a test id names, with the assertion that its accessible name is
 * still wired: the id keeps a browser test alive across a reworded caption, and
 * this keeps the caption from drifting away from the control it labels.
 */
function controlById<T extends HTMLElement = HTMLElement>(
  testId: string,
  name: string | RegExp,
): T {
  const node = screen.getByTestId<T>(testId);
  expect(screen.getByLabelText(name)).toBe(node);
  return node;
}

describe("JevCompactionCard shell", () => {
  it("renders the canonical shell as a list item child", () => {
    const { container } = renderCard();
    const root = container.querySelector("li.dsh-plugin-card");
    expect(root).not.toBeNull();
    // The tab panel supplies no list of its own, so the card owns the `<ul>`
    // that keeps the shell's `<li>` a list item (AGENTS.md).
    expect(root!.parentElement?.tagName).toBe("UL");
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
    expect(screen.getByTestId("jevc-status-model").textContent).toBe(
      "jev-latest",
    );
    expect(
      controlById<HTMLInputElement>("jevc-endpoint", "Endpoint").value,
    ).toBe("https://api.typesafe.ai/v1/systemone");
    expect(
      controlById<HTMLInputElement>(
        "jevc-api-key-env",
        "API key environment variable",
      ).value,
    ).toBe("TYPESAFE_API_KEY");
    expect(
      controlById<HTMLInputElement>(
        "jevc-shaping-threshold",
        "Minimum result size",
      ).value,
    ).toBe("15000");
    // The status line never claims a health check it did not perform.
    expect(screen.getByTestId("jevc-status-enabled").textContent).toContain(
      "Enabled",
    );
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
    fireEvent.click(controlById("jevc-enabled", "Enable Jev Compaction"));
    expect(ops).toEqual([{ op: "set", path: ["enabled"], value: true }]);
  });

  it("writes a shaping toggle under its own section", () => {
    const { ops } = renderCard({
      value: { resultShaping: { enabled: false } },
    });
    expand();
    fireEvent.click(
      controlById(
        "jevc-shaping-enabled",
        "Shape tool results before they are persisted",
      ),
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
    expect(screen.getByTestId("jevc-shaping-warning")).toBeTruthy();
    expect(screen.getByTestId("jevc-archive-warning")).toBeTruthy();
  });

  it("stays quiet about recovery when the archive is on", () => {
    renderCard({
      value: { resultShaping: { enabled: true }, archive: { enabled: true } },
    });
    expand();
    expect(screen.queryByTestId("jevc-shaping-warning")).toBeNull();
    expect(screen.queryByTestId("jevc-archive-warning")).toBeNull();
  });

  it("marks a field the user layer overrides", () => {
    renderCard({ value: { enabled: true }, user: { enabled: true } });
    expand();
    expect(screen.getByTestId("jevc-enabled-chip")).toBeTruthy();
    // The mark belongs to the field the user layer owns, and to no other.
    expect(screen.getByLabelText(/Enable Jev Compaction/u)).toBeTruthy();
    expect(screen.queryByTestId("jevc-shaping-enabled-chip")).toBeNull();
  });

  it("resets every override with one unset per key", () => {
    const { ops } = renderCard({
      value: { enabled: true, resultShaping: { enabled: true } },
      user: { enabled: true, resultShaping: { enabled: false } },
    });
    expand();
    const reset = screen.getByTestId("jevc-reset-overrides");
    expect(screen.getByRole("button", { name: /Reset overrides/u })).toBe(
      reset,
    );
    fireEvent.click(reset);
    expect(ops).toEqual([
      { op: "unset", path: ["enabled"] },
      { op: "unset", path: ["resultShaping"] },
    ]);
  });

  it("disables every control on a read-only profile", () => {
    renderCard({ writable: false, value: { enabled: true } });
    expand();
    expect(
      controlById<HTMLInputElement>("jevc-enabled", "Enable Jev Compaction")
        .disabled,
    ).toBe(true);
    expect(screen.getByTestId("jevc-read-only")).toBeTruthy();
  });

  it("adds a tool to the allow list", () => {
    const { ops } = renderCard({
      value: { resultShaping: { includeTools: ["bash"] } },
    });
    expand();
    const input = controlById("jevc-include-tools", "Eligible tools");
    fireEvent.change(input, { target: { value: "cargo" } });
    // The two lists own one Add button each, so the id picks this field's own.
    fireEvent.click(screen.getByTestId("jevc-include-tools-add"));
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
