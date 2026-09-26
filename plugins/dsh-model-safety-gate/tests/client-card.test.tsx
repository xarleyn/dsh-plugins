// @vitest-environment jsdom
/**
 * The Safety Gate card: shell contract, configuration controls, the remote
 * classifier disclosure, and the status projection the Remote feeds it.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import type {
  ConfigForm,
  ConfigFormSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ModelSafetyGateConfig } from "../src/config.js";
import type { SafetyGateInspect } from "../src/types.js";
import { SafetyGateCard } from "../src/client/card.js";

/** The form's atomic write, as the card calls it. */
type FormOps = ConfigForm<ModelSafetyGateConfig>["mutate"];

const CONFIG: ModelSafetyGateConfig = {
  enabled: true,
  mode: "warn",
  classifier: {
    backend: "none",
    provider: "",
    model: "",
    baseURL: "",
    apiKey: "",
    timeoutMs: 3_000,
    maxTokens: 128,
    temperature: 0,
    failureMode: "rules-only",
    requireLocal: false,
  },
  input: { enabled: true, safetyAction: "block", qualityAction: "warn" },
  output: {
    enabled: true,
    mode: "buffered",
    text: true,
    reasoning: true,
    checkEveryChars: 512,
    windowChars: 1_536,
    lookbehindChars: 768,
    minCheckIntervalMs: 250,
    maxBufferedChars: 8_192,
  },
  tools: { enabled: true, semanticClassifier: true, sensitiveTools: [] },
  toolResults: { enabled: true, classifyUntrustedSources: true },
  audit: { enabled: true, includeRawContent: false },
  ui: { enabled: true, showWarnings: true },
  allowSessionOverride: true,
  maxScanChars: 65_536,
  customBlockPatterns: [],
};

const INSPECT: SafetyGateInspect = {
  enabled: true,
  mode: "warn",
  config: { ...CONFIG, mode: "warn" } as SafetyGateInspect["config"],
  classifier: {
    backend: "none",
    remote: false,
    endpoint: "",
    active: false,
    reason: null,
    apiKeyConfigured: false,
  },
  configRejected: null,
  metrics: {
    checks: { input: 4, text: 9, reasoning: 1, tool: 2, "tool-result": 1 },
    blocks: { input: 1, output: 0, reasoning: 0, tools: 1, "tool-results": 0 },
    warns: 3,
    classifierRequests: 6,
    classifierErrors: 1,
    classifierInputTokens: 120,
    classifierOutputTokens: 30,
    classifierLatencyTotalMs: 300,
    classifierLatencyMaxMs: 210,
    bufferOverflows: 0,
    mainOutputCharsQuarantined: 0,
    estimatedMainTokensPrevented: 12,
  },
  audit: [
    {
      turn: 2,
      step: 1,
      direction: "input",
      channel: "input",
      toolName: null,
      decision: "block",
      categories: ["prompt_injection"],
      summary: "injection",
      confidence: 0.97,
      classifierProvider: "local",
      classifierModel: "safety-small",
      classifierRan: true,
      latencyMs: 81,
      contentSha256: "a".repeat(64),
      contentChars: 42,
      errorCode: null,
      rawContent: null,
      policyVersion: "1",
    },
  ],
  startedAt: Date.now() - 65_000,
};

type FormSnapshot = ConfigFormSnapshot<ModelSafetyGateConfig>;

/** The configuration form the slot injects as the card's write path. */
function makeForm(
  snapshot: Partial<FormSnapshot> = {},
  mutate: FormOps = () => Promise.resolve(true),
) {
  const current: FormSnapshot = {
    status: "ready",
    value: CONFIG,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: "host",
    ...snapshot,
  };
  return {
    form: {
      getSnapshot: () => current,
      subscribe: () => () => undefined,
      mutate,
      set: () => Promise.resolve(true),
      unset: () => Promise.resolve(true),
    },
  };
}

/** The slot runtime props do not exist outside the host; only the face does. */
const Card = SafetyGateCard as unknown as (props: {
  form: unknown;
  inspect: () => Promise<{ ok: true; value: SafetyGateInspect }>;
}) => ReactElement;

async function renderCard(
  options: {
    snapshot?: Partial<FormSnapshot>;
    mutate?: FormOps;
    inspect?: () => Promise<{ ok: true; value: SafetyGateInspect }>;
  } = {},
) {
  const { form } = makeForm(options.snapshot, options.mutate);
  const inspect =
    options.inspect ?? (async () => ({ ok: true, value: INSPECT }));
  let result: ReturnType<typeof render> | undefined;
  // The card polls once on mount; awaiting inside act keeps that first update
  // inside the test rather than after it.
  await act(async () => {
    result = render(<Card form={form} inspect={inspect} />);
    await Promise.resolve();
  });
  return result as ReturnType<typeof render>;
}

function openCard(): void {
  fireEvent.click(
    screen.getByRole("button", { name: /Show settings: Model Safety Gate/u }),
  );
}

afterEach(async () => {
  // The status poll settles after the assertions; flush it inside act so the
  // update is not reported as an unwrapped state change.
  await act(async () => {
    await Promise.resolve();
  });
  cleanup();
});

