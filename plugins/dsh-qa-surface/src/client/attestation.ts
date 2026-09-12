import type { QaLockdownProof, ResolvedQaSurfaceConfig } from "../types.js";

/** The `(reason: <code>)` marker the Host folds into attestation wire failures. */
const ATTESTATION_REASON_MARKER = /\(reason: ([a-z-]+)\)/u;

/**
 * Browser-side reading of Host policy attestation: one error type the session
 * lifecycle branches on, plus pure diagnostics for the console. The specific
 * mismatch facts stay in the Host logs; a refusal only reveals the coarse
 * reason class and an operator hint.
 */
export class QaPolicyAttestationError extends Error {
  constructor() {
    super("QA session policy could not be attested.");
    this.name = "QaPolicyAttestationError";
  }
}

/**
 * Extract the coarse attestation reason code from a Host wire failure, if the
 * failure carries the marker.
 */
export function attestationReasonOf(
  failure:
    | {
        readonly message?: string;
      }
    | undefined
    | null,
): string | null {
  const match = ATTESTATION_REASON_MARKER.exec(failure?.message ?? "");
  const reason = match?.[1];
  return reason === undefined ? null : reason;
}

export function attestationHint(reason: string | null): string {
  if (reason === "unknown-tools") {
    return "A lockdown.toolPolicy name is not mounted in this session's tool catalog — check the deployment agent preset and the tool's server availability.";
  }
  if (reason === "workspace-unavailable") {
    return "The configured session.workspaceId does not match a registered workspace - create the workspace or fix the id (session.cwd is the no-registry alternative).";
  }
  if (reason === "composition-mismatch") {
    return "The session's agent preset, workspace or model no longer matches the deployment QA config.";
  }
  if (reason === "permission-preset") {
    return "The configured permission preset did not resolve to the pinned sandbox/approval policy.";
  }
  if (reason === "adoption-refused") {
    return "This browser tried to adopt a session created outside the current QA policy.";
  }
  if (reason === "session-owned-elsewhere") {
    return "The session belongs to another QA account; the deployment's ownership map refused this browser.";
  }
  if (reason === "auth-required") {
    return "The account token is absent, expired or rotated - sign in again through the QA gate.";
  }
  return "The specific mismatch facts are written to the Host logs.";
}

/**
 * Whether a Host proof answers the deployment lockdown config this browser
 * holds. Every field must match; the allow-list is compared as exact JSON so
 * order differences refuse too, mirroring the Host's pinned list.
 */
export function proofMatchesConfig(
  proof: QaLockdownProof,
  lockdown: ResolvedQaSurfaceConfig["lockdown"],
  sessionId: string,
): boolean {
  return (
    proof.sessionId === sessionId &&
    proof.enabled &&
    proof.agentPresetMatches &&
    proof.workspaceMatches &&
    proof.modelMatches &&
    proof.sandboxModeMatches &&
    proof.approvalIsNever &&
    proof.permissionPreset === lockdown.permissionPreset &&
    proof.toolPolicyLoaded &&
    JSON.stringify(proof.toolAllowList) ===
      JSON.stringify(lockdown.toolPolicy.allow)
  );
}
