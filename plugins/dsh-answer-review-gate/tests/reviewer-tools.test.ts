import { describe, expect, it } from "vitest";

import {
  createSubagentBackend,
  type ReviewerConfig,
} from "../src/adapters/reviewers.js";
import {
  ANSWER_REVIEW_GATE_DEFAULTS,
  resolveAnswerReviewGateConfig,
} from "../src/config.js";
import {
  REVIEWER_FORBIDDEN_TOOLS,
  REVIEWER_READ_ONLY_TOOLS,
  isReviewerToolForbidden,
  restrictReviewerTools,
} from "../src/reviewer-tools.js";
import {
  renderExpertReviewTask,
  renderSubagentReviewerTask,
} from "../src/prompt.js";
import type {
  ReviewInput,
  SubagentActivation,
  SubagentActivationSpec,
  SubagentsFace,
  SubagentRunResult,
} from "../src/types.js";

/**
 * Names that must never reach a reviewer: the destructive tool of the QA
 * catalog that was raised on a stand, the file-writing and shell names the
 * surface's own workspace fence refuses, and the two prefix families standing
 * in for write operations a service ships under names this package cannot
 * enumerate.
 */
const DESTRUCTIVE = [
  "file_delete",
  "write",
  "edit",
  "apply_patch",
  "str_replace_editor",
  "bash",
  "shell",
  "run_code",
  "terminal_run",
  "job_submit",
];

function reviewInput(): ReviewInput {
  return {
    sessionId: "session-1",
    turn: 1,
    requestText: "Create a one-page docx.",
    requestAttachments: [],
    candidateText: "The document is ready.",
    signal: new AbortController().signal,
  };
}

/** A passing reviewer result, for a face that must let the review settle. */
const PASS_RESULT: SubagentRunResult = {
  stopReason: "completed",
  output: [],
  structured: { verdict: "pass", summary: "ok", issues: [] },
};

/** A face that records the specs it was asked to start. */
function capturingFace(
  started: SubagentActivationSpec[],
  results: readonly SubagentRunResult[],
): SubagentsFace {
  return {
    getProvider(name: string) {
      if (name !== "spawn") return undefined;
      return {
        name,
        capabilities: {
          agentOptions: true,
          agentPreset: true,
          outputSchema: true,
          depthLimit: true,
        },
        inheritsParentContext: true,
      };
    },
    async startActivation(spec) {
      started.push(spec);
      const outcome = results[started.length - 1];
      if (outcome === undefined) {
        throw new Error("unscripted review round");
      }
      const activation: SubagentActivation = {
        childId: "child-session",
        result: Promise.resolve(outcome),
        dispose: () => undefined,
      };
      return activation;
    },
  };
}

/**
 * A reviewer sub-config that did not pass through the resolver: the backend
 * must hold the boundary on its own, because it is the call that composes the
 * child. `agentPreset` is deliberately absent — a config that skipped the
 * resolver reaches the backend without the key, and the backend has to read
 * that as "no preset", not refuse the review.
 */
function rawReviewerConfig(allowedTools: readonly string[]): ReviewerConfig {
  return {
    backend: "subagent",
    domain: "answer-reviewer",
    provider: "spawn",
    model: "",
    route: "",
    reasoningEffort: "",
    persona: "",
    allowedTools,
  } as unknown as ReviewerConfig;
}

/** The spec the reviewer child was started by. */
async function startedSpec(
  config: ReturnType<typeof rawReviewerConfig>,
  results: readonly SubagentRunResult[] = [PASS_RESULT],
): Promise<SubagentActivationSpec> {
  const started: SubagentActivationSpec[] = [];
  const backend = createSubagentBackend({
    face: capturingFace(started, results),
    config,
    parent: "parent-agent",
  });
  await backend.review(reviewInput());
  return started[0]!;
}

describe("reviewer tool boundary", () => {
  it("excludes every destructive name it is meant to exclude", () => {
    for (const name of DESTRUCTIVE) {
      expect(isReviewerToolForbidden(name), name).toBe(true);
    }
  });

  it("keeps the read-only default free of anything excluded", () => {
    for (const name of REVIEWER_READ_ONLY_TOOLS) {
      expect(isReviewerToolForbidden(name), name).toBe(false);
    }
    expect(REVIEWER_READ_ONLY_TOOLS.length).toBeGreaterThan(0);
    expect(REVIEWER_FORBIDDEN_TOOLS).toContain("file_delete");
  });

  it("names every read-only default tool as a read or a search", () => {
    // The list is the contract: an entry that neither reads nor searches has
    // no business being the reviewer's default.
    const readOnlyShape = /^(?:read|glob|grep|docs_|view|list|search)/u;
    for (const name of REVIEWER_READ_ONLY_TOOLS) {
      expect(name, name).toMatch(readOnlyShape);
    }
  });

  it("drops excluded names from a requested list and keeps the rest", () => {
    expect(
      restrictReviewerTools([
        "docs_read",
        "file_delete",
        "bash",
        "terminal_run",
      ]),
    ).toEqual(["docs_read"]);
  });

  it("keeps an explicitly empty list empty", () => {
    // "This reviewer edits nothing" is a deployment decision, not an omission;
    // only an unset list means the read-only default.
    expect(restrictReviewerTools([])).toEqual([]);
    expect(
      resolveAnswerReviewGateConfig({ reviewer: { allowedTools: [] } }).reviewer
        .allowedTools,
    ).toEqual([]);
  });

  it("defaults an unset list to the read-only set, not to nothing", () => {
    expect(ANSWER_REVIEW_GATE_DEFAULTS.reviewer.allowedTools).toEqual(
      REVIEWER_READ_ONLY_TOOLS,
    );
    expect(resolveAnswerReviewGateConfig({}).reviewer.allowedTools).toEqual(
      REVIEWER_READ_ONLY_TOOLS,
    );
  });

  it("removes an excluded name a deployment listed, at the config edge", () => {
    const resolved = resolveAnswerReviewGateConfig({
      reviewer: { allowedTools: ["read", "file_delete", "write"] },
    });
    expect(resolved.reviewer.allowedTools).toEqual(["read"]);
  });
});

