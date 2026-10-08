/**
 * The QA model policy, read structurally from the host's QA surface.
 *
 * Declared as a shape rather than imported from `@yadsh/dsh-qa-surface`: this
 * plugin runs in deployments with no QA surface at all, and there a worker
 * profile that names no model simply follows its parent, as it did before roles
 * had opinions about models. The method is optional for the same reason — an
 * installed QA surface older than the policy reads as "no opinion".
 */

/** One provider and model pair, as the QA policy names it. */
export interface QaModelPolicyPair {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

interface QaModelPolicySurface {
  modelPolicyForSession?(sessionId: string): QaModelPolicyPair | undefined;
}

/**
 * The pair the QA policy fixes for one chat, or `undefined` wherever nothing was
 * said about models: no surface, a surface without the read, a chat the accounts
 * store does not know, a role that inherits the stand's pair while the stand
 * names none.
 *
 * @param surface - the value mounted under `qaSurface`.
 * @param sessionId - the chat the tool result came from.
 */
export function qaModelPolicy(
  surface: unknown,
  sessionId: string,
): QaModelPolicyPair | undefined {
  if (typeof surface !== "object" || surface === null) return undefined;
  const candidate = surface as QaModelPolicySurface;
  if (typeof candidate.modelPolicyForSession !== "function") return undefined;
  const pair = candidate.modelPolicyForSession(sessionId);
  if (
    pair === undefined ||
    typeof pair.provider !== "string" ||
    pair.provider === "" ||
    typeof pair.model !== "string" ||
    pair.model === ""
  ) {
    return undefined;
  }
  return pair;
}
