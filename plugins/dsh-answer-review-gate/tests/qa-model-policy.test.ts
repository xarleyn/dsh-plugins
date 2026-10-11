import { describe, expect, it } from "vitest";
import { createSubagentBackend } from "../src/adapters/reviewers.js";
import { qaModelPolicy } from "../src/qa-policy.js";
import type {
  ReviewInput,
  SubagentsFace,
  SubagentRunHandle,
  SubagentRunResult,
} from "../src/types.js";

const CONFIG = {
  backend: "subagent" as const,
  domain: "answer-reviewer",
  provider: "spawn",
  model: "",
  route: "",
  reasoningEffort: "",
  persona: "",
  allowedTools: [],
};

function reviewInput(): ReviewInput {
  return {
    sessionId: "session-1",
    turn: 1,
    requestText: "question",
    requestAttachments: [],
    candidateText: "candidate answer",
    signal: new AbortController().signal,
  };
}

describe("the QA model policy behind the reviewer", () => {
  it("reads nothing where there is no surface, no method or no pair", () => {
    expect(qaModelPolicy(undefined, "session-1")).toBeUndefined();
    expect(qaModelPolicy({}, "session-1")).toBeUndefined();
    expect(
      qaModelPolicy({ principalForSession: () => undefined }, "session-1"),
    ).toBeUndefined();
    expect(
      qaModelPolicy({ modelPolicyForSession: () => undefined }, "session-1"),
    ).toBeUndefined();
    expect(
      qaModelPolicy(
        { modelPolicyForSession: () => ({ provider: "", model: "" }) },
        "session-1",
      ),
    ).toBeUndefined();
  });

  it("takes the pair the policy names for this chat", () => {
    const surface = {
      modelPolicyForSession: (sessionId: string) =>
        sessionId === "session-1"
          ? { provider: "local", model: "small", reasoningEffort: "low" }
          : undefined,
    };
    expect(qaModelPolicy(surface, "session-1")).toEqual({
      provider: "local",
      model: "small",
      reasoningEffort: "low",
    });
    expect(qaModelPolicy(surface, "session-2")).toBeUndefined();
  });
});

describe("the reviewer child's model", () => {
  /** The reviewer child, answering with the request it was started by. */
  const face = (
    record: (request: Record<string, unknown>) => void,
  ): SubagentsFace => ({
    async start(_provider, request) {
      record(request as unknown as Record<string, unknown>);
      const handle: SubagentRunHandle = {
        result: Promise.resolve({
          stopReason: "completed",
          output: [],
          structured: { verdict: "pass", summary: "ok", issues: [] },
        } satisfies SubagentRunResult),
        dispose: () => undefined,
      };
      return handle;
    },
  });

  it("follows the policy of the chat when its own configuration names no model", async () => {
    const requests: Record<string, unknown>[] = [];
    const backend = createSubagentBackend({
      face: face((request) => requests.push(request)),
      config: CONFIG,
      parent: "parent-agent",
      modelPolicy: {
        provider: "local",
        model: "small",
        reasoningEffort: "low",
      },
    });
    await backend.review(reviewInput());
    expect(requests[0]?.["agentOptions"]).toEqual({
      provider: "local",
      model: "small",
      reasoningEffort: "low",
    });
    // The audit line names the pair the review actually ran on.
    expect(backend.reviewer).toBe("spawn/local/small");
  });

  it("keeps the pair the deployment pinned for the reviewer", async () => {
    const requests: Record<string, unknown>[] = [];
    const backend = createSubagentBackend({
      face: face((request) => requests.push(request)),
      config: { ...CONFIG, model: "review-model", route: "review-route" },
      parent: "parent-agent",
      modelPolicy: { provider: "local", model: "small" },
    });
    await backend.review(reviewInput());
    expect(requests[0]?.["agentOptions"]).toEqual({
      provider: "review-route",
      model: "review-model",
    });
  });

  it("inherits the parent when neither the configuration nor a policy speaks", async () => {
    const requests: Record<string, unknown>[] = [];
    const backend = createSubagentBackend({
      face: face((request) => requests.push(request)),
      config: CONFIG,
      parent: "parent-agent",
    });
    await backend.review(reviewInput());
    expect(requests[0]?.["agentOptions"]).toBeUndefined();
  });
});
