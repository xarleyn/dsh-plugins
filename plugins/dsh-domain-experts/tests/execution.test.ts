import { describe, expect, it } from "vitest";
import { assertObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import type { SubagentActivationSpec } from "@deepseek-ai/dsh-subagent";
import {
  RunTracker,
  runExpert,
  type ExecutionDependencies,
} from "../src/host/execution.js";
import { AuditRing } from "../src/host/audit.js";
import { DomainRegistry } from "../src/host/registry.js";
import { DEPLOYMENT_MEMORY_OWNER } from "../src/host/resolver.js";
import { createBuiltinMemoryProvider } from "../src/host/memory/builtin.js";
import { MemoryProviderRegistry } from "../src/host/memory/registry.js";
import { ScopeProviderRegistry } from "../src/host/scopes/registry.js";
import { createFilesystemProvider } from "../src/host/scopes/filesystem.js";
import { WorkerRegistry } from "../src/host/workers/registry.js";
import type { DomainDefinition } from "../src/types.js";
import {
  agentOf,
  domainOf,
  domainTableOf,
  fakeSubagents,
  fixedClock,
  memoryRecordTableOf,
  NO_CAPABILITIES,
  recordingLogger,
  type FakeSubagents,
  type RecordedLog,
} from "./helpers/fakes.js";

const REQUEST = {
  task: "Investigate the settlement status.",
  context: "",
  output: "",
  mode: "investigate" as const,
  background: false,
};

const PAYMENTS = domainOf("payments", {
  scope: {
    ...domainOf("payments").scope,
    filesystem: {
      primary: ["services/payments/**"],
      sharedReadOnly: [],
      denied: [],
    },
  },
});

interface Harness {
  readonly dependencies: ExecutionDependencies;
  readonly subagents: FakeSubagents;
  readonly tracker: RunTracker;
  readonly audits: AuditRing;
  readonly log: RecordedLog;
}

function harnessOf(
  definition: DomainDefinition = PAYMENTS,
  options: Parameters<typeof fakeSubagents>[0] = {},
  memory: {
    readonly perUser?: boolean;
    readonly principals?: Record<string, string>;
    /** The model policy of one chat, as the QA surface answers it. */
    readonly modelPolicy?: Record<
      string,
      {
        readonly provider: string;
        readonly model: string;
        readonly reasoningEffort?: string;
      }
    >;
  } = {},
): Harness {
  const clock = fixedClock();
  const subagents = fakeSubagents(options);
  const tracker = new RunTracker();
  const audits = new AuditRing(50);
  const log: RecordedLog = { events: [] };
  const domains = new DomainRegistry(
    domainTableOf([[definition.id, definition]]),
    clock,
  );
  const scopeProviders = new ScopeProviderRegistry();
  scopeProviders.register(createFilesystemProvider());
  const memoryProviders = new MemoryProviderRegistry();
  memoryProviders.register(
    createBuiltinMemoryProvider(memoryRecordTableOf(), clock),
  );
  return {
    subagents,
    tracker,
    audits,
    log,
    dependencies: {
      resolver: {
        domains,
        scopeProviders,
        memoryProviders,
        workers: new WorkerRegistry(),
        memoryProviderId: "builtin",
        recallLimit: 5,
      },
      subagents,
      subagentProvider: "spawn",
      tracker,
      audits,
      logger: recordingLogger(log),
      now: () => 9_000,
      perUserMemory: memory.perUser ?? false,
      principalOf: (sessionId) => memory.principals?.[sessionId],
      modelPolicyOf: (sessionId) => memory.modelPolicy?.[sessionId],
    },
  };
}

async function run(
  harness: Harness,
  definition: DomainDefinition = PAYMENTS,
  options: {
    readonly depth?: number;
    readonly callerDomain?: string | null;
    readonly background?: boolean;
    readonly id?: string;
    readonly structuredOutput?: boolean;
  } = {},
) {
  return await runExpert(harness.dependencies, {
    parent: agentOf({
      id: options.id ?? "session-1",
      cwd: "/repo",
      ...(options.depth === undefined ? {} : { depth: options.depth }),
    }),
    definition,
    request: { ...REQUEST, background: options.background ?? false },
    signal: new AbortController().signal,
    callerDomain: options.callerDomain ?? null,
    ...(options.structuredOutput ? { structuredOutput: true } : {}),
  });
}

/** The `text` payload of one block of the child's first message. */
function textBlockOf(spec: SubagentActivationSpec, index: number): string {
  const block = spec.request.prompt[index];
  return block !== undefined && block.type === "text" ? block.text : "";
}

describe("execution: composition handed to the runtime", () => {
  it("uses validated native capture rather than malformed prose for a structured review", async () => {
    const result = {
      summary: 'Verified the "quoted" requirement',
      findings: [],
      conflicts: [],
      assumptions: [],
      followUps: [],
    };
    const harness = harnessOf(PAYMENTS, {
      text: 'Invalid "JSON" prose',
      structured: result,
    });
    const outcome = await run(harness, PAYMENTS, { structuredOutput: true });
    const request = harness.subagents.started[0]!.request;
    expect(request.outputSchema).toMatchObject({
      type: "object",
      required: [
        "summary",
        "findings",
        "conflicts",
        "assumptions",
        "followUps",
      ],
    });
    expect(() => assertObjectJsonSchema(request.outputSchema)).not.toThrow();
    const policy = textBlockOf(harness.subagents.started[0]!, 0);
    expect(policy).toContain(
      "Finish by calling structured_output exactly once",
    );
    expect(policy).not.toContain("Finish with one fenced code block");
    expect(policy).toContain("confirmed user decisions only in summary");
    expect(outcome.structured).toBe(true);
    expect(outcome.summary).toBe(result.summary);
  });

  it("does not accept a prose PASS when structured capture was required", async () => {
    const harness = harnessOf(PAYMENTS, {
      text: '{"summary":"PASS","findings":[]}',
    });
    const outcome = await run(harness, PAYMENTS, { structuredOutput: true });
    expect(outcome.structured).toBe(false);
  });

  it("refuses a structured review on a provider without schema capture", async () => {
    const harness = harnessOf(PAYMENTS);
    const provider = harness.dependencies.subagents.getProvider("spawn")!;
    harness.dependencies.subagents.getProvider = () => ({
      ...provider,
      capabilities: { ...provider.capabilities, outputSchema: false },
    });
    await expect(
      run(harness, PAYMENTS, { structuredOutput: true }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_SUBAGENT_CAPABILITY" });
    expect(harness.subagents.started).toHaveLength(0);
  });

  it("hands the policy and the task to the runtime as the child's first message", async () => {
    const harness = harnessOf();
    await run(harness);
    const spec = harness.subagents.started[0]!;
    expect(spec.provider).toBe("spawn");
    expect(spec.label).toBe("domain-expert:payments");
    // The start contract carries no per-child persona any more, so the
    // composed policy leads the first message and the caller's request
    // follows it as its own block: a candidate answer — anything the caller
    // embedded in the task — still cannot read as deployment instruction.
    const policy = textBlockOf(spec, 0);
    expect(policy).toContain("You are the designated expert");
    expect(policy).toContain("## Answer format");
    expect(policy).toContain("Finish with one fenced code block");
    expect(policy).not.toContain("## Task");
    expect(policy).not.toContain("Investigate the settlement status.");
    const task = textBlockOf(spec, 1);
    expect(task).toContain("Investigate the settlement status.");
    expect(task).not.toContain("You are the designated expert");
    expect(task).not.toContain("## Answer format");
    // The Host scopes no child's tools per run; nothing of the filter and no
    // persona field travels with the request.
    expect("toolFilter" in spec.request).toBe(false);
    expect("persona" in spec.request).toBe(false);
    expect(spec.request.maxDepth).toBe(3);
    // A foreground run answers through this tool result, so the parent model
    // must not be notified.
    expect(spec.delivery).toBe("caller");
  });

  it("does not send model options when the domain inherits", async () => {
    const harness = harnessOf();
    await run(harness);
    expect(harness.subagents.started[0]?.request.agentOptions).toBeUndefined();
  });

  // A domain that inherits its model used to inherit the model the visitor left
  // in the picker. The deployment's policy is the operator's answer, so an
  // expert delegated from a chat whose role names a pair runs on that pair.
  it("sends the pair the chat's model policy pins when the domain inherits", async () => {
    const harness = harnessOf(
      PAYMENTS,
      {},
      {
        modelPolicy: {
          "session-1": {
            provider: "local",
            model: "small",
            reasoningEffort: "low",
          },
        },
      },
    );
    await run(harness);
    expect(harness.subagents.started[0]?.request.agentOptions).toEqual({
      provider: "local",
      model: "small",
      reasoningEffort: "low",
    });
  });

  it("refuses a policy-pinned model on a provider without agent options", async () => {
    const harness = harnessOf(
      PAYMENTS,
      {
        capabilities: {
          agentOptions: false,
          agentPreset: true,
          outputSchema: true,
          depthLimit: true,
        },
      },
      { modelPolicy: { "session-1": { provider: "local", model: "small" } } },
    );
    await expect(run(harness)).rejects.toMatchObject({
      code: "UNSUPPORTED_SUBAGENT_CAPABILITY",
    });
    expect(harness.subagents.started).toEqual([]);
  });

  it("sends model options when the domain pins a route", async () => {
    const pinned = domainOf("payments", {
      ...PAYMENTS,
      model: {
        inherit: false,
        provider: "deepseek",
        model: "chat",
        reasoningEffort: "high",
        maxTokens: 4096,
      },
    });
    const harness = harnessOf(pinned);
    await run(harness, pinned);
    expect(harness.subagents.started[0]?.request.agentOptions).toEqual({
      provider: "deepseek",
      model: "chat",
      reasoningEffort: "high",
      maxTokens: 4096,
    });
  });
});

describe("execution: results and bookkeeping", () => {
  it("returns the parsed answer and a completed status", async () => {
    const harness = harnessOf(PAYMENTS, {
      text: '```domain-expert-result\n{"summary":"stale batch","findings":[{"claim":"aborts"}]}\n```',
    });
    const result = await run(harness);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("stale batch");
    expect(result.findings[0]?.claim).toBe("aborts");
    expect(result.structured).toBe(true);
    expect(result.domainId).toBe("payments");
    expect(result.durationMs).toBe(0);
  });

  it("releases the run from the tracker and disposes the child", async () => {
    const harness = harnessOf(PAYMENTS, { runId: "child-1" });
    await run(harness);
    expect(harness.tracker.size).toBe(0);
    expect(harness.subagents.disposed).toEqual(["child-1"]);
  });

  it("records one audit entry without any task text", async () => {
    const harness = harnessOf();
    await run(harness);
    const entries = harness.audits.recent();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      domainId: "payments",
      callerDomain: null,
      callerSessionId: "session-1",
      status: "completed",
      delegatePath: ["payments"],
      mode: "investigate",
      background: false,
    });
    expect(JSON.stringify(entries[0])).not.toContain("settlement status");
    expect(harness.log.events.map((event) => event.event)).toContain(
      "domain-expert/run",
    );
  });

  it("extends the delegation path for a delegated run", async () => {
    const harness = harnessOf();
    harness.tracker.register({
      domainId: "payments",
      childSessionId: "session-1",
      callerSessionId: "root-session",
      callerDomain: null,
      path: ["payments"],
      depth: 1,
      background: false,
      maxParallel: 3,
      memoryOwner: DEPLOYMENT_MEMORY_OWNER,
    });
    const target = domainOf("inventory");
    await run(harness, target, { callerDomain: "payments", depth: 1 });
    expect(harness.audits.recent()[0]?.delegatePath).toEqual([
      "payments",
      "inventory",
    ]);
    expect(harness.log.events.map((event) => event.event)).toContain(
      "domain-expert/delegation",
    );
  });

  it("maps a stop reason onto the result status", async () => {
    const harness = harnessOf(PAYMENTS, { stopReason: "max-tokens" });
    const result = await run(harness);
    expect(result.status).toBe("max-tokens");
  });

  it("turns a child failure into an error result rather than a throw", async () => {
    const harness = harnessOf(PAYMENTS, {
      stopReason: "error",
      diagnostic: "provider exploded",
      text: "",
    });
    const result = await run(harness);
    expect(result.status).toBe("error");
    expect(result.diagnostic).toBe("provider exploded");
    expect(harness.audits.recent()[0]?.status).toBe("error");
  });
});

describe("execution: background runs", () => {
  it("starts a background child and reports the receipt", async () => {
    const harness = harnessOf(PAYMENTS, { runId: "child-bg" });
    const result = await run(harness, PAYMENTS, { background: true });
    expect(result.status).toBe("delegated");
    expect(result.childSessionId).toBe("child-bg");
    expect(result.summary).toContain("background");
    expect(harness.subagents.started).toHaveLength(1);
    // A background run hands the completion notice to the parent's model.
    expect(harness.subagents.started[0]?.delivery).toBe("parent");
    expect(harness.subagents.started[0]?.request.maxDepth).toBe(3);
    // A durable child has no settle event, so it stays attributable.
    expect(harness.tracker.find("child-bg")?.background).toBe(true);
  });

  it("changes only the delivery between a foreground and a background run", async () => {
    const harness = harnessOf(PAYMENTS);
    await run(harness);
    await run(harness, PAYMENTS, { background: true });
    const [foreground, background] = harness.subagents.started;
    expect(foreground?.delivery).toBe("caller");
    expect(background?.delivery).toBe("parent");
    expect(background?.request).toEqual(foreground?.request);
    expect(background?.label).toBe(foreground?.label);
    expect(background?.provider).toBe(foreground?.provider);
  });
});

describe("execution: refusals", () => {
  it("refuses a missing provider", async () => {
    const harness = harnessOf(PAYMENTS, { name: "acp" });
    await expect(run(harness)).rejects.toMatchObject({
      code: "SUBAGENT_PROVIDER_MISSING",
    });
  });

  it("refuses a provider that cannot enforce a depth cap", async () => {
    const harness = harnessOf(PAYMENTS, { capabilities: NO_CAPABILITIES });
    await expect(run(harness)).rejects.toMatchObject({
      code: "UNSUPPORTED_SUBAGENT_CAPABILITY",
    });
    expect(harness.subagents.started).toEqual([]);
  });

  it("refuses a pinned model on a provider without agent options", async () => {
    const pinned = domainOf("payments", {
      ...PAYMENTS,
      model: {
        inherit: false,
        provider: "deepseek",
        model: "chat",
        reasoningEffort: "",
        maxTokens: 0,
      },
    });
    const harness = harnessOf(pinned, {
      capabilities: {
        agentOptions: false,
        agentPreset: true,
        outputSchema: true,
        depthLimit: true,
      },
    });
    await expect(run(harness, pinned)).rejects.toMatchObject({
      code: "UNSUPPORTED_SUBAGENT_CAPABILITY",
    });
  });

  it("refuses a run beyond the domain's depth cap", async () => {
    const shallow = domainOf("payments", {
      ...PAYMENTS,
      delegation: { ...PAYMENTS.delegation, maxDepth: 1 },
    });
    const harness = harnessOf(shallow);
    await expect(run(harness, shallow, { depth: 1 })).rejects.toMatchObject({
      code: "DELEGATION_DEPTH_EXCEEDED",
    });
    expect(harness.subagents.started).toEqual([]);
  });

  it("re-labels the runtime's unsupported-capability refusal", async () => {
    const harness = harnessOf(PAYMENTS, {
      failWith: Object.assign(new Error("provider rejected the composition"), {
        code: "UNSUPPORTED_CAPABILITY",
      }),
    });
    await expect(run(harness)).rejects.toMatchObject({
      code: "UNSUPPORTED_SUBAGENT_CAPABILITY",
    });
  });

  it("lets an unrelated infrastructure fault through unchanged", async () => {
    const harness = harnessOf(PAYMENTS, {
      failWith: new Error("disk on fire"),
    });
    await expect(run(harness)).rejects.toThrowError("disk on fire");
  });
});

describe("execution: the tool policy the runtime no longer scopes", () => {
  it("starts with the parent's composition and reports a configured policy as degraded", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["read", "glob"], deny: ["shell"] },
    });
    const harness = harnessOf(definition);
    const result = await run(harness, definition);
    // The start request carries no filter at all: the Host scopes no child's
    // tools per run.
    expect(harness.subagents.started).toHaveLength(1);
    expect("toolFilter" in harness.subagents.started[0]!.request).toBe(false);
    expect(result.status).toBe("completed");
    expect(harness.audits.recent()[0]?.degraded).toContain("TOOL_UNFILTERABLE");
  });

  it("does not degrade a domain that configures no tool policy", async () => {
    const harness = harnessOf();
    await run(harness);
    expect(harness.audits.recent()[0]?.degraded ?? []).not.toContain(
      "TOOL_UNFILTERABLE",
    );
  });
});

