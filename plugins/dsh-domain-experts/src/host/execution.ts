import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  ContinuableStart,
  ContinuableStartSpec,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
} from "@deepseek-ai/dsh-subagent";
import type {
  DomainDefinition,
  DomainExpertRequest,
  DomainExpertResult,
  DomainExpertStatus,
  ExpertAuditEntry,
} from "../types.js";
import type { AuditRing } from "./audit.js";
import {
  DomainExpertsError,
  SUBAGENT_UNSUPPORTED_CODE,
  unsupportedCapability,
} from "./errors.js";
import { resolveExpert, type ResolverDependencies } from "./resolver.js";
import { parseExpertAnswer, textOfBlocks } from "./result.js";

/** The subagent surface this plugin consumes from the host context. */
export interface SubagentsFace {
  getProvider(name: string): SubagentProvider | undefined;
  start(name: string, request: SubagentStartRequest): Promise<SubagentRun>;
  startContinuable?(spec: ContinuableStartSpec): Promise<ContinuableStart>;
}

/** Minimal logger surface; `PluginLogger` satisfies it structurally. */
export interface LogSink {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
}

/** One expert child currently running in this process. */
export interface ActiveRun {
  readonly domainId: string;
  readonly childSessionId: string;
  readonly callerSessionId: string;
  readonly callerDomain: string | null;
  /** Domain chain that produced this run, outermost first. */
  readonly path: readonly string[];
  readonly depth: number;
  readonly background: boolean;
  /** Parallel budget the caller's own configuration allows. */
  readonly maxParallel: number;
}

/**
 * Session id -> the expert run it belongs to.
 *
 * `domain_delegate` needs to know which domain its own child belongs to, and
 * the runtime exposes no domain marker on a session. The coordinator
 * therefore records the mapping when it starts a run. It is process-local by
 * design: a continuable child resumed after a restart is no longer
 * attributable, and delegation from it fails loudly with EXPERT_NOT_CALLER
 * instead of guessing.
 */
export class RunTracker {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly limit: number;

  constructor(limit = 512) {
    this.limit = Math.max(1, Math.trunc(limit));
  }

  register(run: ActiveRun): void {
    this.runs.delete(run.childSessionId);
    this.runs.set(run.childSessionId, run);
    while (this.runs.size > this.limit) {
      const oldest = this.runs.keys().next();
      if (oldest.done === true) break;
      this.runs.delete(oldest.value);
    }
  }

  release(childSessionId: string): void {
    this.runs.delete(childSessionId);
  }

  find(sessionId: string): ActiveRun | undefined {
    return this.runs.get(sessionId);
  }

  /** Expert children a given caller session currently has in flight. */
  countForCaller(callerSessionId: string): number {
    let count = 0;
    for (const run of this.runs.values()) {
      if (run.callerSessionId === callerSessionId) count += 1;
    }
    return count;
  }

  get size(): number {
    return this.runs.size;
  }
}

export interface ExecutionDependencies {
  readonly resolver: ResolverDependencies;
  readonly subagents: SubagentsFace;
  /** Registry name of the in-process provider that supports composition. */
  readonly subagentProvider: string;
  readonly tracker: RunTracker;
  readonly audits: AuditRing;
  readonly logger: LogSink;
  readonly now: () => number;
}

export interface ExpertRunInput {
  readonly parent: Agent;
  readonly definition: DomainDefinition;
  readonly request: DomainExpertRequest;
  readonly signal: AbortSignal;
  readonly callerDomain: string | null;
}

/** Capabilities this plugin requires from the selected provider. */
const REQUIRED_CAPABILITIES: readonly (keyof SubagentCapabilities)[] = [
  "persona",
  "toolFilter",
  "depthLimit",
];

/**
 * Run one expert as a child agent.
 *
 * The caller's own agent is the parent, so the child is a normal DSH subagent:
 * it appears in the session tree, inherits the workspace, and its recursion
 * budget is the one the runtime enforces. Nothing here re-implements the
 * subagent lifecycle — the plugin only composes the request.
 */
