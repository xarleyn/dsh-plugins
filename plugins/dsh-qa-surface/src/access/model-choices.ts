import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import type { Agent, ModelSelection } from "@deepseek-ai/dsh-agent";
import type { QaModelOptions, QaModelPair } from "../types.js";
import type {
  SessionSelectModelRequest,
  SessionSelectModelValue,
} from "@deepseek-ai/dsh-api-session-controller/types";
import { sessionModelSelection } from "../session-model.js";
import type { QaAccessService } from "./service.js";
import {
  modelPolicySatisfied,
  projectModelCatalog,
  type QaSessionModelPolicy,
} from "./model-policy.js";

/** Only explicit policy grants are exposed to an ordinary account. */
export async function userModelOptions(
  ctx: Context,
  access: QaAccessService,
  token: string,
  sessionId: string | null,
  subroleId: string | null,
  preview: boolean,
): Promise<QaModelOptions> {
  const resolve = (): QaSessionModelPolicy => {
    if (sessionId === null)
      return access.draftModelPolicy(token, subroleId, preview);
    return access.userSessionModelPolicy(token, sessionId);
  };
  resolve(); // Authenticate before reading the Host catalog.
  const catalog = projectModelCatalog(
    await ctx.sessionController.modelCatalog(),
  );
  const policy = resolve(); // Recheck the token and grants after the async read.
  const granted = [
    ...(policy.pair === undefined ? [] : [policy.pair]),
    ...(policy.allowedModels ?? []),
  ];
  const models = catalog.filter((entry) =>
    granted.some(
      (pair) => pair.provider === entry.provider && pair.model === entry.model,
    ),
  );
  const agent =
    sessionId === null ? undefined : ctx.agents.get(SessionId(sessionId));
  const facts =
    agent === undefined ? policy.pair : sessionModelSelection(ctx, agent);
  const selected =
    facts?.provider === undefined || facts.model === undefined
      ? undefined
      : {
          provider: facts.provider,
          model: facts.model,
          ...(facts.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: facts.reasoningEffort }),
        };
  return {
    models,
    choices: granted,
    ...(policy.pair === undefined ? {} : { defaultModel: policy.pair }),
    ...(selected === undefined ? {} : { selected }),
  };
}

/** Validate both policy membership and live availability before a user mutation. */
export async function assertUserModelSelection(
  ctx: Context,
  policy: () => QaSessionModelPolicy,
  request: {
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string | null;
  },
): Promise<void> {
  if (typeof request.provider !== "string" || typeof request.model !== "string")
    throw new Error("Choose a complete provider and model pair.");
  const pair: QaModelPair = {
    provider: request.provider,
    model: request.model,
    ...(request.reasoningEffort == null
      ? {}
      : { reasoningEffort: request.reasoningEffort }),
  };
  const catalog = projectModelCatalog(
    await ctx.sessionController.modelCatalog(),
  );
  const entry = catalog.find(
    (item) => item.provider === pair.provider && item.model === pair.model,
  );
  if (entry === undefined)
    throw new Error("This model is currently unavailable.");
  if (
    pair.reasoningEffort !== undefined &&
    !entry.reasoningEfforts.includes(pair.reasoningEffort)
  )
    throw new Error(
      "This reasoning effort is unavailable for the selected model.",
    );
  const effective = policy();
  if (
    (effective.pair === undefined && effective.allowedModels === undefined) ||
    !modelPolicySatisfied(effective, pair)
  )
    throw new Error("This model is not allowed by the chat policy.");
}

/** Native durable per-session selection, without the operator-wide default save. */
export async function selectUserModel(
  ctx: Context,
  access: QaAccessService,
  token: string,
  request: SessionSelectModelRequest,
): Promise<SessionSelectModelValue> {
  const id = String(request.sessionId);
  const policy = () => access.userSessionModelPolicy(token, id);
  policy();
  const agent = ctx.agents.get(request.sessionId);
  if (agent === undefined) throw new Error("The chat is unavailable.");
  // DSH's public selectModel also saves the operator-wide default. Its owned
  // agent controller has the narrower commit primitive. Keep this compatibility
  // bridge guarded and fail closed when the Host no longer exposes it; never
  // fall back to changing a deployment-wide preference from a QA account.
  const controller = (
    ctx.sessionController as unknown as {
      readonly agents?: {
        serializeImageAdmission<T>(
          agent: Agent,
          operation: () => Promise<T>,
        ): Promise<T>;
        selectForNextRequest(agent: Agent, selection: ModelSelection): void;
      };
    }
  ).agents;
  if (
    typeof controller?.serializeImageAdmission !== "function" ||
    typeof controller.selectForNextRequest !== "function"
  )
    throw new Error("This Host does not support chat-local model selection.");
  return controller.serializeImageAdmission(agent, async () => {
    if (agent.status !== "idle")
      throw new Error(
        "Wait for the current response before changing the model.",
      );
    await assertUserModelSelection(ctx, policy, request);
    const selected = await ctx.llm.resolveCallConfig({
      provider: request.provider,
      model: request.model,
      ...(request.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
    });
    if (!modelPolicySatisfied(policy(), selected))
      throw new Error("This model is not allowed by the chat policy.");
    if (agent.status !== "idle")
      throw new Error(
        "Wait for the current response before changing the model.",
      );
    const pair = {
      provider: selected.provider,
      model: selected.model,
      ...(selected.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: selected.reasoningEffort }),
    };
    controller.selectForNextRequest(agent, pair);
    return { selected: pair };
  });
}
