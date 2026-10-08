// @vitest-environment jsdom
/**
 * The Safety Gate card: shell contract, configuration controls, the remote
 * classifier disclosure, and the status projection the Remote feeds it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  SAFETY_GATE_ROW_SUMMARY,
  SafetyGateCard,
  SafetyGateEntry,
} from "../src/client/card.js";

/*
 * The row's display copy as the Host reads it, without activating the plugin.
 * Read from the shipped file rather than restated here, and through
 * `fileURLToPath` because the jsdom environment replaces the global `URL` while
 * Node's `readFileSync` only recognises its own.
 */
const rowMeta = (
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "locale/en.json"),
      "utf8",
    ),
  ) as {
    readonly meta: { readonly description: string; readonly title: string };
  }
).meta;

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
    {
      turn: 3,
      step: null,
      direction: "output",
      channel: "text",
      toolName: null,
      decision: "warn",
      categories: ["self_harm"],
      summary: "ideation",
      confidence: 0.62,
      classifierProvider: "local",
      classifierModel: "safety-small",
      classifierRan: true,
      latencyMs: 34,
      contentSha256: "b".repeat(64),
      contentChars: 96,
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
    settingsForm: {
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
  view: "page" | "summary";
  settingsForm: unknown;
  inspect: () => Promise<{ ok: true; value: SafetyGateInspect }>;
}) => ReactElement;

/** The registered entry, which also answers the page's `summary` view. */
const Entry = SafetyGateEntry as unknown as (props: {
  view: "page" | "summary";
  settingsForm: unknown;
  inspect: () => Promise<{ ok: true; value: SafetyGateInspect }>;
}) => ReactElement;

