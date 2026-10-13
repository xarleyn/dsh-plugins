import {
  serviceOperationAccess,
  type ServiceOperationSelection,
} from "./operation-policy.js";
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
  selection: ServiceOperationSelection = {},
): CapabilityServiceState {
  let allowed = 0;
  let refused = 0;
  let sensitive = false;
  for (const [operation, definition] of Object.entries(operations)) {
    if (definition.capability !== capability) continue;
    const access = serviceOperationAccess(definition.security, {
      ...selection,
      operation,
      capability,
    });
    if (access === "allow") allowed += 1;
    else {
      refused += 1;
      sensitive ||= access === "sensitive" || access === "secret";
    }
  }
  if (allowed > 0) return refused > 0 ? "partial" : "available";
  return sensitive ? "sensitive" : "unavailable";
}
