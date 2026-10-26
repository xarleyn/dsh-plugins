import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentStartRequest,
} from "@deepseek-ai/dsh-subagent";
import type {
  DomainDefinition,
  DomainDegradation,
  DomainExpertRequest,
  DomainExpertResult,
  DomainExpertStatus,
  ExpertAuditEntry,
} from "../types.js";
import type { AuditRing } from "./audit.js";
import {
  degradation,
  DomainExpertsError,
  SUBAGENT_UNSUPPORTED_CODE,
  unsupportedCapability,
} from "./errors.js";
import {
  memoryOwnerOf,
  resolveExpert,
  type MemoryOwner,
  type ResolverDependencies,
} from "./resolver.js";
import type { QaModelPolicyPair } from "./qa-principal.js";
import { parseExpertAnswer, textOfBlocks } from "./result.js";
import { EXPERT_REVIEW_OUTPUT_SCHEMA } from "./review-output.js";
import { expertLabelOf } from "./caller.js";
import type { ExpertToolFilter } from "./tool-policy.js";

/** The subagent surface this plugin consumes from the host context. */
export interface SubagentsFace {
  getProvider(name: string): SubagentProvider | undefined;
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>;
  /** Direct children from the Host's durable parent-owned catalog. */
  childrenOf?(
    parentSessionId: string,
    signal: AbortSignal,
  ): Promise<
    readonly {
      readonly sessionId: string;
      readonly label: string | undefined;
    }[]
  >;
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
  /**
   * Whose memory namespaces this run reads and writes.
   *
   * Carried by the run rather than re-resolved per call: a child's session was
   * never attested by an account, so `domain_memory` inside it has to ask the
   * run, not the session, and the persona the child was started with has to
   * agree with the answer.
   */
  readonly memoryOwner: MemoryOwner;
}

/**
 * Session id -> the expert run it belongs to.
 *
 * `domain_delegate` needs to know which domain its own child belongs to, and
 * the runtime exposes no domain marker on a session. The coordinator
 * therefore records the mapping when it starts a run. It is process-local;
 * callerDomainOf recovers delegation identity from the Host's durable child
 * catalog after eviction or restart and refuses unknown identity. Memory
 * ownership still requires this live record rather than a creation label.
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
  /**
   * Whether this deployment keeps a memory namespace per account.
   *
   * The operator's answer, not the session's: it decides whether the domain's
   * own namespace is the writable one or the read-only common tier.
   */
  readonly perUserMemory: boolean;
  /**
   * The account a session belongs to, or `undefined`.
   *
   * Only a chat an account itself attested answers; the caller of an expert is
   * such a chat, and the plugin never accepts an account from the model.
   */
  principalOf(sessionId: string): string | undefined;
  /**
   * The provider and model the deployment's QA policy fixes for one chat.
   *
   * Optional like the surface behind it: a deployment with no QA surface, or
   * one whose roles name no pair, answers nothing here, and a domain that
   * inherits its model keeps inheriting the caller's.
   */
  modelPolicyOf?(sessionId: string): QaModelPolicyPair | undefined;
  /** Host lifecycle adapter applying a configured filter before first prompt. */
  startActivation?(
    spec: SubagentActivationSpec,
    filter?: ExpertToolFilter,
  ): Promise<SubagentActivation>;
}

export interface ExpertRunInput {
  /** Host-admitted durable images, supplied only by in-process callers. */
  readonly images?: readonly Extract<
    SubagentStartRequest["prompt"][number],
    { type: "image" }
  >[];
  readonly structuredOutput?: boolean;
  readonly parent: Agent;
  readonly definition: DomainDefinition;
  readonly request: DomainExpertRequest;
  readonly signal: AbortSignal;
  readonly callerDomain: string | null;
}

/**
 * Capabilities this plugin requires from the selected provider.
 *
 * The depth cap is the one start-time option every expert needs the runtime to
 * enforce. The Host composes the child's preset; the lifecycle adapter applies
 * its configured tool restriction on that child's scoped registry.
 */
