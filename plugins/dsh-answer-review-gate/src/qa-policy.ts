/**
 * The QA model policy, read structurally from the host's QA surface.
 *
 * Declared as a shape rather than imported from `@yadsh/dsh-qa-surface`, for
 * the reason that plugin's own principal lookup is declared structurally
 * there: this gate runs in deployments with no QA surface at all, and there the
 * reviewer's own configuration is the whole answer rather than an error. The
 * method is optional for the same reason — an installed QA surface older than
 * the policy reads as "no opinion", which is what it says.
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
 * The pair the QA policy fixes for one chat, or `undefined`.
 *
 * `undefined` covers every case where the deployment has said nothing about
 * models: no surface, a surface without the read, a chat the accounts store
 * does not know, and a role that inherits the stand's pair while the stand names
 * none. The caller then keeps its own configuration.
 *
 * @param surface - the value mounted under `qaSurface`.
 * @param sessionId - the chat the reviewer answers for.
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
