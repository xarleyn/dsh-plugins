import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import {
  assertModelPairAvailable,
  projectModelCatalog,
  type QaSessionModelPolicy,
} from "./access/model-policy.js";
import type { QaModelPair } from "./types.js";

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
  });
  return pair;
}
