import { describe, expect, it } from "vitest";

import { apply, name as pluginName } from "../src/index.js";
import type { GateHostContext } from "../src/index.js";
import type { GateAgent } from "../src/gate.js";
import type {
  DomainExpertsFace,
  ExpertRunOutcome,
  SubagentsFace,
  SubagentRunHandle,
} from "../src/types.js";

interface CapturedEvent {
  readonly event: string;
  readonly handler: (payload: never) => unknown;
}

interface SteerRecord {
  readonly source: {
    readonly kind: string;
    readonly plugin: string;
    readonly form: string;
  };
  readonly text: string;
}

function makeHost(services: Record<string, unknown>) {
  const events: CapturedEvent[] = [];
  const host: GateHostContext = {
    on(event, handler) {
      events.push({ event, handler: handler as (payload: never) => unknown });
      return () => {};
    },
    get: (service) => services[service],
  };
  return { host, events };
}

function dispatch(
  events: readonly CapturedEvent[],
  event: string,
  ...args: unknown[]
): Promise<unknown> {
  const captured = events.find((item) => item.event === event);
  if (captured === undefined) return Promise.resolve(undefined);
  return Promise.resolve(
    (captured.handler as (...p: unknown[]) => unknown)(...args),
  );
}

/** Flatten a steered UserMessage into the fields the assertions read. */
function steerText(message: unknown): string {
  const content = (message as { content: { type: string; text?: string }[] })
    .content;
  return content
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("\n");
}