describe("execution: whose memory a run gets", () => {
  it("hands an attributed caller's account namespace to the child", async () => {
    const harness = harnessOf(
      PAYMENTS,
      {},
      {
        perUser: true,
        principals: { "session-1": "user-a" },
      },
    );
    await run(harness);
    const policy = textBlockOf(harness.subagents.started[0]!, 0);
    expect(policy).toContain("- domain/payments/u/user-a (read/write)");
    expect(policy).toContain("- domain/payments (read-only)");
  });

  it("keeps the domain namespace writable without account scoping", async () => {
    const harness = harnessOf(
      PAYMENTS,
      {},
      {
        perUser: false,
        principals: { "session-1": "user-a" },
      },
    );
    await run(harness);
    const policy = textBlockOf(harness.subagents.started[0]!, 0);
    expect(policy).toContain("- domain/payments (read/write)");
    expect(policy).not.toContain("/u/user-a");
  });

  it("inherits the account through a delegated run whose session nobody attested", async () => {
    const harness = harnessOf(PAYMENTS, {}, { perUser: true });
    harness.tracker.register({
      domainId: "payments",
      childSessionId: "session-1",
      callerSessionId: "root-session",
      callerDomain: null,
      path: ["payments"],
      depth: 1,
      background: false,
      maxParallel: 3,
      memoryOwner: { mode: "per-user", userId: "user-a" },
    });
    await run(harness, PAYMENTS, { background: true, id: "session-1" });
    const child = harness.tracker.find("child-session");
    expect(child?.memoryOwner).toEqual({ mode: "per-user", userId: "user-a" });
  });
});
