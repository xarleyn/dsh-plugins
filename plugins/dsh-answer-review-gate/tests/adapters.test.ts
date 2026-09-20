import { describe, expect, it } from "vitest";

import {
  createDomainExpertBackend,
  createSubagentBackend,
} from "../src/adapters/reviewers.js";
import {
  renderExpertReviewTask,
  renderSubagentReviewerTask,
} from "../src/prompt.js";
import { ReviewerFailure } from "../src/types.js";
import type {
  DomainExpertsFace,
  ExpertRunOutcome,
  ReviewInput,
  SubagentsFace,
  SubagentRunHandle,
  SubagentRunResult,
} from "../src/types.js";

function reviewInput(): ReviewInput {
  return {
    sessionId: "session-1",
    turn: 2,
    requestText: "What locks does the runtime use?",
    candidateText: "The runtime uses file locks around journal writes.",
    signal: new AbortController().signal,
  };
}

const EXPERT_CONFIG = {
  backend: "domain-expert" as const,
  domain: "answer-reviewer",
  provider: "spawn",
  model: "",
  route: "",
  reasoningEffort: "",
  persona: "",
  allowedTools: [],
};

const SUBAGENT_CONFIG = {
  ...EXPERT_CONFIG,
  backend: "subagent" as const,
  provider: "spawn",
  model: "review-model",
  route: "review-route",
  reasoningEffort: "high",
  persona: "Be adversarial.",
  allowedTools: ["read"],
};

describe("domain-expert backend", () => {
  it("fails honestly when the domain-experts service is absent", async () => {
    const backend = createDomainExpertBackend({
      face: undefined,
      config: EXPERT_CONFIG,
    });
    await expect(backend.review(reviewInput())).rejects.toMatchObject({
      reason: "domain-experts-unavailable",
    } satisfies Partial<ReviewerFailure>);
  });

  it("passes the stable domain id, the task, and the reviewed session id", async () => {
    const calls: [string, string, string][] = [];
    const face: DomainExpertsFace = {
      async testExpert(domainId, task, parentSessionId) {
        calls.push([domainId, task, parentSessionId]);
        const outcome: ExpertRunOutcome = {
          ok: true,
          code: "",
          message: "",
          result: {
            status: "completed",
            summary: "No objections.",
            findings: [],
            conflicts: [],
          },
        };
        return outcome;
      },
    };
    const backend = createDomainExpertBackend({ face, config: EXPERT_CONFIG });
    const verdict = await backend.review(reviewInput());
    expect(verdict.verdict).toBe("pass");
    expect(calls).toHaveLength(1);
    const [domainId, task, parentSessionId] = calls[0]!;
    expect(domainId).toBe("answer-reviewer");
    expect(parentSessionId).toBe("session-1");
    expect(task).toContain("What locks does the runtime use?");
    expect(task).toContain("file locks");
  });

  it("maps expert findings to a revise verdict and failures to ReviewerFailure", async () => {
    const outcomes: ExpertRunOutcome[] = [
      {
        ok: true,
        code: "",
        message: "",
        result: {
          status: "completed",
          summary: "One objection.",
          findings: [
            { claim: "Default is 512", evidence: [], confidence: "high" },
          ],
          conflicts: [],
        },
      },
      {
        ok: false,
        code: "STORAGE_UNAVAILABLE",
        message: "storage closed",
        result: null,
      },
      {
        ok: true,
        code: "",
        message: "",
        result: { status: "aborted", summary: "", findings: [], conflicts: [] },
      },
    ];
    let index = 0;
    const face: DomainExpertsFace = {
      async testExpert() {
        return outcomes[index++]!;
      },
    };
    const backend = createDomainExpertBackend({ face, config: EXPERT_CONFIG });
    await expect(backend.review(reviewInput())).resolves.toMatchObject({
      verdict: "revise",
    });
    await expect(backend.review(reviewInput())).rejects.toMatchObject({
      reason: "expert-run-failed",
    } satisfies Partial<ReviewerFailure>);
    await expect(backend.review(reviewInput())).rejects.toMatchObject({
      reason: "expert-not-completed",
    } satisfies Partial<ReviewerFailure>);
  });
});

