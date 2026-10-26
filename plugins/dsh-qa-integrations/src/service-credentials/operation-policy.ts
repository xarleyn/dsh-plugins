import type { OperationSecurityMetadata } from "./types.js";

export type ServiceOperationPolicy = Readonly<Record<string, "allow" | "deny">>;

/** Server-owned profile policy; never taken from a tool's arguments. */
export interface ServiceOperationSelection {
  readonly provider?: string | undefined;
  readonly capability?: string | undefined;
  readonly operation?: string | undefined;
  readonly policy?: ServiceOperationPolicy | undefined;
}

export type ServiceOperationAccess =
  "allow" | "effect" | "secret" | "policy" | "sensitive" | "default";

/** Capability and operation aliases share one rule: any explicit deny wins. */
export function serviceOperationOverride(
  selection: ServiceOperationSelection,
): "allow" | "deny" | undefined {
  const keys = [selection.capability, selection.operation].filter(
    (key): key is string => key !== undefined,
  );
  if (selection.provider !== undefined)
    keys.push(...keys.map((key) => `${selection.provider}.${key}`));
  const values = keys.map((key) => selection.policy?.[key]);
  if (values.includes("deny")) return "deny";
  return values.includes("allow") ? "allow" : undefined;
}

/** Explicit allowances can open classified sensitive reads only. */
export function serviceOperationAccess(
  metadata: OperationSecurityMetadata | undefined,
  selection: ServiceOperationSelection = {},
): ServiceOperationAccess {
  if (metadata === undefined || metadata.effect !== "read") return "effect";
  if (metadata.sensitivity === "secret") return "secret";
  if (metadata.serviceOverrideAllowed === false)
    return metadata.sensitivity === "sensitive" ? "sensitive" : "default";
  const override = serviceOperationOverride(selection);
  if (override === "deny") return "policy";
  if (override === "allow") return "allow";
  if (metadata.sensitivity === "sensitive") return "sensitive";
  return metadata.serviceCredential === "allow" ? "allow" : "default";
}
