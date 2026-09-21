/**
 * The approval seam, read only where it decides an outcome (SPEC §17).
 *
 * `{ kind: "ask" }` is not a decision this gate keeps. The tool runtime
 * resolves it through the `approval` service, whose closed outcome vocabulary
 * (`allowed-once | rejected | cancelled | unavailable`) carries no reason: the
 * runtime maps each outcome to its own sentence, so `rejected` becomes
 * `the user rejected tool "X"` and whatever the gate wrote in `ask.reason` is
 * dropped (`packages/core/tools/src/index.ts`, `serviceAsk`).
 *
 * Under a session whose effective policy is `never` the service returns
 * `rejected` *before* dispatching to any answerer — deterministically, with
 * nobody asked. An ask is therefore a refusal already decided, and its
 * sentence blames a human for a rule of ours. A gate that can read the same
 * policy the service reads — the session's logged override, else the
 * deployment default — can refuse with its own verdict and keep its reason
 * visible to the model.
 *
 * The seam is optional and the read fails soft on purpose: **only a policy
 * this gate actually read can turn an ask into a refusal.** A host composing no
 * approval service, a session that could not be read at all, and a value
 * outside the published vocabulary all leave the ask exactly as it was, to be
 * resolved by the runtime through the real seam. Guessing "nobody can answer"
 * would refuse calls on the strength of a read that did not complete.
 */

/** The approval policies the harness publishes. */
export type ApprovalPolicy = "ask" | "never";

/**
 * Structural face of the `approval` service: the two reads that decide one ask.
 * `overrideOf(session)` is the session's logged policy and `config.policy` the
 * configured default — the same pair `ApprovalService.effectivePolicy` folds.
 */
export interface ApprovalFace {
  readonly config?: { readonly policy?: ApprovalPolicy };
  overrideOf?(session: unknown): ApprovalPolicy | undefined;
}

function isPolicy(value: unknown): value is ApprovalPolicy {
  return value === "ask" || value === "never";
}

/**
 * The policy every ask for this session resolves under right now, as far as
 * this gate can tell: the session's logged override, else the deployment
 * default — the same fold `ApprovalService.effectivePolicy` performs.
 * @param face - the host's approval service, or undefined when it composes none.
 * @param session - the asking agent's session; ignored when absent.
 * @returns the effective policy, or undefined when no policy was read.
 */
export function effectiveApprovalPolicy(
  face: ApprovalFace | undefined,
  session: unknown,
): ApprovalPolicy | undefined {
  if (face === undefined) return undefined;
  if (session !== undefined && face.overrideOf !== undefined) {
    let override: unknown;
    try {
      override = face.overrideOf(session);
    } catch {
      // The session could not be read, so its policy is unknown rather than
      // defaulted: an ask is never refused on a read that did not complete.
      return undefined;
    }
    if (isPolicy(override)) return override;
  }
  const configured = face.config?.policy;
  return isPolicy(configured) ? configured : undefined;
}

/**
 * True when the session's effective policy answers every ask with `rejected`
 * before any answerer runs: the ask cannot reach a human, and the runtime's
 * refusal would name one anyway. An unknown seam is never "nobody".
 */
export function askIsAutoRejected(
  face: ApprovalFace | undefined,
  session: unknown,
): boolean {
  return effectiveApprovalPolicy(face, session) === "never";
}
