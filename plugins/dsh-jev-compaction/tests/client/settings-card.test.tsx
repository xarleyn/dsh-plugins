// @vitest-environment jsdom

/**
 * The settings card itself (result-shaping SPEC §51, §56): the markup the Plugins
 * page leaves to this bundle, the values it projects, the writes it issues, and the
 * two safety affordances — the archive warning and the read-only state.
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
  const result = render(<JevCompactionCard settingsForm={form} />);
  return { ...result, ops };
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

describe("JevCompactionCard frame", () => {
  it("renders the body directly, with no card of its own around it", () => {
    const { container } = renderCard();
    // The Plugins page draws this card's frame, its heading and its expand
    // control, so the bundle mounts the controls and nothing around them
    // (AGENTS.md): no list item, no disclosure button, no chevron.
    const root = container.querySelector(".jevc-body")!;
    expect(root.tagName).toBe("DIV");
    expect(root.parentElement?.tagName).not.toBe("LI");
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /settings: Jev Compaction/u }),
    ).toBeNull();
  });

  it("mounts the controls without an expand step", () => {
    renderCard();
    // The page opens the row; the body is there the moment it does.
    expect(controlById("jevc-enabled", "Enable Jev Compaction")).toBeTruthy();
  });

  it("explains an unavailable namespace instead of vanishing", () => {
    const { container } = renderCard({ status: "unavailable" });
    // Rendering nothing inside a row the page just expanded would leave the
    // reader with an empty section and no reason.
    expect(container.querySelector(".jevc-body")?.textContent).toContain(
      "not available in this session",
    );
    expect(container.querySelector("input, select, button")).toBeNull();
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
    expect(screen.getByText(/never reaches this page/u)).toBeTruthy();
    // No password-style input exists on the card at all.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("writes an enable toggle as one path-addressed set", () => {
    const { ops } = renderCard({ value: { enabled: false } });
    fireEvent.click(controlById("jevc-enabled", "Enable Jev Compaction"));
    expect(ops).toEqual([{ op: "set", path: ["enabled"], value: true }]);
  });

  it("writes a shaping toggle under its own section", () => {
    const { ops } = renderCard({
      value: { resultShaping: { enabled: false } },
    });
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
    expect(screen.getByTestId("jevc-shaping-warning")).toBeTruthy();
    expect(screen.getByTestId("jevc-archive-warning")).toBeTruthy();
  });

  it("stays quiet about recovery when the archive is on", () => {
    renderCard({
      value: { resultShaping: { enabled: true }, archive: { enabled: true } },
    });
    expect(screen.queryByTestId("jevc-shaping-warning")).toBeNull();
    expect(screen.queryByTestId("jevc-archive-warning")).toBeNull();
  });

  it("marks a field the user layer overrides", () => {
    renderCard({ value: { enabled: true }, user: { enabled: true } });
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
    fireEvent.click(screen.getByRole("button", { name: "Remove bash" }));
    expect(ops).toEqual([
      { op: "set", path: ["resultShaping", "includeTools"], value: ["pwsh"] },
    ]);
  });
});
