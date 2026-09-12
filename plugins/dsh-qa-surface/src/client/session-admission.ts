import {
  attestationHint,
  attestationReasonOf,
  proofMatchesConfig,
} from "./attestation.js";
import type { QaSecureSession } from "./types.js";
import type { ResolvedQaSurfaceConfig } from "../types.js";

export type QaAttestationOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** The identity is absent or expired; the caller returns to the gate. */
      readonly authRequired: boolean;
      readonly reason: string | null;
    };

/**
 * One send-time policy attestation against the Host admission gate. The
 * QA-facing message stays generic by design; the coarse reason plus an
 * operator hint go to the console once per refusal.
 */
export async function attestQaPolicy(args: {
  readonly secureSession: QaSecureSession;
  readonly token: string;
  readonly sessionId: string;
  readonly lockdown: ResolvedQaSurfaceConfig["lockdown"];
  readonly report: boolean;
}): Promise<QaAttestationOutcome> {
  try {
    const result = await args.secureSession(args.token, args.sessionId);
    if (!result.ok) {
      const reason = attestationReasonOf(
        result.error as { readonly message?: string },
      );
      if (reason === "auth-required") {
        if (args.report) {
          console.error(
            "dsh-qa-surface: policy attestation failed (reason: auth-required). The account token is absent or expired.",
          );
        }
        return { ok: false, authRequired: true, reason };
      }
      return reject(args, reason);
    }
    if (!proofMatchesConfig(result.value, args.lockdown, args.sessionId)) {
      return reject(args, "proof-mismatch");
    }
    return { ok: true };
  } catch (error) {
    if (args.report) {
      console.error("dsh-qa-surface: policy attestation request failed", error);
    }
    return { ok: false, authRequired: false, reason: null };
  }
}

function reject(
  args: { readonly report: boolean },
  reason: string | null,
): QaAttestationOutcome {
  if (args.report) {
    console.error(
      `dsh-qa-surface: policy attestation failed (reason: ${reason ?? "unknown"}). ${attestationHint(reason)}`,
    );
  }
  return { ok: false, authRequired: false, reason };
}