async function renderCard(
  options: {
    snapshot?: Partial<FormSnapshot>;
    mutate?: FormOps;
    inspect?: () => Promise<{ ok: true; value: SafetyGateInspect }>;
  } = {},
) {
  const { settingsForm } = makeForm(options.snapshot, options.mutate);
  const inspect =
    options.inspect ?? (async () => ({ ok: true, value: INSPECT }));
  let result: ReturnType<typeof render> | undefined;
  // The card polls once on mount; awaiting inside act keeps that first update
  // inside the test rather than after it.
  await act(async () => {
    result = render(
      <Card view="page" settingsForm={settingsForm} inspect={inspect} />,
    );
    await Promise.resolve();
  });
  return result as ReturnType<typeof render>;
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
  it("renders the body without a shell of its own, because the page draws the card", async () => {
    const { container } = await renderCard();
    // The Plugins page seats this bundle inside its own row card: the frame, the
    // heading and the expand control are the page's, so the body arrives with no
    // shell class and no chevron of ours (AGENTS.md, the owner's word of 01.10).
    expect(container.querySelector("[class*='dsh-plugin-card']")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Show settings: Model Safety Gate/u,
      }),
    ).toBeNull();
    // Nothing folds the body away, so the live status section is mounted directly —
    // and it, not a header badge, is where the running mode reads.
    expect(screen.getByTestId("safety-section-status")).toBeTruthy();
    expect(container.querySelector(".msg-body")).not.toBeNull();
  });

  it("answers the page's summary view with the sentence, not a second card", async () => {
    const { settingsForm } = makeForm();
    const inspect = vi.fn(async () => ({ ok: true as const, value: INSPECT }));
    let result: ReturnType<typeof render> | undefined;
    await act(async () => {
      result = render(
        <Entry view="summary" settingsForm={settingsForm} inspect={inspect} />,
      );
      await Promise.resolve();
    });
    const container = (result as ReturnType<typeof render>).container;
    // The row's description seat sits inside the page's own text, so it carries
    // no shell and starts no poll of the Remote.
    expect(container.querySelector("li.dsh-plugin-card")).toBeNull();
    expect(container.textContent).toBe(SAFETY_GATE_ROW_SUMMARY);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("describes the row with the sentence the seat falls back to", () => {
    // The page titles and describes this row from `locale/en.json` and prints the
    // entry's own answer only where that file carries no description, so two
    // different sentences here would let the row describe something other than
    // the page it opens.
    expect(rowMeta.title).toBe("Model Safety Gate");
    expect(rowMeta.description).toBe(SAFETY_GATE_ROW_SUMMARY);
  });

  it("explains rather than vanishes when the settings namespace is unavailable", async () => {
    const { container } = await renderCard({
      snapshot: { status: "unavailable", value: undefined },
    });
    // The row's frame is the page's, so an empty return would leave an opened row with
    // no section and no reason — a card that owns its shell may stay invisible, this
    // one owes a sentence.
    expect(container.querySelector("li.dsh-plugin-card")).toBeNull();
    expect(screen.getByTestId("safety-card-unavailable").textContent).toContain(
      "not available in this session",
    );
    expect(screen.queryByTestId("safety-section-status")).toBeNull();
  });

  it("opens into the configuration and status sections", async () => {
    await renderCard();
    for (const [plane, title] of [
      ["status", "Status"],
      ["gate", "Gate"],
      ["input", "Input guard"],
      ["output", "Output stream"],
      ["tools", "Tools and results"],
      ["classifier", "Classifier"],
      ["audit", "Audit"],
      ["verdicts", "Recent verdicts"],
      ["advanced", "Advanced"],
    ] as const) {
      const section = screen.getByTestId(`safety-section-${plane}`);
      // The frame of this plane carries the heading of this plane: the id says
      // which frame is open, the accessible name says what it is called.
      expect(
        within(section).getByRole("heading", {
          level: 3,
          name: new RegExp(title, "u"),
        }),
      ).toBeTruthy();
    }
    await waitFor(() => {
      // The status projection arrives from the Remote after the first poll.
      expect(
        screen.getByText(/Average classifier latency/u).textContent,
      ).toContain("50.0 ms"); // 300 ms over 6 classifier calls
    });
    for (const [group, tile, value] of [
      ["safety-status-counters", "safety-status-checks", "17"],
      ["safety-status-counters", "safety-status-blocks", "2"],
      ["safety-status-counters", "safety-status-warnings", "3"],
      ["safety-status-counters", "safety-status-classifier-requests", "6"],
      ["safety-status-detail-counters", "safety-status-blocked-prompts", "1"],
      ["safety-status-detail-counters", "safety-status-classifier-errors", "1"],
    ] as const) {
      // A tile counts one figure, so it is its own hook: no caption, and no
      // walk through the group, stands between a check and the number.
      const node = within(screen.getByTestId(group)).getByTestId(tile);
      expect(node.querySelector("b")?.textContent).toBe(value);
    }
    // The body belongs to the page's card, which draws its own expand control: the
    // bundle has no show/hide button of its own, open or closed.
    expect(
      screen.queryByRole("button", { name: /Hide settings|Show settings/u }),
    ).toBeNull();
    expect(screen.getByTestId("safety-status-counters")).toBeTruthy();
  });

  it("writes a path-addressed mutation when a control changes", async () => {
    const mutate = vi.fn(() => Promise.resolve(true));
    await renderCard({ mutate });

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
    const notice = screen.getByTestId("safety-classifier-notice-remote");
    expect(notice.textContent).toContain("https://moderator.example/v1");
  });

  it("warns when raw content logging is switched on", async () => {
    await renderCard({
      snapshot: {
        value: { ...CONFIG, audit: { enabled: true, includeRawContent: true } },
      },
    });
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
    const gate = screen.getByTestId("safety-section-gate");
    const enabled = within(gate).getByTestId("safety-gate-enabled");
    expect(within(gate).getByRole("checkbox", { name: /Gate enabled/u })).toBe(
      enabled,
    );
    expect((enabled as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a loading note until the first section arrives", async () => {
    await renderCard({ snapshot: { status: "loading", value: undefined } });
    expect(screen.getByTestId("safety-card-loading")).toBeTruthy();
    expect(screen.queryByTestId("safety-section-verdicts")).toBeNull();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("surfaces recent verdicts with their decision and channel", async () => {
    await renderCard();
    await waitFor(() => {
      expect(screen.queryByTestId("safety-verdicts-table")).not.toBeNull();
    });
    const table = screen.getByTestId("safety-verdicts-table");
    // Every row of the template carries the same id, so a repeated node is read
    // as a collection and each cell is addressed through its own row.
    const rows = within(table).getAllByTestId("safety-verdicts-row");
    expect(rows).toHaveLength(2);
    // The projection is still a table, so assistive tech reads the verdicts.
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    const cell = (testId: string) =>
      rows.map((row) => within(row).getByTestId(testId).textContent);
    expect(cell("safety-verdicts-decision")).toEqual(["block", "warn"]);
    expect(cell("safety-verdicts-channel")).toEqual(["input", "text"]);
    expect(cell("safety-verdicts-categories")).toEqual([
      "prompt_injection",
      "self_harm",
    ]);
  });
});
