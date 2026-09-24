import type {
  IntegrationProviderId,
  IntegrationServiceBoundary,
  ServiceCredentialHealth,
  ServiceCredentialStatus,
  SafeExternalIdentity,
} from "../types.js";

export type {
  ServiceCredentialHealth,
  ServiceCredentialStatus,
  SafeExternalIdentity,
};

/**
 * Which credential a binding spends on an upstream call. The mode is explicit
 * and exhaustive: there is no `auto`, no `default` and no fallback, because a
 * silent substitution between two upstream identities is exactly the failure
 * this feature exists to prevent.
 */
export type CredentialSource = "personal" | "service";

export const CREDENTIAL_SOURCES: readonly CredentialSource[] = Object.freeze([
  "personal",
  "service",
]);

export function isCredentialSource(value: unknown): value is CredentialSource {
  return value === "personal" || value === "service";
}

/** What an operation does upstream; only `read` can ever be service-reachable. */
export type OperationEffect = "read" | "write" | "admin";

/** How much an answer may reveal; sensitive and secret answers stay personal. */
export type DataSensitivity = "normal" | "sensitive" | "secret";

/** Whether the deployment's managed credential may reach one operation. */
export type OperationServiceDecision = "allow" | "deny";

/**
 * Security classification of one provider operation. The three fields are
 * independent on purpose: a read can still be sensitive (CI job logs), and a
 * normal-sensitivity read can still be outside the service ceiling.
 */
export interface OperationSecurityMetadata {
  readonly effect: OperationEffect;
  readonly sensitivity: DataSensitivity;
  readonly serviceCredential: OperationServiceDecision;
  /**
   * Set when the operation either names a resource or reads a collection of
   * them: in service mode the call must then stay inside the profile's
   * administrator-defined resource boundary.
   */
  readonly requiresResourceBoundary?: boolean;
}

/**
 * Classification of an operation its provider does not classify. Deliberately
 * the most restrictive values in every field, so an operation added by a
 * provider update is unreachable through the managed credential until someone
 * classifies it on purpose. This is a release-blocking invariant.
 */
export const UNCLASSIFIED_OPERATION: OperationSecurityMetadata = Object.freeze({
  effect: "admin",
  sensitivity: "secret",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
});

/**
 * Resources a managed credential may see. One type, declared with the public
 * contract because it crosses the remote boundary as well.
 */
export type ServiceResourceBoundary = IntegrationServiceBoundary;

/**
 * Request ceiling of the service mode, as operator configuration resolves it.
 * A rate of `0` leaves that dimension unbounded.
 */
export interface ServiceRateLimitConfig {
  /** What one real user may ask of one provider through any managed credential. */
  readonly perPrincipal: {
    readonly requestsPerMinute: number;
  };
  /**
   * What one shared upstream identity may carry in total, and how many calls
   * may be in flight against it at once.
   */
  readonly perCredential: {
    readonly requestsPerMinute: number;
    readonly maxConcurrent: number;
  };
}

/**
 * One administrator-managed credential. It belongs to the deployment, not to a
 * user: a user cannot create one, cannot change its secret, cannot move its
 * upstream identity and cannot pick one by id.
 */
export interface ServiceCredentialProfile {
  readonly id: string;
  readonly provider: IntegrationProviderId;
  /** Operator-facing instance id of the provider slice this profile binds to. */
  readonly instance: string;
  /** Portal the bound instance answers on; the value a binding is matched by. */
  readonly portal: string;
  /** Safe alias shown to users; never the secret and never its prefix. */
  readonly label: string;
  readonly authType: string;
  /** Where the secret is read from, as `file:<path>` or `env:<NAME>`. */
  readonly secretRef: string;
  /** Set to false to retire a profile without deleting its configuration. */
  readonly enabled: boolean;
  readonly resources: ServiceResourceBoundary;
  /** Administrator narrowing of the service ceiling; only ever removes. */
  readonly policy: Readonly<Record<string, "deny">>;
  /** Hash of the policy-relevant configuration of this profile. */
  readonly policyRevision: string;
}

/** A profile plus the secret an upstream call needs, produced inside the broker. */
export interface ResolvedServiceCredential {
  readonly profile: ServiceCredentialProfile;
  readonly secret: string;
  /** Content hash of the secret: rotation changes it without reconnecting. */
  readonly credentialRevision: string;
}

/**
 * What the broker hands a provider after it has resolved and checked the
 * binding. Provider tool arguments do not change, and the model never receives
 * any of these identifiers.
 */
export interface ResolvedCredentialContext {
  readonly source: CredentialSource;
  readonly credentialRevision: string;
  readonly personal?: {
    readonly accountId: string;
    readonly externalIdentityId: string;
  };
  readonly service?: {
    readonly profileId: string;
    readonly externalIdentityId: string;
    readonly policyRevision: string;
    readonly resourceBoundary: ServiceResourceBoundary;
  };
}
