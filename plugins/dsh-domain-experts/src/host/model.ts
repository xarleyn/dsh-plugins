import type { Agent, AgentOptions } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { DomainExpertsError } from "./errors.js";
import type { ExecutionDependencies, ExpertRunInput } from "./execution.js";

type ModelPair = { readonly provider: string; readonly model: string };
type ReasoningEffort = NonNullable<AgentOptions["reasoningEffort"]>;
type ExpertModel = ModelPair & {
  readonly reasoningEffort?: ReasoningEffort;
  readonly maxTokens?: number;
};

export type ExpertModelOverride = ModelPair | "configured";

export interface ExpertModelApproval {
  readonly agent: Agent;
  readonly domainId: string;
  readonly from: ModelPair;
  readonly to: ExpertModel;
  readonly signal: AbortSignal;
  readonly callId?: ToolRunContext["callId"];
}

function callerModel(agent: Agent): ExpertModel {
  const request = agent.session.requestHeader?.()?.config;
  // A running tool belongs to the request that produced it. An idle agent
  // may already have a new model selected for its next step.
  const active = agent.status === "idle" ? undefined : request;
  const options = active ?? agent.model?.current() ?? request ?? agent.options;
  if (!options?.provider || !options.model) {
    throw new DomainExpertsError(
      "EXPERT_MODEL_UNRESOLVED",
      "The caller's active provider and model are unknown. Select a model in the chat before running an expert.",
    );
  }
  const { provider, model, reasoningEffort } = options;
  return {
    provider,
    model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
}

function requestedModel(input: ExpertRunInput): ExpertModel | undefined {
  if (input.modelOverride !== "configured") return input.modelOverride;
  const config = input.definition.model;
  if (config.inherit || !config.provider || !config.model) {
    throw new DomainExpertsError(
      "TASK_REJECTED",
      `Domain "${input.definition.id}" has no configured alternative model. Omit the override to use the caller's model.`,
    );
  }
  return {
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort === ""
      ? {}
      : { reasoningEffort: config.reasoningEffort as ReasoningEffort }),
    ...(config.maxTokens > 0 ? { maxTokens: config.maxTokens } : {}),
  };
}

function samePair(left: ModelPair, right: ModelPair): boolean {
  return left.provider === right.provider && left.model === right.model;
}

export async function expertAgentOptions(
  input: ExpertRunInput,
  approve: ExecutionDependencies["approveModelSwitch"],
): Promise<ExpertModel> {
  const from = callerModel(input.parent);
  const to = requestedModel(input);
  if (to === undefined || samePair(from, to)) return from;

  const { definition, parent, signal, callId } = input;
  // Only a primary agent has an approval UI it can wait on. A child can
  // report the need for a different model to its parent.
  if (
    input.callerDomain !== null ||
    parent.session.header.origin === "subagent" ||
    (parent.session.header.delegationDepth ?? 0) > 0
  ) {
    throw new DomainExpertsError(
      "EXPERT_MODEL_NOT_APPROVED",
      "Ask the primary agent to request the model change, or use your current model.",
    );
  }
  const approved = await approve?.({
    agent: parent,
    domainId: definition.id,
    from,
    to,
    signal,
    ...(callId === undefined ? {} : { callId }),
  });
  signal.throwIfAborted();
  if (approved === undefined || !samePair(approved, to)) {
    throw new DomainExpertsError(
      "EXPERT_MODEL_NOT_APPROVED",
      `The requested model for domain "${definition.id}" was not approved. You may call the expert on your current model by omitting the override.`,
    );
  }
  return approved;
}

/** Ask through the chat's own surface. Only route metadata goes to the approver. */
export async function approveExpertModelSwitch(
  ctx: Context,
  request: ExpertModelApproval,
): Promise<ExpertModel | undefined> {
  const { agent, callId, domainId, from, to, signal } = request;
  const llm = ctx.get("llm") as
    Pick<Context["llm"], "resolveCallConfig"> | undefined;
  if (llm === undefined) return undefined;
  signal.throwIfAborted();
  const selected = await llm.resolveCallConfig(to, signal);
  if (!samePair(selected, to)) return undefined;
  signal.throwIfAborted();
  const model: ExpertModel = {
    ...to,
    ...(selected.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: selected.reasoningEffort }),
  };
  const surface = ctx.get("qaSurface") as
    | {
        confirmExpertModelSwitch(
          request: ExpertModelApproval,
        ): Promise<boolean | undefined>;
      }
    | undefined;
  const qa = await surface?.confirmExpertModelSwitch?.({
    ...request,
    to: model,
  });
  if (qa !== undefined) return qa === true ? model : undefined;

  const native = ctx.get("approval") as
    | {
        request(input: {
          agent: Agent;
          toolName: string;
          callId?: ToolRunContext["callId"];
          reason: string;
          signal: AbortSignal;
        }): Promise<string>;
      }
    | undefined;
  const outcome = await native?.request({
    agent,
    toolName: "domain_expert",
    ...(callId === undefined ? {} : { callId }),
    reason: `Expert "${domainId}" requests a change from "${from.provider}" / "${from.model}" to "${to.provider}" / "${to.model}". If approved, the selected provider will receive the expert's task and context.`,
    signal,
  });
  return outcome === "allowed-once" ? model : undefined;
}
