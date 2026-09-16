import type { Agent } from "@deepseek-ai/dsh-agent";
import {
  EXPERT_MODES,
  type CrossDomainMode,
  type DomainDefinition,
  type DomainExpertRequest,
  type DomainExpertResult,
  type DomainListing,
} from "../../types.js";
import { DomainExpertsError, errorCodeOf, errorMessageOf } from "../errors.js";
import type { ActiveRun, ExpertRunInput, LogSink } from "../execution.js";
import type { DomainMemoryProvider } from "../memory/registry.js";
import { normalizeExpertMode } from "../resolver.js";

/** An expert's verdict on whether its caller may reach another domain. */
export interface DelegationVerdict {
  readonly allowed: boolean;
  readonly mode: CrossDomainMode;
  readonly targets: readonly string[];
  readonly message: string;
}

/** Parallel-run admission for one caller session. */
export interface ParallelBudget {
  readonly exceeded: boolean;
  readonly limit: number;
  readonly active: number;
}

/** Everything the agent-visible tools need, assembled by the host entry. */
export interface ToolDependencies {
  /** Lightweight metadata only; never scope or policy configuration. */
  list(): readonly DomainListing[];
  /** The persisted definition, or a loud DOMAIN_NOT_FOUND/DOMAIN_DISABLED. */
  requireDefinition(id: string): DomainDefinition;
  run(input: ExpertRunInput): Promise<DomainExpertResult>;
  /** The expert run a session belongs to, or `undefined` for a plain caller. */
  activeRun(sessionId: string): ActiveRun | undefined;
  /** Apply the caller expert's cross-domain policy to a target domain. */
  delegationVerdict(
    callerDomainId: string,
    targetDomainId: string,
  ): DelegationVerdict;
  /** Whether the caller may start another expert child right now. */
  parallelBudget(callerSessionId: string): ParallelBudget;
  /** The memory provider the deployment selected. */
  memory(): DomainMemoryProvider;
  logger: LogSink;
}

/**
 * Tool failures carry their stable code in the message.
 *
 * A tool that throws yields an `isError` result whose text is the message, so
 * the code is the only machine-readable part the model and the log both see.
 * Unexpected faults are re-thrown untouched: they are plugin defects, not
 * domain refusals.
 */
export function toToolError(error: unknown): Error {
  if (error instanceof DomainExpertsError) {
    return new Error(`[${error.code}] ${error.message}`, { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function toolFailureDetail(error: unknown): {
  code: string;
  message: string;
} {
  return { code: errorCodeOf(error), message: errorMessageOf(error) };
}

/** The calling agent, or a loud refusal: every tool here needs a parent. */
export function requireAgent(agent: Agent | undefined, tool: string): Agent {
  if (agent === undefined) {
    throw new DomainExpertsError(
      "TASK_REJECTED",
      `${tool} requires a calling agent, and none was attached to this execution.`,
    );
  }
  return agent;
}

export function callerSessionIdOf(agent: Agent): string {
  return String(agent.session.header.id);
}

export const EXPERT_MODE_VALUES: readonly string[] = EXPERT_MODES;

/** Normalize the model-supplied request fields into a domain request. */
export function requestOf(args: {
  readonly task: string;
  readonly context?: string | undefined;
  readonly output?: string | undefined;
  readonly mode?: string | undefined;
  readonly background?: boolean | undefined;
}): DomainExpertRequest {
  return {
    task: args.task.trim(),
    context: (args.context ?? "").trim(),
    output: (args.output ?? "").trim(),
    mode: normalizeExpertMode(args.mode),
    background: args.background === true,
  };
}

/** One-line status shared by every tool's rendered result. */
export function statusLine(
  domainId: string,
  status: string,
  durationMs: number,
): string {
  return `domain=${domainId} status=${status} durationMs=${String(Math.round(durationMs))}`;
}
