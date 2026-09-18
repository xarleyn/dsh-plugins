import type { OperationSecurityMetadata } from "./types.js";
import type { CapabilityServiceState } from "../types.js";

/**
 * How one capability of a provider behaves under the managed credential,
 * derived from the classifications of the operations that make it up. A
 * capability with no classified operation — or one whose provider never listed
 * it — is reported as unavailable, so a client never shows a switch that would
 * do nothing.
 */
export function operationCapabilityServiceState(
  operations: Readonly<
    Record<
      string,
      {
        readonly capability: string;
        readonly security: OperationSecurityMetadata;
      }
    >
  >,
  capability: string,
): CapabilityServiceState {
  let seen = false;
  let sensitive = false;
  for (const definition of Object.values(operations)) {
    if (definition.capability !== capability) continue;
    seen = true;
    const { effect, sensitivity, serviceCredential } = definition.security;
    if (effect !== "read" || serviceCredential !== "allow") {
      // A write, an admin action or an explicitly denied operation makes the
      // whole capability unreachable through a shared credential; a sensitive
      // read only makes it personal-only, because sensitive reads stay
      // available to the user's own account.
      if (effect !== "read" || sensitivity === "normal") return "unavailable";
      sensitive = true;
    }
  }
  if (!seen) return "unavailable";
  return sensitive ? "sensitive" : "available";
}