describe("Safety Gate card", () => {
  it("renders the canonical shell closed with the running mode as its badge", async () => {
    const { container } = await renderCard();
    const card = container.querySelector("li.dsh-plugin-card");
    expect(card).not.toBeNull();
    // A Plugins tab owns its page, so the shell's `li` keeps a list of ours.
    expect(card?.parentElement?.tagName).toBe("UL");
    expect(card?.parentElement?.className).toBe("msg-card-list");
    expect(container.querySelector(".dsh-plugin-card__body")).toBeNull();
    expect(screen.getByText("Model Safety Gate")).toBeTruthy();
    const badge = screen.getByTestId("safety-card-badge");
    // The shell contract still holds: the badge is the host's own element.
    expect(container.querySelector(".dsh-plugin-card__badge")).toBe(badge);
    expect(badge.textContent).toBe("Warn");
    expect(container.querySelector(".dsh-plugin-card__chevron")).not.toBeNull();
  });

  it("renders nothing when the settings namespace is unavailable", async () => {
    const { container } = await renderCard({
      snapshot: { status: "unavailable", value: undefined },
    });
    expect(container.innerHTML).toBe("");
  });

  it("opens into the configuration and status sections", async () => {
    await renderCard();
    openCard();
    for (const plane of [
      "status",
      "gate",
      "input",
      "output",
      "tools",
      "classifier",
      "audit",
      "verdicts",
      "advanced",
    ]) {
      const section = screen.getByTestId(`safety-section-${plane}`);
      // Every frame keeps its own heading, so the plane stays reachable by role.
      expect(within(section).getByRole("heading", { level: 3 })).toBeTruthy();
    }
    await waitFor(() => {
      // The status projection arrives from the Remote after the first poll.
      expect(
        screen.getByText(/Average classifier latency/u).textContent,
      ).toContain("50.0 ms"); // 300 ms over 6 classifier calls
    });
    expect(screen.getByRole("button", { name: /Hide settings/u })).toBeTruthy();
  });

  it("writes a path-addressed mutation when a control changes", async () => {
    const mutate = vi.fn(() => Promise.resolve(true));
    await renderCard({ mutate });
    openCard();

    const gate = screen.getByTestId("safety-section-gate");
    const enabled = within(gate).getByTestId("safety-gate-enabled");
    // The switch is still a checkbox reachable by its accessible name.
    expect(within(gate).getByRole("checkbox", { name: /Gate enabled/u })).toBe(
      enabled,
    );
    fireEvent.click(enabled);
    // The revision the card read fences the write, so an edit that raced this
    // surface is refused instead of silently overwritten.
    expect(mutate).toHaveBeenCalledWith(
      [{ op: "set", path: ["enabled"], value: false }],
      1,
    );
  });

  it("says which configuration the running gate refused to apply", async () => {
    await renderCard({
      inspect: async () => ({
        ok: true,
        value: {
          ...INSPECT,
          configRejected: `config "mode" is unknown`,
        },
      }),
    });
    openCard();
    expect(
      screen.getByTestId("safety-card-config-rejected").textContent,
    ).toContain("is unknown");
  });

  it("states that the classifier is remote, and where it sends content", async () => {
    await renderCard({
      snapshot: {
        value: {
          ...CONFIG,
          classifier: {
            ...CONFIG.classifier,
            backend: "openai-compatible",
            baseURL: "https://moderator.example/v1",
          },
        },
      },
    });
    openCard();
    const notice = screen.getByTestId("safety-classifier-notice-remote");
    expect(notice.textContent).toContain("https://moderator.example/v1");
  });

  it("warns when raw content logging is switched on", async () => {
    await renderCard({
      snapshot: {
        value: { ...CONFIG, audit: { enabled: true, includeRawContent: true } },
      },
    });
    openCard();
    expect(
      screen.getByTestId("safety-audit-notice-raw-content").textContent,
    ).toContain("Raw content is on.");
  });

  it("offers a reset for the fields the user layer overrides", async () => {
    const mutate = vi.fn(() => Promise.resolve(true));
    await renderCard({
      snapshot: { user: { mode: "enforce", output: { mode: "observe" } } },
      mutate,
    });
    openCard();

    expect(screen.getByTestId("safety-section-gate-modified")).toBeTruthy();
    expect(screen.getByTestId("safety-section-output-modified")).toBeTruthy();
    const reset = screen.getByTestId("safety-card-reset-overrides");
    // The button still announces the number of overrides it clears.
    expect(screen.getByRole("button", { name: "Reset 2 overrides" })).toBe(
      reset,
    );
    fireEvent.click(reset);
    expect(mutate).toHaveBeenCalledWith(
      [
        { op: "unset", path: ["mode"] },
        { op: "unset", path: ["output"] },
      ],
      1,
    );
  });

  it("disables the controls while a remote browser cannot write", async () => {
    await renderCard({ snapshot: { writable: false } });
    openCard();
    const gate = screen.getByTestId("safety-section-gate");
    const enabled = within(gate).getByTestId("safety-gate-enabled");
    expect(within(gate).getByRole("checkbox", { name: /Gate enabled/u })).toBe(
      enabled,
    );
    expect((enabled as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a loading note until the first section arrives", async () => {
    await renderCard({ snapshot: { status: "loading", value: undefined } });
    openCard();
    expect(screen.getByTestId("safety-card-loading")).toBeTruthy();
    expect(screen.queryByTestId("safety-section-verdicts")).toBeNull();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("surfaces recent verdicts with their decision and channel", async () => {
    await renderCard();
    openCard();
    await waitFor(() => {
      expect(screen.queryByTestId("safety-verdicts-table")).not.toBeNull();
    });
    const table = screen.getByTestId("safety-verdicts-table");
    const row = within(table).getByTestId("safety-verdicts-row");
    // The projection is still a table, so assistive tech reads the verdicts.
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(
      within(row).getByTestId("safety-verdicts-decision").textContent,
    ).toContain("block");
    expect(within(row).getByTestId("safety-verdicts-channel").textContent).toBe(
      "input",
    );
    expect(
      within(row).getByTestId("safety-verdicts-categories").textContent,
    ).toBe("prompt_injection");
  });
});