describe("reviewer child composition (gate branch)", () => {
  it("sends no tool filter in any form: the Host cannot scope a run's tools", async () => {
    // The 0.2.1 start request carries no per-run tool scoping, so a requested
    // list — destructive names included — composes nothing. The request must
    // not pretend otherwise.
    const spec = await startedSpec(
      rawReviewerConfig(["read", "docs_read", "file_delete", "bash"]),
    );
    expect(spec.request).not.toHaveProperty("toolFilter");
    // A config that skipped the resolver (no `agentPreset` key at all) is
    // "no preset", not an unresolvable id.
    expect(spec.request).not.toHaveProperty("agentPreset");
  });

  it("reports the unenforceable boundary once per backend, not per round", async () => {
    // One review with a capture-loss round first: the degrade notice is about
    // the composition, so it is told once for the backend, not per attempt.
    const degradations: [string, string][] = [];
    const started: SubagentActivationSpec[] = [];
    const backend = createSubagentBackend({
      face: capturingFace(started, [
        { stopReason: "error", output: [] },
        PASS_RESULT,
      ]),
      config: rawReviewerConfig([]),
      parent: "parent-agent",
      onDegradation: (code, detail) => degradations.push([code, detail]),
    });
    await expect(backend.review(reviewInput())).resolves.toMatchObject({
      verdict: "pass",
    });
    expect(started).toHaveLength(2);
    expect(started[0]!.request).not.toHaveProperty("toolFilter");
    expect(started[1]!.request).not.toHaveProperty("toolFilter");
    expect(degradations).toEqual([
      ["TOOL_UNFILTERABLE", expect.stringContaining("Agent Preset")],
    ]);
  });

  it("leaves an explicitly empty list unenforced and says so", async () => {
    // The old contract made "empty means no tools" hold by always sending the
    // filter. This one cannot compose it, so the gate's guarantee is the
    // reported limitation plus the Agent Preset the deployment selects.
    const degradations: [string, string][] = [];
    const started: SubagentActivationSpec[] = [];
    const backend = createSubagentBackend({
      face: capturingFace(started, [PASS_RESULT]),
      config: { ...rawReviewerConfig([]), agentPreset: "" },
      parent: "parent-agent",
      onDegradation: (code, detail) => degradations.push([code, detail]),
    });
    await backend.review(reviewInput());
    expect(started[0]!.request).not.toHaveProperty("toolFilter");
    expect(degradations).toEqual([
      ["TOOL_UNFILTERABLE", expect.stringContaining("Agent Preset")],
    ]);
  });

  it("sends no filter for the read-only default either", async () => {
    const spec = await startedSpec(
      rawReviewerConfig([...REVIEWER_READ_ONLY_TOOLS]),
    );
    expect(spec.request).not.toHaveProperty("toolFilter");
  });

  it("sends a configured preset id through to the child request", async () => {
    const started: SubagentActivationSpec[] = [];
    const backend = createSubagentBackend({
      face: capturingFace(started, [PASS_RESULT]),
      config: { ...rawReviewerConfig([]), agentPreset: "reviewer-readonly" },
      parent: "parent-agent",
    });
    await backend.review(reviewInput());
    expect(started[0]!.request.agentPreset).toBe("reviewer-readonly");
  });
});

describe("reviewer prompt boundary (both branches)", () => {
  /**
   * The `domain-expert` branch cannot be filtered from here: `testExpert`
   * carries no tool mask, and a tool the surface attaches to the agent's own
   * layer survives any inherited filter. What the gate can say on that branch
   * is what the reviewer is told, so both texts must carry the boundary.
   */
  const BOUNDARY = "You review and do not change";

  it("tells both reviewer texts to report an obstacle instead of clearing it", () => {
    const input = {
      requestText: "Create a one-page docx.",
      requestAttachments: [],
      candidateText: "The document is ready.",
    };
    expect(renderSubagentReviewerTask(input)).toContain(BOUNDARY);
    expect(renderExpertReviewTask(input)).toContain(BOUNDARY);
  });
});