export async function runExpert(
  dependencies: ExecutionDependencies,
  input: ExpertRunInput,
): Promise<DomainExpertResult> {
  const startedAt = dependencies.now();
  const callerSessionId = String(input.parent.session.header.id);
  const callerDepth = input.parent.session.header.delegationDepth ?? 0;
  const depth = callerDepth + 1;

  const definition = input.definition;
  if (depth > definition.delegation.maxDepth) {
    throw new DomainExpertsError(
      "DELEGATION_DEPTH_EXCEEDED",
      `Domain "${definition.id}" caps delegation depth at ${String(definition.delegation.maxDepth)}, and this call would be depth ${String(depth)}.`,
      { refs: [definition.id] },
    );
  }

  const profile = await resolveExpert(
    dependencies.resolver,
    {
      definition,
      workspaceDir: input.parent.session.header.cwd ?? "",
      callerDomain: input.callerDomain,
      depth,
    },
    input.request,
  );

  const provider = dependencies.subagents.getProvider(dependencies.subagentProvider);
  if (provider === undefined) {
    throw new DomainExpertsError(
      "SUBAGENT_PROVIDER_MISSING",
      `Subagent provider "${dependencies.subagentProvider}" is not registered; configure the plugin with a provider that supports persona and tool filtering.`,
      { refs: [dependencies.subagentProvider] },
    );
  }
  for (const capability of REQUIRED_CAPABILITIES) {
    if (provider.capabilities[capability]) continue;
    throw unsupportedCapability(
      provider.name,
      capability,
      "an expert needs a per-child persona, tool masking and a recursion budget",
    );
  }
  if (!definition.model.inherit && provider.capabilities.agentOptions !== true) {
    throw unsupportedCapability(
      provider.name,
      "agentOptions",
      `domain "${definition.id}" pins its own model`,
    );
  }

  const request: SubagentStartRequest = {
    label: `domain-expert:${definition.id}`,
    prompt: [{ type: "text", text: profile.persona }],
    parent: input.parent,
    signal: input.signal,
    persona: profile.persona,
    toolFilter: profile.toolFilter,
    maxDepth: definition.delegation.maxDepth,
    ...agentOptionsOf(definition),
  };

  if (input.request.background) {
    return await startBackground(dependencies, input, profile, request, startedAt, depth);
  }

  let run: SubagentRun;
  try {
    run = await dependencies.subagents.start(dependencies.subagentProvider, request);
  } catch (error) {
    throw relabelCapabilityFailure(error, dependencies.subagentProvider);
  }

  const path = [...pathOf(dependencies, callerSessionId), definition.id];
  dependencies.tracker.register({
    domainId: definition.id,
    childSessionId: String(run.id),
    callerSessionId,
    callerDomain: input.callerDomain,
    path,
    depth,
    background: false,
    maxParallel: definition.delegation.maxParallel,
  });

  const childSessionId = String(run.id);
  try {
    let result: SubagentResult;
    try {
      result = await run.result;
    } catch (error) {
      const durationMs = dependencies.now() - startedAt;
      recordAudit(dependencies, input, {
        childSessionId,
        status: "error",
        durationMs,
        path,
        degradations: profile.degradations.map((item) => item.code),
      });
      return {
        ...emptyResult(definition, childSessionId, durationMs, "error"),
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
    const durationMs = dependencies.now() - startedAt;
    const text = textOfBlocks(result.output);
    const parsed = parseExpertAnswer(text);
    const status = statusOf(result.stopReason);
    recordAudit(dependencies, input, {
      childSessionId,
      status,
      durationMs,
      path,
      degradations: profile.degradations.map((item) => item.code),
    });
    return {
      domainId: definition.id,
      expert: definition.name,
      status,
      summary: parsed.summary,
      findings: parsed.findings,
      conflicts: parsed.conflicts,
      assumptions: parsed.assumptions,
      followUps: parsed.followUps,
      diagnostic: result.diagnostic ?? "",
      childSessionId,
      durationMs,
      structured: parsed.structured,
    };
  } finally {
    dependencies.tracker.release(childSessionId);
    await run.dispose().catch(() => undefined);
  }
}

async function startBackground(
  dependencies: ExecutionDependencies,
  input: ExpertRunInput,
  profile: Awaited<ReturnType<typeof resolveExpert>>,
  request: SubagentStartRequest,
  startedAt: number,
  depth: number,
): Promise<DomainExpertResult> {
  const definition = input.definition;
  const startContinuable = dependencies.subagents.startContinuable;
  if (startContinuable === undefined) {
    throw new DomainExpertsError(
      "UNSUPPORTED_SUBAGENT_CAPABILITY",
      "Background expert runs need a provider that can start continuable children.",
      { refs: [dependencies.subagentProvider] },
    );
  }
  const continuableRequest: Omit<SubagentStartRequest, "label" | "signal" | "outputSchema"> = {
    prompt: request.prompt,
    parent: request.parent,
    ...(request.persona === undefined ? {} : { persona: request.persona }),
    ...(request.toolFilter === undefined ? {} : { toolFilter: request.toolFilter }),
    ...(request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }),
    ...(request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }),
  };
  let started: ContinuableStart;
  try {
    started = await startContinuable.call(dependencies.subagents, {
      provider: dependencies.subagentProvider,
      label: request.label ?? `domain-expert:${definition.id}`,
      request: continuableRequest,
      signal: request.signal,
    });
  } catch (error) {
    throw relabelCapabilityFailure(error, dependencies.subagentProvider);
  }
  const childSessionId = String(started.childId);
  const path = [...pathOf(dependencies, String(input.parent.session.header.id)), definition.id];
  dependencies.tracker.register({
    domainId: definition.id,
    childSessionId,
    callerSessionId: String(input.parent.session.header.id),
    callerDomain: input.callerDomain,
    path,
    depth,
    background: true,
    maxParallel: definition.delegation.maxParallel,
  });
  const durationMs = dependencies.now() - startedAt;
  recordAudit(dependencies, input, {
    childSessionId,
    status: "delegated",
    durationMs,
    path,
    degradations: profile.degradations.map((item) => item.code),
  });
  return {
    ...emptyResult(definition, childSessionId, durationMs, "delegated"),
    summary: `Expert "${definition.name}" is running in the background as session ${childSessionId}.`,
  };
}

