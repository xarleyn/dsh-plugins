/**
 * Credential health, projected from a provider failure.
 *
 * Every provider answers its integration card's "is this credential still
 * usable?" question by classifying the safe error code it raised, and the
 * classification is the same for every upstream: an expired secret, a revoked
 * or denied one, and everything else, which is reported as unreachable instead
 * of guessed. Keeping one implementation here is what stops the three answers
 * from drifting apart between providers — the operator reads the same meaning
 * whichever upstream sits behind the failing provider.
 *
 * The projection reads only `IntegrationError` codes; a raw throw (a bug
 * outside the provider's folding) is unreachable, never a credential verdict.
 */

import { IntegrationError } from "../../errors.js";
import type { ServiceCredentialHealth } from "../../service-credentials/types.js";

/** Classify a provider failure into the health its settings card shows. */
export function healthFromFailure(error: unknown): ServiceCredentialHealth {
  if (!(error instanceof IntegrationError)) {
    return { status: "unreachable" };
  }
  switch (error.code) {
    case "CredentialExpired":
      return { status: "expired" };
    case "CredentialRevoked":
    case "ProviderPermissionDenied":
      return { status: "revoked" };
    default:
      return { status: "unreachable" };
  }
}
