import type { Context } from "@deepseek-ai/cordis";
import type { Agent, AgentOptions } from "@deepseek-ai/dsh-agent";
import { ReasoningEffortId, type ContentBlock } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import {
  modelPolicySatisfied,
  projectModelCatalog,
  type QaSessionModelPolicy,
} from "../access/model-policy.js";
import { assertUserModelSelection } from "../access/model-choices.js";

/** Optional Host service: loading QA does not require a subagent backend. */
export interface QaSubagentsFace {
  getProvider(name: string):
    | {
        readonly capabilities: {
          readonly agentOptions: boolean;
          readonly depthLimit: boolean;
        };
      }
    | undefined;
  resolveMaxDepth(value: undefined): number | undefined;
  startActivation(spec: {
    readonly provider: string;
    readonly label: string;
    readonly signal: AbortSignal;
    readonly delivery: "parent";
    readonly request: {
      readonly parent: Agent;
      readonly prompt: ContentBlock[];
      readonly agentOptions: AgentOptions;
      readonly maxDepth?: number;
    };
  }): Promise<{ readonly childId: string }>;
}

export interface QaSubagentToolsOptions {
  readonly ctx: Context;
  /** Must reject a caller outside an attested QA conversation. */
  readonly policy: (agent: Agent) => QaSessionModelPolicy;
  readonly runtime: () => QaSubagentsFace | undefined;
}

function caller(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error("A QA agent is required.");
  return agent;
}

/** Only live catalog entries covered by the owner's current model grants. */
export function createQaListSubagentModelsTool(
  options: QaSubagentToolsOptions,
): ToolDefinition {
  return defineTool({
    name: "qa_list_subagent_models",
    description:
      "List the current user's available subagent models and allowed reasoning efforts. Use the returned provider/model ids with qa_subagent. The chat's own model is unchanged. Read this list again after a model refusal; permissions and availability can change.",
    parameters: {},
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    execute: async (_args, exec) => {
      const agent = caller(exec.agent);
      options.policy(agent);
      exec.signal.throwIfAborted();
      const catalog = projectModelCatalog(
        await options.ctx.sessionController.modelCatalog(),
      );
      const policy = options.policy(agent);
      exec.signal.throwIfAborted();
      const choices = [
        ...(policy.pair === undefined ? [] : [policy.pair]),
        ...(policy.allowedModels ?? []),
      ];
      const models = catalog
        .filter((entry) =>
          choices.some(
            (pair) =>
              pair.provider === entry.provider && pair.model === entry.model,
          ),
        )
        .map((entry) => ({
          ...entry,
          reasoningEfforts: entry.reasoningEfforts.filter((reasoningEffort) =>
            modelPolicySatisfied(policy, { ...entry, reasoningEffort }),
          ),
        }))
        .filter(
          (entry) =>
            entry.reasoningEfforts.length > 0 ||
            modelPolicySatisfied(policy, entry),
        );
      return JSON.stringify({ models }, null, 2);
    },
  });
}

/** Start a fresh native child, with route authority supplied by QA ownership. */
export function createQaSubagentTool(
  options: QaSubagentToolsOptions,
): ToolDefinition {
  return defineTool({
    name: "qa_subagent",
    description:
      "Delegate a self-contained task to a fresh subagent on a model available to the current user. First call qa_list_subagent_models and choose its exact provider/model pair and an allowed reasoning_effort when advertised. Include all necessary context in prompt. The child inherits this agent's preset, workspace and permission boundaries. Returns a child id; the Host delivers its result to this conversation. Use send_message, list_agents and interrupt_agent when those tools are available. Independent delegations may start together.",
    parameters: {
      description: {
        type: "string",
        required: true,
        description: "Short display name for this task.",
      },
      prompt: {
        type: "string",
        required: true,
        description: "Complete self-contained task for the child.",
      },
      provider: {
        type: "string",
        required: true,
        description: "Exact provider id from qa_list_subagent_models.",
      },
      model: {
        type: "string",
        required: true,
        description: "Exact model id from qa_list_subagent_models.",
      },
      reasoning_effort: {
        type: "string",
        description:
          "Allowed effort for this model. Omit to use its default effort.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "activation", required: true },
          subagentId: { type: "string", required: true },
          provider: { type: "string", required: true },
          model: { type: "string", required: true },
          reasoningEffort: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    execute: async (args, exec) => {
      const parent = caller(exec.agent);
      const policy = () => options.policy(parent);
      policy();
      if (args.description.trim() === "" || args.prompt.trim() === "")
        throw new Error(
          "The subagent description and prompt must be non-empty.",
        );
      exec.signal.throwIfAborted();
      const runtime = options.runtime();
      const backend = runtime?.getProvider("spawn");
      if (
        runtime === undefined ||
        backend === undefined ||
        typeof runtime.resolveMaxDepth !== "function" ||
        typeof runtime.startActivation !== "function"
      )
        throw new Error("The native spawn subagent provider is unavailable.");
      if (
        !backend.capabilities.agentOptions ||
        !backend.capabilities.depthLimit
      )
        throw new Error(
          "The spawn provider cannot enforce model selection and delegation depth.",
        );
      const request = {
        provider: args.provider,
        model: args.model,
        ...(args.reasoning_effort === undefined
          ? {}
          : { reasoningEffort: args.reasoning_effort }),
      };
      await assertUserModelSelection(options.ctx, policy, request);
      const selected = await options.ctx.llm.resolveCallConfig(
        {
          provider: request.provider,
          model: request.model,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
        },
        exec.signal,
      );
      if (
        selected.provider !== request.provider ||
        selected.model !== request.model
      )
        throw new Error(
          "The provider resolved a different model; retry with an available model.",
        );
      // Resolution may await a provider. Recheck grants and catalog before
      // creating anything, including the adapter's default reasoning effort.
      await assertUserModelSelection(options.ctx, policy, selected);
      exec.signal.throwIfAborted();
      // Cordis returns a new tracing proxy for each service read. Compare the
      // registered backend itself, not those context-bound service wrappers.
      if (options.runtime()?.getProvider("spawn") !== backend)
        throw new Error("The spawn provider changed; retry the delegation.");
      const maxDepth = runtime.resolveMaxDepth(undefined);
      const agentOptions = {
        provider: selected.provider,
        model: selected.model,
        ...(selected.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selected.reasoningEffort }),
      };
      const started = await runtime.startActivation({
        provider: "spawn",
        label: args.description,
        signal: exec.signal,
        delivery: "parent",
        request: {
          parent,
          prompt: [{ type: "text", text: args.prompt }],
          agentOptions,
          ...(maxDepth === undefined ? {} : { maxDepth }),
        },
      });
      return {
        kind: "activation" as const,
        subagentId: started.childId,
        ...agentOptions,
      };
    },
  });
}