const REQUIRED_CAPABILITIES: readonly (keyof SubagentCapabilities)[] = [
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

  const memoryOwner = memoryOwnerOf(
    dependencies.perUserMemory,
    dependencies.tracker.find(callerSessionId)?.memoryOwner,
    dependencies.principalOf(callerSessionId),
  );
  const profile = await resolveExpert(
    dependencies.resolver,
    {
      definition,
      workspaceDir: input.parent.session.header.cwd ?? "",
      callerDomain: input.callerDomain,
      depth,
      memoryOwner,
      ...(input.structuredOutput === true ? { structuredOutput: true } : {}),
    },
    input.request,
  );
  // Resolution's own picture, plus what this start learned about the
  // deployment. The audit entry is written from this array, so a policy the
  // runtime cannot apply is recorded rather than silently missing from the run.
  const degradations = [...profile.degradations];

  const provider = dependencies.subagents.getProvider(
    dependencies.subagentProvider,
  );
  if (provider === undefined) {
    throw new DomainExpertsError(
      "SUBAGENT_PROVIDER_MISSING",
      `Subagent provider "${dependencies.subagentProvider}" is not registered; configure the plugin with a provider that supports a delegation depth cap.`,
      { refs: [dependencies.subagentProvider] },
    );
  }
  for (const capability of REQUIRED_CAPABILITIES) {
    if (provider.capabilities[capability]) continue;
    throw unsupportedCapability(
      provider.name,
      capability,
      "an expert needs the runtime to enforce its recursion budget",
    );
  }
  if (
    input.structuredOutput === true &&
    (input.request.background || provider.capabilities.outputSchema !== true)
  )
    throw unsupportedCapability(
      provider.name,
      "outputSchema",
      "a structured review needs one-shot native result capture",
    );
  // A domain that inherits its model still takes the pair the chat's policy
  // fixed, so the delegation follows the role the chat runs under rather than
  // the model its visitor left in the picker.
  const modelPolicy = definition.model.inherit
    ? dependencies.modelPolicyOf?.(callerSessionId)
    : undefined;
  if (
    (!definition.model.inherit || modelPolicy !== undefined) &&
    provider.capabilities.agentOptions !== true
  ) {
    throw unsupportedCapability(
      provider.name,
      "agentOptions",
      definition.model.inherit
        ? `domain "${definition.id}" runs on the model the chat's policy pins`
        : `domain "${definition.id}" pins its own model`,
    );
  }

  const spec: SubagentActivationSpec = {
    provider: dependencies.subagentProvider,
    label: expertLabelOf(definition.id),
    request: {
      // The start contract no longer carries a per-child persona: the Host
      // composes a child's persona and tools from its Agent Preset. The
      // composed policy therefore leads the child's first message and the
      // caller's request follows it, so a candidate answer — anything the
      // caller embedded in the request — still cannot read as deployment
      // instruction.
      prompt: [
        { type: "text", text: profile.policy },
        { type: "text", text: profile.task },
        ...(input.images ?? []),
      ],
      parent: input.parent,
      maxDepth: definition.delegation.maxDepth,
      ...agentOptionsOf(definition, modelPolicy),
      ...(input.structuredOutput === true
        ? { outputSchema: EXPERT_REVIEW_OUTPUT_SCHEMA }
        : {}),
    },
    signal: input.signal,
    // Parent delivery notifies the model; caller delivery returns the result
    // to this call alone. A foreground expert answers through its tool result,
    // so the parent model must not be notified; a background one hands the
    // completion notice to the parent's model.
    delivery: input.request.background ? "parent" : "caller",
  };

  // The start request has no filter field. The Host adapter installs it on
  // the reserved child's context before the initial prompt is submitted.
  const configuredTools = [
    ...new Set([...definition.tools.allow, ...definition.tools.deny]),
  ];
  if (
    configuredTools.length > 0 &&
    dependencies.startActivation === undefined
  ) {
    degradations.push(
      degradation(
        "TOOL_UNFILTERABLE",
        `Tool${configuredTools.length > 1 ? "s" : ""} ${configuredTools
          .map((name) => `"${name}"`)
          .join(
            ", ",
          )} named in this expert's tool policy cannot be scoped per run on this Host: the child starts under its parent's tool composition. Express the policy in an Agent Preset selected for the expert.`,
        configuredTools,
      ),
    );
  }
  const startActivation = async (activationSpec: SubagentActivationSpec) => {
    if (dependencies.startActivation === undefined)
      return dependencies.subagents.startActivation(activationSpec);
    const activation = await dependencies.startActivation(
      activationSpec,
      configuredTools.length > 0 ? profile.toolFilter : undefined,
    );
    // The Host has now validated every configured name against the child's
    // actual registry. The resolver's earlier uncertainty is settled.
    if (configuredTools.length > 0) {
      for (let index = degradations.length - 1; index >= 0; index -= 1) {
        if (degradations[index]!.code === "TOOL_UNVERIFIED")
          degradations.splice(index, 1);
      }
    }
    return activation;
  };

  if (input.request.background) {
    return await startBackground(
      dependencies,
      input,
      degradations,
      spec,
      startedAt,
      depth,
      memoryOwner,
      startActivation,
    );
  }

  let activation: SubagentActivation;
  try {
    activation = await startActivation(spec);
  } catch (error) {
    throw relabelCapabilityFailure(error, dependencies.subagentProvider);
  }

  const path = [
    ...pathOf(dependencies, callerSessionId, input.callerDomain),
    definition.id,
  ];
  const childSessionId = String(activation.childId);
  dependencies.tracker.register({
    domainId: definition.id,
    childSessionId,
    callerSessionId,
    callerDomain: input.callerDomain,
    path,
    depth,
    background: false,
    maxParallel: definition.delegation.maxParallel,
    memoryOwner,
  });

  try {
    let result: SubagentResult;
    try {
      result = await activation.result;
    } catch (error) {
      const durationMs = dependencies.now() - startedAt;
      recordAudit(dependencies, input, {
        childSessionId,
        status: "error",
        durationMs,
        path,
        degradations: degradations.map((item) => item.code),
      });
      return {
        ...emptyResult(definition, childSessionId, durationMs, "error"),
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
    const durationMs = dependencies.now() - startedAt;
    const text =
      input.structuredOutput === true
        ? JSON.stringify(result.structured ?? null)
        : textOfBlocks(result.output);
    const parsed = parseExpertAnswer(text);
    const status = statusOf(result.stopReason);
    recordAudit(dependencies, input, {
      childSessionId,
      status,
      durationMs,
      path,
      degradations: degradations.map((item) => item.code),
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
    await activation.dispose().catch(() => undefined);
  }
}

async function startBackground(
  dependencies: ExecutionDependencies,
  input: ExpertRunInput,
  degradations: DomainDegradation[],
  spec: SubagentActivationSpec,
  startedAt: number,
  depth: number,
  memoryOwner: MemoryOwner,
  startActivation: (
    spec: SubagentActivationSpec,
  ) => Promise<SubagentActivation>,
): Promise<DomainExpertResult> {
  const definition = input.definition;
  let activation: SubagentActivation;
  try {
    activation = await startActivation(spec);
  } catch (error) {
    throw relabelCapabilityFailure(error, dependencies.subagentProvider);
  }
  const childSessionId = String(activation.childId);
  const path = [
    ...pathOf(
      dependencies,
      String(input.parent.session.header.id),
      input.callerDomain,
    ),
    definition.id,
  ];
  dependencies.tracker.register({
    domainId: definition.id,
    childSessionId,
    callerSessionId: String(input.parent.session.header.id),
    callerDomain: input.callerDomain,
    path,
    depth,
    background: true,
    maxParallel: definition.delegation.maxParallel,
    memoryOwner,
  });
  const durationMs = dependencies.now() - startedAt;
  recordAudit(dependencies, input, {
    childSessionId,
    status: "delegated",
    durationMs,
    path,
    degradations: degradations.map((item) => item.code),
  });
  return {
    ...emptyResult(definition, childSessionId, durationMs, "delegated"),
    summary: `Expert "${definition.name}" is running in the background as session ${childSessionId}.`,
  };
}

function pathOf(
  dependencies: ExecutionDependencies,
  callerSessionId: string,
  callerDomain: string | null,
): readonly string[] {
  // After a restart only the immediate caller is known; record that suffix
  // rather than fabricating earlier ancestors or omitting the caller entirely.
  return (
    dependencies.tracker.find(callerSessionId)?.path ??
    (callerDomain === null ? [] : [callerDomain])
  );
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

function statusOf(
  stopReason: SubagentResult["stopReason"],
): DomainExpertStatus {
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
 * The runtime rejects before an activation exists when the composition cannot
 * be applied. Re-label its actionable refusal into this plugin's taxonomy so
 * callers see the design's error contract, keeping the original message.
 */
function relabelCapabilityFailure(error: unknown, provider: string): unknown {
  const code = (error as { code?: unknown }).code;
  if (code === SUBAGENT_UNSUPPORTED_CODE) {
    const detail = error instanceof Error ? error.message : String(error);
    return new DomainExpertsError(
      "UNSUPPORTED_SUBAGENT_CAPABILITY",
      `Subagent provider "${provider}" rejected the expert composition: ${detail}`,
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
  policy?: QaModelPolicyPair | undefined,
): Pick<SubagentStartRequest, "agentOptions"> {
  const { model } = definition;
  if (model.inherit) {
    if (policy === undefined) return {};
    return {
      agentOptions: {
        provider: policy.provider,
        model: policy.model,
        ...(policy.reasoningEffort === undefined
          ? {}
          : {
              reasoningEffort: policy.reasoningEffort as ReasoningEffortFace,
            }),
      },
    };
  }
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
    ...(entry.degraded.length > 0
      ? { degraded: entry.degraded.join(",") }
      : {}),
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
