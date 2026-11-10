import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import {
  assertModelPairAvailable,
  projectModelCatalog,
  replaceModelPair,
  modelPolicySatisfied,
  type ModelSelectionFacts,
  type QaSessionModelPolicy,
} from "./access/model-policy.js";
import type { QaModelPair, QaModelReplacement } from "./types.js";

/** Host selection is durable and can differ from immutable agent creation options. */
export function sessionModelSelection(
  ctx: Context,
  agent: Pick<Agent, "session" | "options">,
): ModelSelectionFacts {
  const projections = ctx.get?.("sessionProjections") as
    Context["sessionProjections"] | undefined;
  const state = projections?.stateOf?.(agent.session, "modelSelection");
  return state?.pending ?? state?.lastUsed ?? agent.options;
}

/**
 * Put one fresh session on the pair its model policy names.
 *
 * The check runs here rather than after the selection because the Host answers
 * an unknown model by failing the first question of the chat, in words that
 * name neither the pair nor the policy it came from. Refusing at the door keeps
 * the chat uncreated and the operator's journal on the same line as the reason.
 *
 * Absent pair means no layer of the policy spoke: the session keeps whatever
 * the Host's own default composition gives it.
 *
 * @param ctx - the Host context, for the model catalog and the selection.
 * @param sessionId - the session the Host just created.
 * @param policy - the resolved policy of this session.
 * @param logger - where the applied pair is recorded, with its layer.
 * @returns the pair the session was put on, or `undefined` when none applied.
 */
export async function applySessionModelPolicy(
  ctx: Context,
  sessionId: SessionId,
  policy: QaSessionModelPolicy,
  logger: PluginLogger,
): Promise<QaModelPair | undefined> {
  const pair = policy.pair;
  if (pair === undefined) return undefined;
  assertModelPairAvailable(
    pair,
    projectModelCatalog(await ctx.sessionController.modelCatalog()),
  );
  await ctx.sessionController.selectModel({
    sessionId,
    provider: pair.provider,
    model: pair.model,
    ...(pair.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: pair.reasoningEffort }),
  });
  logger.info("session.model-selected", {
    sessionId: String(sessionId),
    provider: pair.provider,
    model: pair.model,
    layer: policy.layer ?? "deployment",
    ...(policy.redirectedFrom === undefined
      ? {}
      : {
          replacedProvider: policy.redirectedFrom.provider,
          replacedModel: policy.redirectedFrom.model,
        }),
  });
  return pair;
}

/** Migrate an idle owned chat only along an explicit redirect to its exact policy. */
export async function reconcileSessionModelPolicy(
  ctx: Context,
  sessionId: SessionId,
  policy: QaSessionModelPolicy,
  current: {
    readonly status: string;
    readonly options: ModelSelectionFacts;
    readonly runMaintenance?: Agent["runMaintenance"];
  },
  replacements: readonly QaModelReplacement[],
  logger: PluginLogger,
): Promise<boolean> {
  const { provider, model } = current.options;
  if (
    current.status !== "idle" ||
    current.runMaintenance === undefined ||
    policy.pair === undefined ||
    provider === undefined ||
    model === undefined ||
    modelPolicySatisfied(policy, current.options)
  )
    return false;
  const old = { provider, model };
  const redirected = replaceModelPair(old, replacements);
  if (
    redirected === old ||
    redirected === undefined ||
    redirected.provider !== policy.pair.provider ||
    redirected.model !== policy.pair.model
  )
    return false;
  await current.runMaintenance(async (signal) => {
    signal.throwIfAborted();
    await applySessionModelPolicy(ctx, sessionId, policy, logger);
  });
  logger.info("session.model-migrated", {
    sessionId: String(sessionId),
    fromProvider: provider,
    fromModel: model,
    provider: redirected.provider,
    model: redirected.model,
  });
  return true;
}