const EXPERT_PASS: ExpertRunOutcome = {
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

function domainFace(
  outcome: ExpertRunOutcome = EXPERT_PASS,
): DomainExpertsFace {
  return {
    testExpert: () => Promise.resolve(outcome),
  };
}

function agentWithCandidate(sessionId: string, text: string): GateAgent {
  const steers: { source: unknown; text: string }[] = [];
  const agent: GateAgent = {
    id: sessionId,
    session: {
      header: { origin: "user" },
      surface: { nodes: [0, 1] },
      eventAt: (seq: number) =>
        seq === 0
          ? {
              type: "user/message",
              data: {
                source: { kind: "user" },
                content: [{ type: "text", text: "the question" }],
              },
            }
          : {
              type: "assistant/message",
              data: {
                message: { content: [{ type: "text", text }] },
                stream: [],
              },
            },
    } as unknown as GateAgent["session"],
    steer: (message) => {
      steers.push({
        source: (message as { source: unknown }).source,
        text: steerText(message),
      });
    },
  };
  return Object.assign(agent, { steers });
}

async function runWiredGate(options: {
  readonly domainExperts?: DomainExpertsFace;
  readonly subagents?: SubagentsFace;
}) {
  const { host, events } = makeHost({
    // The key the provider registers (`ctx.domainExperts`, pinned by
    // dsh-domain-experts' own wiring test) — not its plugin id.
    domainExperts: options.domainExperts,
    subagents: options.subagents,
  });
  apply(host, {
    reviewer: { backend: "domain-expert" },
    minCandidateChars: 10,
  });
  const agent = agentWithCandidate(
    "session-9",
    "The runtime uses file locks around journal writes.",
  );
  await dispatch(events, "agent/turn-stopping", {
    agent,
    turn: 1,
    signal: new AbortController().signal,
  });
  return {
    events,
    agent,
    steers: (agent as unknown as { steers: SteerRecord[] }).steers,
  };
}

describe("plugin wiring", () => {
  it("registers the lifecycle seams globally", () => {
    const { host, events } = makeHost({});
    apply(host);
    expect(events.map((item) => item.event).sort()).toEqual([
      "agent/disposed",
      "agent/inbox/inserted",
      "agent/turn-stopping",
      "tools/result",
    ]);
  });

  it("registers nothing when disabled", () => {
    const { host, events } = makeHost({});
    apply(host, { enabled: false });
    expect(events).toHaveLength(0);
  });

  it("reviews a candidate through the domain-expert backend and passes on PASS", async () => {
    const { steers } = await runWiredGate({ domainExperts: domainFace() });
    expect(steers).toHaveLength(0);
  });

  it("steers a plugin-sourced notice on REVISE findings", async () => {
    const { steers } = await runWiredGate({
      domainExperts: domainFace({
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
      }),
    });
    expect(steers).toHaveLength(1);
    const steer = steers[0]!;
    expect(steer.source).toMatchObject({
      kind: "plugin",
      plugin: pluginName,
      form: "notice",
    });
    expect(steer.text).toContain("Default is 512");
  });

  it("does not resurrect the plugin-id spelling of the reviewer service", async () => {
    // `domain-experts` is the plugin id and the settings namespace; the service
    // is registered as `domainExperts`. A service published under the kebab
    // spelling must not be treated as the reviewer backend — this is the
    // regression that made every review fail as "service is not loaded" while
    // the plugin ran next to this one.
    const { host, events } = makeHost({ "domain-experts": domainFace() });
    apply(host, {
      reviewer: { backend: "domain-expert" },
      minCandidateChars: 10,
    });
    const agent = agentWithCandidate(
      "session-9",
      "The runtime uses file locks around journal writes.",
    ) as GateAgent & { readonly steers: readonly { readonly text: string }[] };
    await dispatch(events, "agent/turn-stopping", {
      agent,
      turn: 1,
      signal: new AbortController().signal,
    });
    expect(agent.steers.map((steer) => steer.text).join(" ")).toContain(
      "domain-experts-unavailable",
    );
  });

  it("degrades to the failure policy when the backend service is absent", async () => {
    const { steers } = await runWiredGate({});
    expect(steers).toHaveLength(1);
    expect(steers[0]!.text).toContain("domain-experts-unavailable");
    expect(steers[0]!.text).toContain("did not complete");
  });

  it("delegates ownership bookkeeping through the delegation tool results", async () => {
    const calls: [string, string, string][] = [];
    const { host, events } = makeHost({
      domainExperts: {
        testExpert: (
          domainId: string,
          task: string,
          parentSessionId: string,
        ) => {
          calls.push([domainId, task, parentSessionId]);
          return Promise.resolve(EXPERT_PASS);
        },
      } satisfies DomainExpertsFace,
    });
    apply(host, {
      reviewer: { backend: "domain-expert" },
      minCandidateChars: 10,
    });

    dispatch(
      events,
      "tools/result",
      {
        name: "subagent",
        agent: { id: "session-9" },
      },
      { isError: false, value: { kind: "continuable", subagentId: "child-1" } },
    );
    await dispatch(events, "agent/inbox/inserted", {
      agent: { id: "session-9" },
      message: {
        source: {
          kind: "subagent-settled",
          senderSessionId: "child-1",
          summary: "done",
        },
      },
    });

    const agent = agentWithCandidate(
      "session-9",
      "The runtime uses file locks around journal writes.",
    );
    await dispatch(events, "agent/turn-stopping", {
      agent,
      turn: 1,
      signal: new AbortController().signal,
    });
    // The only child settled before the boundary, so the review ran.
    expect(calls).toHaveLength(1);
  });
});

// The subagent face participates only through the config switch; assert that
// a wired subagent backend reaches the face with the reviewed parent.
describe("plugin wiring: subagent backend", () => {
  it("starts the reviewer child against the reviewed agent", async () => {
    const started: unknown[] = [];
    const face: SubagentsFace = {
      start(_provider, request) {
        started.push(request);
        return Promise.resolve({
          result: Promise.resolve({
            stopReason: "completed",
            output: [],
            structured: { verdict: "pass", summary: "ok", issues: [] },
          }),
          dispose: () => {},
        } satisfies SubagentRunHandle);
      },
    };
    const { host, events } = makeHost({ subagents: face });
    apply(host, { reviewer: { backend: "subagent" }, minCandidateChars: 10 });
    const agent = agentWithCandidate(
      "session-9",
      "The runtime uses file locks around journal writes.",
    );
    await dispatch(events, "agent/turn-stopping", {
      agent,
      turn: 1,
      signal: new AbortController().signal,
    });
    expect(started).toHaveLength(1);
  });
});
