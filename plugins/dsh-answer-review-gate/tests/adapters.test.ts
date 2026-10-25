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
  SubagentActivation,
  SubagentActivationSpec,
  SubagentsFace,
  SubagentRunResult,
} from "../src/types.js";

function reviewInput(): ReviewInput {
  return {
    sessionId: "session-1",
    turn: 2,
    requestText: "What locks does the runtime use?",
    requestAttachments: [],
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
  agentPreset: "",
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

/** Every start-time option a provider can honor. */
const FULL_CAPABILITIES = {
  agentOptions: true,
  agentPreset: true,
  outputSchema: true,
  depthLimit: true,
};

/** One provider stand-in for the face's capability preflight. */
function providerOf(
  name: string,
  capabilities: Partial<typeof FULL_CAPABILITIES> = FULL_CAPABILITIES,
) {
  return {
    name,
    capabilities: { ...FULL_CAPABILITIES, ...capabilities },
    inheritsParentContext: true,
  };
}

/** One accepted activation stand-in for the face. */
function activationOf(
  result: SubagentRunResult | Promise<SubagentRunResult>,
  onDispose?: () => void,
): SubagentActivation {
  return {
    childId: "child-session",
    messageId: "m1",
    result: Promise.resolve(result),
    dispose: () => {
      onDispose?.();
    },
  };
}

/** A face that records the specs it was asked to start. */
function recordingFace(
  started: SubagentActivationSpec[],
  results: (SubagentRunResult | Error)[],
  provider = providerOf("spawn"),
): SubagentsFace {
  return {
    getProvider: (name) => (name === provider.name ? provider : undefined),
    async startActivation(spec) {
      started.push(spec);
      const outcome = results.shift();
      if (outcome === undefined) {
        throw new Error("unscripted review round");
      }
      return activationOf(
        outcome instanceof Error ? Promise.reject(outcome) : outcome,
      );
    },
  };
}

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
    const calls: [string, string, string, boolean | undefined][] = [];
    const face: DomainExpertsFace = {
      async testExpert(domainId, task, parentSessionId, structuredOutput) {
        calls.push([domainId, task, parentSessionId, structuredOutput]);
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
    const [domainId, task, parentSessionId, structuredOutput] = calls[0]!;
    expect(structuredOutput).toBe(true);
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

  it("does not launch a reviewer run for a turn already aborted at the boundary", async () => {
    // The domain-experts `testExpert` face owns its run and exposes no abort
    // signal, so the most the gate can honour is the signal's state at entry:
    // an already-cancelled turn must not start a doomed reviewer.
    let calls = 0;
    const face: DomainExpertsFace = {
      async testExpert() {
        calls += 1;
        return {
          ok: true,
          code: "",
          message: "",
          result: {
            status: "completed",
            summary: "No objections.",
            findings: [],
            conflicts: [],
          },
        } satisfies ExpertRunOutcome;
      },
    };
    const controller = new AbortController();
    controller.abort();
    const backend = createDomainExpertBackend({ face, config: EXPERT_CONFIG });
    await expect(
      backend.review({ ...reviewInput(), signal: controller.signal }),
    ).rejects.toMatchObject({
      reason: "reviewer-aborted",
    } satisfies Partial<ReviewerFailure>);
    expect(calls).toBe(0);
  });
});

describe("subagent backend", () => {
  it("starts a foreground reviewer activation with the verdict schema and disposes it", async () => {
    let disposed = 0;
    const started: SubagentActivationSpec[] = [];
    const face: SubagentsFace = {
      getProvider: (name) => providerOf(name),
      async startActivation(spec) {
        started.push(spec);
        return activationOf(
          {
            stopReason: "completed",
            output: [],
            structured: { verdict: "pass", summary: "ok", issues: [] },
          },
          () => {
            disposed += 1;
          },
        );
      },
    };
    const backend = createSubagentBackend({
      face,
      config: SUBAGENT_CONFIG,
      parent: "parent-agent",
    });
    const input = reviewInput();
    const verdict = await backend.review(input);
    expect(verdict.verdict).toBe("pass");
    expect(disposed).toBe(1);
    expect(started).toHaveLength(1);
    const spec = started[0]!;
    // Foreground child: the result belongs to this review, the parent model
    // is not notified.
    expect(spec.delivery).toBe("caller");
    expect(spec.provider).toBe("spawn");
    expect(spec.label).toBe("answer-review");
    expect(spec.signal).toBe(input.signal);
    expect(spec.request.parent).toBe("parent-agent");
    // The 0.2.1 request carries no persona and no tool filter: the persona
    // leads the prompt and tools are scoped by an Agent Preset.
    expect(spec.request).not.toHaveProperty("persona");
    expect(spec.request).not.toHaveProperty("toolFilter");
    expect(spec.request.agentOptions).toEqual({
      provider: "review-route",
      model: "review-model",
      reasoningEffort: "high",
    });
    expect(spec.request.outputSchema).toBeDefined();
    const [persona, task] = spec.request.prompt;
    expect(persona).toEqual({ type: "text", text: "Be adversarial." });
    expect((task as { text: string }).text).toContain("adversarial reviewer");
    expect((task as { text: string }).text).toContain("file locks");
  });

  it("reports the unscoped tool boundary instead of composing a filter", async () => {
    // The 0.2.1 start request cannot scope tools: the Host composes a child's
    // tools from its Agent Preset. The gate must say the configured
    // allow-list composes nothing rather than let it read as enforcement —
    // a reviewer under the parent's whole tool surface is what "empty means
    // no tools" used to prevent.
    const degradations: [string, string][] = [];
    const started: SubagentActivationSpec[] = [];
    const backend = createSubagentBackend({
      face: recordingFace(started, [
        {
          stopReason: "completed",
          output: [],
          structured: { verdict: "pass", summary: "ok", issues: [] },
        },
      ]),
      config: { ...SUBAGENT_CONFIG, allowedTools: [] },
      parent: "p",
      onDegradation: (code, detail) => degradations.push([code, detail]),
    });
    await backend.review(reviewInput());
    expect(started[0]!.request).not.toHaveProperty("toolFilter");
    expect(degradations).toEqual([
      ["TOOL_UNFILTERABLE", expect.stringContaining("Agent Preset")],
    ]);
  });

  it("awaits the asynchronous child disposal before the review settles", async () => {
    // Regression for S08: `dispose()` is a promise on the host, so a
    // fire-and-forget call would resolve the review with the child still up.
    let disposed = false;
    const face: SubagentsFace = {
      getProvider: (name) => providerOf(name),
      async startActivation() {
        return {
          childId: "child-session",
          result: Promise.resolve({
            stopReason: "completed",
            output: [],
            structured: { verdict: "pass", summary: "ok", issues: [] },
          } satisfies SubagentRunResult),
          dispose: async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            disposed = true;
          },
        };
      },
    };
    const backend = createSubagentBackend({
      face,
      config: SUBAGENT_CONFIG,
      parent: "p",
    });
    await backend.review(reviewInput());
    expect(disposed).toBe(true);
  });

  it("refuses a fenced verdict without native capture after bounded recovery", async () => {
    const fencedResult: SubagentRunResult = {
      stopReason: "completed",
      output: [
        {
          type: "text",
          text: '```json\n{"verdict":"revise","summary":"unsupported","issues":[{"severity":"major","category":"unsupported","claim":"x","problem":"y","requiredFix":"z"}]}\n```',
        },
      ],
    };
    const started: SubagentActivationSpec[] = [];
    const face = recordingFace(started, [fencedResult, fencedResult]);
    const backend = createSubagentBackend({
      face,
      config: SUBAGENT_CONFIG,
      parent: "p",
    });
    await expect(backend.review(reviewInput())).rejects.toMatchObject({
      reason: "reviewer-output-not-captured",
    });
    // Both rounds started the same candidate: one bounded recovery.
    expect(started).toHaveLength(2);
  });

  it("reports non-completed children, crashed starts and malformed verdicts as failures", async () => {
    const failingRun: SubagentsFace = {
      getProvider: (name) => providerOf(name),
      async startActivation() {
        return activationOf({
          stopReason: "error",
          output: [],
          diagnostic: "child exploded",
        });
      },
    };
    const crashingStart: SubagentsFace = {
      getProvider: (name) => providerOf(name),
      async startActivation() {
        throw new Error('names unknown global tool "write_everything"');
      },
    };
    const malformed: SubagentsFace = {
      getProvider: (name) => providerOf(name),
      async startActivation() {
        return activationOf({
          stopReason: "completed",
          output: [{ type: "text", text: "trust me" }],
        });
      },
    };
    const missingStructuredButInvalid: SubagentsFace = {
      getProvider: (name) => providerOf(name),
      async startActivation() {
        return activationOf({
          stopReason: "completed",
          output: [],
          structured: { verdict: "excellent" },
        });
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

  it("refuses a result the host could not capture as a reviewer failure", async () => {
    // The 0.2.1 result rejects on capture failure (child-level failures still
    // resolve with a stop reason); that rejection is reviewer infrastructure,
    // never a PASS and never a raw leak into the failure policy.
    const face: SubagentsFace = {
      getProvider: (name) => providerOf(name),
      async startActivation() {
        return activationOf(Promise.reject(new Error("capture lost")));
      },
    };
    await expect(
      createSubagentBackend({
        face,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "reviewer-result-unavailable",
      detail: "capture lost",
    } satisfies Partial<ReviewerFailure>);
  });

  it("refuses an unregistered provider before composing anything", async () => {
    const face: SubagentsFace = {
      getProvider: () => undefined,
      startActivation: async () => {
        throw new Error("must not be called");
      },
    };
    await expect(
      createSubagentBackend({
        face,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "reviewer-provider-missing",
      detail: 'subagent provider "spawn" is not registered',
    } satisfies Partial<ReviewerFailure>);
  });

  it("refuses a provider that cannot capture structured output", async () => {
    const face: SubagentsFace = {
      getProvider: (name) => providerOf(name, { outputSchema: false }),
      startActivation: async () => {
        throw new Error("must not be called");
      },
    };
    await expect(
      createSubagentBackend({
        face,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "reviewer-capability-unsupported",
    } satisfies Partial<ReviewerFailure>);
  });

  it("charges model overrides to the agentOptions capability, inheritance to none", async () => {
    const noOverrides: SubagentsFace = {
      getProvider: (name) =>
        providerOf(name, {
          agentOptions: false,
          agentPreset: false,
        }),
      startActivation: async () => {
        throw new Error("must not be called");
      },
    };
    await expect(
      createSubagentBackend({
        face: noOverrides,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "reviewer-capability-unsupported",
      detail:
        'subagent provider "spawn" cannot apply the reviewer\'s provider/model overrides',
    } satisfies Partial<ReviewerFailure>);
    // An inheriting reviewer asks for no overrides, so the same provider runs it.
    const started: SubagentActivationSpec[] = [];
    const inheriting = createSubagentBackend({
      face: {
        getProvider: (name) => noOverrides.getProvider(name),
        startActivation: (spec) => {
          started.push(spec);
          return Promise.resolve(
            activationOf({
              stopReason: "completed",
              output: [],
              structured: { verdict: "pass", summary: "ok", issues: [] },
            }),
          );
        },
      },
      config: {
        ...SUBAGENT_CONFIG,
        model: "",
        route: "",
        reasoningEffort: "",
        persona: "",
      },
      parent: "p",
    });
    await expect(inheriting.review(reviewInput())).resolves.toMatchObject({
      verdict: "pass",
    });
    expect(started[0]!.request.agentOptions).toBeUndefined();
    expect(started[0]!.request).not.toHaveProperty("agentPreset");
  });

  it("sends the configured agent preset and charges it to the capability", async () => {
    const started: SubagentActivationSpec[] = [];
    const backend = createSubagentBackend({
      face: recordingFace(started, [
        {
          stopReason: "completed",
          output: [],
          structured: { verdict: "pass", summary: "ok", issues: [] },
        },
      ]),
      config: { ...SUBAGENT_CONFIG, agentPreset: "answer-reviewer-readonly" },
      parent: "p",
    });
    await backend.review(reviewInput());
    expect(started[0]!.request.agentPreset).toBe("answer-reviewer-readonly");
    const face: SubagentsFace = {
      getProvider: (name) => providerOf(name, { agentPreset: false }),
      startActivation: async () => {
        throw new Error("must not be called");
      },
    };
    await expect(
      createSubagentBackend({
        face,
        config: { ...SUBAGENT_CONFIG, agentPreset: "answer-reviewer-readonly" },
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "reviewer-capability-unsupported",
    } satisfies Partial<ReviewerFailure>);
  });

  it("re-labels a runtime capability refusal as its own failure", async () => {
    // The runtime refuses an unsupported composition before an activation
    // exists; the original message stays, the reason becomes the gate's own.
    const face: SubagentsFace = {
      getProvider: (name) => providerOf(name),
      async startActivation() {
        throw Object.assign(
          new Error(
            'subagent provider "spawn" does not support the "outputSchema" capability',
          ),
          { code: "UNSUPPORTED_CAPABILITY" },
        );
      },
    };
    await expect(
      createSubagentBackend({
        face,
        config: SUBAGENT_CONFIG,
        parent: "p",
      }).review(reviewInput()),
    ).rejects.toMatchObject({
      reason: "reviewer-capability-unsupported",
      detail:
        'subagent provider "spawn" does not support the "outputSchema" capability',
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
