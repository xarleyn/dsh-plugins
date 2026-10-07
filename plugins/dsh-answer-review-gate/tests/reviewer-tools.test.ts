import { describe, expect, it } from "vitest";

import { createSubagentBackend } from "../src/adapters/reviewers.js";
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

/** The reviewer sub-config the backends consume, resolved from a raw one. */
function reviewerConfig(allowedTools?: readonly string[]) {
  return resolveAnswerReviewGateConfig({
    reviewer: {
      backend: "subagent",
      ...(allowedTools === undefined
        ? {}
        : { allowedTools: [...allowedTools] }),
    },
  }).reviewer;
}

/** A face that records the child it was asked to start. */
function capturingFace(started: Record<string, unknown>[]): SubagentsFace {
  return {
    async start(_provider, request) {
      started.push(request as unknown as Record<string, unknown>);
      return {
        result: Promise.resolve({
          stopReason: "completed",
          output: [],
          structured: { verdict: "pass", summary: "ok", issues: [] },
        } satisfies SubagentRunResult),
        dispose: () => {},
      };
    },
  };
}

/**
 * A reviewer sub-config that did not pass through the resolver: the backend
 * must hold the boundary on its own, because it is the call that composes the
 * child.
 */
function rawReviewerConfig(allowedTools: readonly string[]) {
  return {
    backend: "subagent" as const,
    domain: "answer-reviewer",
    provider: "spawn",
    model: "",
    route: "",
    reasoningEffort: "",
    persona: "",
    allowedTools,
  };
}

/** The tool names the reviewer child is actually composed with. */
async function startedToolFilter(
  config: ReturnType<typeof reviewerConfig>,
): Promise<readonly string[]> {
  const started: Record<string, unknown>[] = [];
  const backend = createSubagentBackend({
    face: capturingFace(started),
    config,
    parent: "parent-agent",
  });
  await backend.review(reviewInput());
  const filter = started[0]!["toolFilter"] as { allow: readonly string[] };
  return filter.allow;
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
  it("composes the child without any destructive tool, even a listed one", async () => {
    const allow = await startedToolFilter(
      rawReviewerConfig(["read", "docs_read", "file_delete", "bash"]),
    );
    expect(allow).toEqual(["read", "docs_read"]);
    for (const name of DESTRUCTIVE) {
      expect(allow, name).not.toContain(name);
    }
  });

  it("still sends the filter when the reviewer is meant to have no tools", async () => {
    // The host only restricts a child when a filter is present; an absent
    // filter hands it the parent's whole surface, destructive tools included.
    const started: Record<string, unknown>[] = [];
    const backend = createSubagentBackend({
      face: capturingFace(started),
      config: reviewerConfig([]),
      parent: "parent-agent",
    });
    await backend.review(reviewInput());
    expect(started[0]!["toolFilter"]).toEqual({ allow: [] });
  });

  it("sends the read-only default when the deployment named nothing", async () => {
    const allow = await startedToolFilter(reviewerConfig());
    expect(allow).toEqual(REVIEWER_READ_ONLY_TOOLS);
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
