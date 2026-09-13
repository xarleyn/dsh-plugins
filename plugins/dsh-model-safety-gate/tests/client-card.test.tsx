// @vitest-environment jsdom
/**
 * The Safety Gate card: shell contract, configuration controls, the remote
 * classifier disclosure, and the status projection the Remote feeds it.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import type { ModelSafetyGateConfig } from "../src/config.js";
import type { SafetyGateInspect } from "../src/types.js";
import { SafetyGateCard } from "../src/client/card.js";

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

type ScopeSnapshot = {
  status: "loading" | "ready" | "unavailable";
  value: ModelSafetyGateConfig | undefined;
  base: unknown;
  user: unknown;
  revision: number | undefined;
  writable: boolean;
  mode: "host" | "memory";
};

function makeScope(
  snapshot: Partial<ScopeSnapshot> = {},
  mutate: (ops: unknown) => Promise<void> = () => Promise.resolve(),
) {
  const current: ScopeSnapshot = {
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
    scope: {
      getSnapshot: () => current,
      subscribe: () => () => undefined,
      mutate,
      set: () => Promise.resolve(),
      unset: () => Promise.resolve(),
    },
  };
}

/** The slot runtime props do not exist outside the host; only the face does. */
const Card = SafetyGateCard as unknown as (props: {
  scope: unknown;
  inspect: () => Promise<{ ok: true; value: SafetyGateInspect }>;
}) => ReactElement;

async function renderCard(options: {
  snapshot?: Partial<ScopeSnapshot>;
  mutate?: (ops: unknown) => Promise<void>;
  inspect?: () => Promise<{ ok: true; value: SafetyGateInspect }>;
} = {}) {
  const { scope } = makeScope(options.snapshot, options.mutate);
  const inspect = options.inspect ?? (async () => ({ ok: true, value: INSPECT }));
  let result: ReturnType<typeof render> | undefined;
  // The card polls once on mount; awaiting inside act keeps that first update
  // inside the test rather than after it.
  await act(async () => {
    result = render(<Card scope={scope} inspect={inspect} />);
    await Promise.resolve();
  });
  return result as ReturnType<typeof render>;
}

function openCard(): void {
  fireEvent.click(screen.getByRole("button", { name: /Show settings: Model Safety Gate/u }));
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
    expect(container.querySelector(".dsh-plugin-card__body")).toBeNull();
    expect(screen.getByText("Model Safety Gate")).toBeTruthy();
    expect(container.querySelector(".dsh-plugin-card__badge")?.textContent).toBe("Warn");
    expect(container.querySelector(".dsh-plugin-card__chevron")).not.toBeNull();
  });

  it("renders nothing when the settings namespace is unavailable", async () => {
    const { container } = await renderCard({ snapshot: { status: "unavailable", value: undefined } });
    expect(container.innerHTML).toBe("");
  });

  it("opens into the configuration and status sections", async () => {
    await renderCard();
    openCard();
    for (const title of ["Status", "Gate", "Input guard", "Output stream", "Tools and results", "Classifier", "Audit", "Recent verdicts", "Advanced"]) {
      expect(screen.getByRole("heading", { name: new RegExp(title, "u") })).toBeTruthy();
    }
    await waitFor(() => {
      // The status projection arrives from the Remote after the first poll.
      expect(screen.getByText(/Average classifier latency/u).textContent)
        .toContain("50.0 ms"); // 300 ms over 6 classifier calls
    });
    expect(screen.getByRole("button", { name: /Hide settings/u })).toBeTruthy();
  });

  it("writes a path-addressed mutation when a control changes", async () => {
    const mutate = vi.fn(() => Promise.resolve());
    await renderCard({ mutate });
    openCard();

    const gate = screen.getByRole("heading", { name: /^Gate/u }).closest("section");
    const enabled = within(gate as HTMLElement).getByRole("checkbox", { name: /Gate enabled/u });
    fireEvent.click(enabled);
    expect(mutate).toHaveBeenCalledWith([{ op: "set", path: ["enabled"], value: false }]);
  });

  it("states that the classifier is remote, and where it sends content", async () => {
    await renderCard({
      snapshot: {
        value: {
          ...CONFIG,
          classifier: { ...CONFIG.classifier, backend: "openai-compatible", baseURL: "https://moderator.example/v1" },
        },
      },
    });
    openCard();
    const notice = screen.getByText(/Safety classifier is remote/u).closest(".msg-notice");
    expect(notice?.textContent).toContain("https://moderator.example/v1");
  });

  it("warns when raw content logging is switched on", async () => {
    await renderCard({
      snapshot: { value: { ...CONFIG, audit: { enabled: true, includeRawContent: true } } },
    });
    openCard();
    expect(screen.getByText(/Raw content is on/u)).toBeTruthy();
  });

  it("offers a reset for the fields the user layer overrides", async () => {
    const mutate = vi.fn(() => Promise.resolve());
    await renderCard({ snapshot: { user: { mode: "enforce", output: { mode: "observe" } } }, mutate });
    openCard();

    expect(screen.getAllByText("modified").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Reset 2 overrides/u }));
    expect(mutate).toHaveBeenCalledWith([
      { op: "unset", path: ["mode"] },
      { op: "unset", path: ["output"] },
    ]);
  });

  it("disables the controls while a remote browser cannot write", async () => {
    await renderCard({ snapshot: { writable: false } });
    openCard();
    const gate = screen.getByRole("heading", { name: /^Gate/u }).closest("section");
    const enabled = within(gate as HTMLElement).getByRole("checkbox", { name: /Gate enabled/u });
    expect((enabled as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a loading note until the first section arrives", async () => {
    await renderCard({ snapshot: { status: "loading", value: undefined } });
    openCard();
    expect(screen.getByText(/Loading the Safety Gate configuration/u)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Recent verdicts/u })).toBeNull();
  });

  it("surfaces recent verdicts with their decision and channel", async () => {
    await renderCard();
    openCard();
    await waitFor(() => {
      expect(screen.getByText("prompt_injection")).toBeTruthy();
    });
    expect(screen.getByText("block")).toBeTruthy();
    expect(screen.getByText("input")).toBeTruthy();
  });
});
