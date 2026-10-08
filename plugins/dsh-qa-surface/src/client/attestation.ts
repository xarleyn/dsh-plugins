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
  constructor(readonly reason: string | null = null) {
    super("QA session policy could not be attested.");
    this.name = "QaPolicyAttestationError";
  }
}

/**
 * Refusals that classify what the browser has on screen rather than faulting
 * the deployment: an existing chat of an older composition, one adopted from
 * outside the QA policy, or an identity that is another conversation's
 * delegated child.
 *
 * Keeping only its transcript is safe: policyReady stays false, so no prompt,
 * cancel, approval or question reaches the Host.
 */
export function canOpenAsCompatibilityReadOnly(reason: string | null): boolean {
  return (
    reason === "composition-mismatch" ||
    reason === "agent-unavailable" ||
    reason === "adoption-refused" ||
    reason === "subagent-session"
  );
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
  if (reason === "agent-unavailable") {
    return "This chat's transcript is on the Host, but no agent stands behind it: resuming the composition its session recorded failed — a preset that no longer mounts, or a log the Host refuses to read. That is not what a restarted stand looks like; after a restart the next open simply resumes the chat. The failing session is named in the Host log under `session.agent-resolve-rejected` — re-mount the preset that session recorded and re-open the chat, while New chat gives the visitor a working one meanwhile.";
  }
  if (reason === "subagent-session") {
    return "The id this page asked about is a delegated subagent run, not a chat: subagent routing owns that identity, so the Host puts no sendable agent behind it and nothing can be attested here. Read the run from its parent chat's work group — its sources already reach that chat. If a chat row of this browser leads here, it points at a child: start a new chat and leave that id behind.";
  }
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
    return "The configured permission preset did not resolve to the pinned sandbox/approval policy. Keep approval=never even when interaction.approvals is interactive; QA parks composed tool-gate requests itself.";
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
  if (proof.sessionId !== sessionId) return false;
  if (!lockdown.enabled) {
    // A lockdown that is off pins nothing, so the Host answers with the
    // vacuous proof and there are no facts here to compare: which session it
    // admitted is all this call can say, and the admission itself — account
    // identity and ownership, which the Host checks whatever the lockdown
    // state — is the reason the browser asks.
    return true;
  }
  return (
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