function pathOf(dependencies: ExecutionDependencies, callerSessionId: string): readonly string[] {
  return dependencies.tracker.find(callerSessionId)?.path ?? [];
}

function emptyResult(
  definition: DomainDefinition,
  childSessionId: string,
  durationMs: number,
  status: DomainExpertStatus,
): DomainExpertResult {
  return {
    domainId: definition.id,
    expert: definition.name,
    status,
    summary: "",
    findings: [],
    conflicts: [],
    assumptions: [],
    followUps: [],
    diagnostic: "",
    childSessionId,
    durationMs,
    structured: false,
  };
}

function statusOf(stopReason: SubagentResult["stopReason"]): DomainExpertStatus {
  switch (stopReason) {
    case "completed":
      return "completed";
    case "aborted":
      return "aborted";
    case "max-tokens":
      return "max-tokens";
    case "refusal":
      return "refusal";
    default:
      return "error";
  }
}

/**
 * The runtime rejects before a run exists when the composition cannot be
 * applied. Re-label its two actionable refusals into this plugin's taxonomy so
 * callers see the design's error contract, keeping the original message.
 */
function relabelCapabilityFailure(error: unknown, provider: string): unknown {
  const detail = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown }).code;
  if (code === SUBAGENT_UNSUPPORTED_CODE) {
    return new DomainExpertsError(
      "UNSUPPORTED_SUBAGENT_CAPABILITY",
      `Subagent provider "${provider}" rejected the expert composition: ${detail}`,
      { refs: [provider], cause: error },
    );
  }
  if (/names unknown global tool/u.test(detail)) {
    return new DomainExpertsError(
      "WORKER_UNAVAILABLE",
      `The expert's tool policy names a tool that is not registered in this deployment: ${detail}`,
      { refs: [provider], cause: error },
    );
  }
  return error;
}

/** Child options as the runtime declares them. */
type AgentOptionsFace = NonNullable<SubagentStartRequest["agentOptions"]>;
type ReasoningEffortFace = NonNullable<AgentOptionsFace["reasoningEffort"]>;

function agentOptionsOf(
  definition: DomainDefinition,
): Pick<SubagentStartRequest, "agentOptions"> {
  const { model } = definition;
  if (model.inherit) return {};
  const agentOptions: AgentOptionsFace = {
    ...(model.provider === "" ? {} : { provider: model.provider }),
    ...(model.model === "" ? {} : { model: model.model }),
    ...(model.reasoningEffort === ""
      ? {}
      : { reasoningEffort: model.reasoningEffort as ReasoningEffortFace }),
    ...(model.maxTokens > 0 ? { maxTokens: model.maxTokens } : {}),
  };
  return { agentOptions };
}

function recordAudit(
  dependencies: ExecutionDependencies,
  input: ExpertRunInput,
  detail: {
    readonly childSessionId: string;
    readonly status: DomainExpertStatus;
    readonly durationMs: number;
    readonly path: readonly string[];
    readonly degradations: readonly ExpertAuditEntry["degraded"][number][];
  },
): void {
  const entry: ExpertAuditEntry = {
    at: dependencies.now(),
    domainId: input.definition.id,
    callerDomain: input.callerDomain,
    callerSessionId: String(input.parent.session.header.id),
    childSessionId: detail.childSessionId,
    mode: input.request.mode,
    background: input.request.background,
    status: detail.status,
    durationMs: detail.durationMs,
    delegatePath: detail.path,
    degraded: detail.degradations,
  };
  dependencies.audits.record(entry);
  // Mirrored to the plugin log with the same fields and no task text.
  dependencies.logger.info("domain-expert/run", {
    domain: entry.domainId,
    callerDomain: entry.callerDomain,
    status: entry.status,
    durationMs: entry.durationMs,
    path: entry.delegatePath.join(" > "),
    ...(entry.degraded.length > 0 ? { degraded: entry.degraded.join(",") } : {}),
  });
  if (detail.path.length > 1) {
    dependencies.logger.info("domain-expert/delegation", {
      domain: entry.domainId,
      path: detail.path.join(" > "),
      callerSessionId: entry.callerSessionId,
    });
  }
  if (entry.degraded.length > 0) {
    dependencies.logger.warn("domain-expert/degraded", {
      domain: entry.domainId,
      codes: entry.degraded.join(","),
    });
  }
}
