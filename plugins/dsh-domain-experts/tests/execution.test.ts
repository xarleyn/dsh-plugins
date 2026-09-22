import { describe, expect, it } from "vitest";
import {
  RunTracker,
  runExpert,
  unrestrictableToolNames,
  type ExecutionDependencies,
} from "../src/host/execution.js";
import { AuditRing } from "../src/host/audit.js";
import { DomainExpertsError } from "../src/host/errors.js";
import { DomainRegistry } from "../src/host/registry.js";
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
  });
}

describe("execution: composition handed to the runtime", () => {
  it("hands the policy to the runtime as the persona and the request as the prompt", async () => {
    const harness = harnessOf();
    await run(harness);
    const started = harness.subagents.started[0];
    expect(started?.provider).toBe("spawn");
    expect(started?.request.label).toBe("domain-expert:payments");
    // The system section is the policy: no task text, and therefore none of
    // whatever the caller embedded in it (for the review gate, a candidate
    // answer) — that material belongs to the child's first message.
    expect(started?.request.persona).toContain("You are the designated expert");
    expect(started?.request.persona).toContain("## Answer format");
    expect(started?.request.persona).not.toContain("## Task");
    expect(started?.request.persona).not.toContain(
      "Investigate the settlement status.",
    );
    expect(started?.request.toolFilter?.allow).toContain("domain_expert");
    expect(started?.request.maxDepth).toBe(3);
    // The child's first message is the caller's request, never the policy
    // document: the persona reaches the child as a system section, and the
    // deployment's instructions must not read as something the user said.
    const promptBlock = started?.request.prompt[0];
    const promptText =
      promptBlock !== undefined && promptBlock.type === "text"
        ? promptBlock.text
        : "";
    expect(promptText).toContain("Investigate the settlement status.");
    expect(promptText).not.toContain("You are the designated expert");
    expect(promptText).not.toContain("## Answer format");
  });

  it("does not send model options when the domain inherits", async () => {
    const harness = harnessOf();
    await run(harness);
    expect(harness.subagents.started[0]?.request.agentOptions).toBeUndefined();
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
  it("starts a continuable child and reports the receipt", async () => {
    const harness = harnessOf(PAYMENTS, { runId: "child-bg" });
    const result = await run(harness, PAYMENTS, { background: true });
    expect(result.status).toBe("delegated");
    expect(result.childSessionId).toBe("child-bg-bg");
    expect(result.summary).toContain("background");
    expect(harness.subagents.started).toEqual([]);
    // A durable child has no settle event, so it stays attributable.
    expect(harness.tracker.find("child-bg-bg")?.background).toBe(true);
  });

  it("refuses a background run when the provider cannot start continuable children", async () => {
    const harness = harnessOf(PAYMENTS, { continuable: false });
    await expect(
      run(harness, PAYMENTS, { background: true }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_SUBAGENT_CAPABILITY",
    });
  });
});

describe("execution: refusals", () => {
  it("refuses a missing provider", async () => {
    const harness = harnessOf(PAYMENTS, { name: "acp" });
    await expect(run(harness)).rejects.toMatchObject({
      code: "SUBAGENT_PROVIDER_MISSING",
    });
  });

  it("refuses a provider that cannot compose a persona", async () => {
    const harness = harnessOf(PAYMENTS, {
      capabilities: {
        agentOptions: true,
        outputSchema: true,
        depthLimit: true,
        toolFilter: true,
        persona: false,
      },
    });
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
        outputSchema: true,
        depthLimit: true,
        toolFilter: true,
        persona: true,
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

  it("re-labels an unknown tool name as a worker problem", async () => {
    const harness = harnessOf(PAYMENTS, {
      failWith: new Error(
        'tools.restrict() names unknown global tool "bash"; known global tools: x',
      ),
    });
    const error = await run(harness).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(DomainExpertsError);
    expect((error as DomainExpertsError).code).toBe("WORKER_UNAVAILABLE");
  });

  it("starts the expert again without the tool names the runtime refused", async () => {
    // A child composes its parent's preset into its own scope, so a name that
    // preset mounts — the filesystem readers, the skill catalog — is exactly
    // what a tool filter may not mention.
    const definition = domainOf("payments", {
      tools: { allow: ["glob", "read"], deny: [] },
    });
    const harness = harnessOf(definition, {
      failOnce: new Error(
        'tools.restrict() names unknown global tools "glob", "read"; known global tools: domain_expert, domain_memory',
      ),
    });
    const result = await run(harness, definition);
    expect(result.status).toBe("completed");
    // The refusal never became a started child; the retry is the one run.
    expect(harness.subagents.started).toHaveLength(1);
    const allow = harness.subagents.started[0]?.request.toolFilter?.allow;
    expect(allow).not.toContain("glob");
    expect(allow).not.toContain("read");
    // The plugin's own tools were never in question and stay in the filter.
    expect(allow).toContain("domain_expert");
    expect(harness.audits.recent()[0]?.degraded).toContain("TOOL_UNFILTERABLE");
  });

  it("reads the refused names out of the runtime's own wording", () => {
    // Verbatim from a deployment whose chat preset mounts the filesystem
    // readers and the skill catalog on the agent plane.
    expect(
      unrestrictableToolNames(
        new Error(
          'tools.restrict() names unknown global tools "glob", "grep", "read", "read_image", "skill"; known global tools: bitrix_find_chat, domain_expert, web_fetch_image',
        ),
      ),
    ).toEqual(["glob", "grep", "read", "read_image", "skill"]);
    expect(
      unrestrictableToolNames(
        new Error(
          'tools.restrict() names unknown global tool "bash"; known global tools: read',
        ),
      ),
    ).toEqual(["bash"]);
    expect(unrestrictableToolNames(new Error("disk on fire"))).toBeUndefined();
  });

  it("does not retry around a name the filter never carried", async () => {
    // The runtime names what it was given, so this cannot happen in practice;
    // the assertion is that a refusal this plugin cannot explain stays loud
    // instead of being retried away.
    const harness = harnessOf(PAYMENTS, {
      failOnce: new Error(
        'tools.restrict() names unknown global tool "bash"; known global tools: x',
      ),
    });
    await expect(run(harness)).rejects.toMatchObject({
      code: "WORKER_UNAVAILABLE",
    });
    expect(harness.subagents.started).toHaveLength(0);
  });

  it("lets an unrelated infrastructure fault through unchanged", async () => {
    const harness = harnessOf(PAYMENTS, {
      failWith: new Error("disk on fire"),
    });
    await expect(run(harness)).rejects.toThrowError("disk on fire");
  });
});