describe("subagent backend", () => {
  it("starts a read-only reviewer child with the verdict schema and disposes it", async () => {
    let disposed = 0;
    const started: unknown[] = [];
    const face: SubagentsFace = {
      async start(provider, request) {
        started.push({ provider, request });
        const handle: SubagentRunHandle = {
          result: Promise.resolve({
            stopReason: "completed",
            output: [],
            structured: { verdict: "pass", summary: "ok", issues: [] },
          } satisfies SubagentRunResult),
          dispose: () => {
            disposed += 1;
          },
        };
        return handle;
      },
    };
    const backend = createSubagentBackend({
      face,
      config: SUBAGENT_CONFIG,
      parent: "parent-agent",
    });
    const verdict = await backend.review(reviewInput());
    expect(verdict.verdict).toBe("pass");
    expect(disposed).toBe(1);
    expect(started).toHaveLength(1);
    const { provider, request } = started[0] as {
      provider: string;
      request: Record<string, unknown>;
    };
    expect(provider).toBe("spawn");
    expect(request["parent"]).toBe("parent-agent");
    expect(request["persona"]).toBe("Be adversarial.");
    expect(request["toolFilter"]).toEqual({ allow: ["read"] });
    expect(request["agentOptions"]).toEqual({
      provider: "review-route",
      model: "review-model",
      reasoningEffort: "high",
    });
    expect(request["outputSchema"]).toBeDefined();
    const prompt = (request["prompt"] as { text: string }[])[0]!.text;
    expect(prompt).toContain("adversarial reviewer");
    expect(prompt).toContain("file locks");
  });

  it("falls back to parsing the fenced verdict from the output text", async () => {
    const face: SubagentsFace = {
      async start() {
        return {
          result: Promise.resolve({
            stopReason: "completed",
            output: [
              {
                type: "text",
                text: '```json\n{"verdict":"revise","summary":"unsupported","issues":[{"severity":"major","category":"unsupported","claim":"x","problem":"y","requiredFix":"z"}]}\n```',
              },
            ],
          } satisfies SubagentRunResult),
          dispose: () => {},
        };
      },
    };
    const backend = createSubagentBackend({
      face,
      config: SUBAGENT_CONFIG,
      parent: "p",
    });
    await expect(backend.review(reviewInput())).resolves.toMatchObject({
      verdict: "revise",
    });
  });

  it("reports non-completed children, crashed starts and malformed verdicts as failures", async () => {
    const failingRun: SubagentsFace = {
      async start() {
        return {
          result: Promise.resolve({
            stopReason: "error",
            output: [],
            diagnostic: "child exploded",
          } satisfies SubagentRunResult),
          dispose: () => {},
        };
      },
    };
    const crashingStart: SubagentsFace = {
      async start() {
        throw new Error('names unknown global tool "write_everything"');
      },
    };
    const malformed: SubagentsFace = {
      async start() {
        return {
          result: Promise.resolve({
            stopReason: "completed",
            output: [{ type: "text", text: "trust me" }],
          } satisfies SubagentRunResult),
          dispose: () => {},
        };
      },
    };
    const missingStructuredButInvalid: SubagentsFace = {
      async start() {
        return {
          result: Promise.resolve({
            stopReason: "completed",
            output: [],
            structured: { verdict: "excellent" },
          } satisfies SubagentRunResult),
          dispose: () => {},
        };
      },
    };

    await expect(
      createSubagentBackend({
        face: failingRun,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "reviewer-error",
    } satisfies Partial<ReviewerFailure>);
    await expect(
      createSubagentBackend({
        face: crashingStart,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "reviewer-start-failed",
    } satisfies Partial<ReviewerFailure>);
    await expect(
      createSubagentBackend({
        face: malformed,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toBeInstanceOf(ReviewerFailure);
    await expect(
      createSubagentBackend({
        face: missingStructuredButInvalid,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "malformed-verdict",
    } satisfies Partial<ReviewerFailure>);
  });
});

describe("reviewer prompts", () => {
  it("carry the adversarial protocol and pass user material through verbatim", () => {
    const subagent = renderSubagentReviewerTask({
      requestText: "Explain PROJ-123 handling.",
      candidateText: "PROJ-123 is handled by the demo policy.",
    });
    const expert = renderExpertReviewTask({
      requestText: null,
      candidateText: "Candidate body.",
    });
    expect(subagent).toContain("adversarial");
    expect(subagent).toContain("PROJ-123");
    expect(subagent).toContain("pass | revise");
    expect(expert).toContain("Adversarial");
    expect(expert).toContain("(the original user request was not recorded)");
  });

  it("tell the reviewer not to loop on a failing tool", () => {
    const subagent = renderSubagentReviewerTask({
      requestText: "Explain PROJ-123 handling.",
      candidateText: "PROJ-123 is handled by the demo policy.",
    });
    const expert = renderExpertReviewTask({
      requestText: null,
      candidateText: "Candidate body.",
    });
    for (const prompt of [subagent, expert]) {
      expect(prompt).toContain("Work the evidence, not the tool in a loop");
      expect(prompt).toContain("never repeat the same call");
      expect(prompt).toContain("Read tools take an explicit path");
    }
  });
});
