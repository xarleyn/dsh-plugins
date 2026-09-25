import { IntegrationError, type IntegrationErrorCode } from "../../errors.js";
import { TLS_FAILURE, causeCode } from "./read-policy.js";

/**
 * The error policy shared by every provider: upstream failures fold into the
 * same safe domain errors — a refused permission stays distinct from a
 * missing resource, neither answer ever carries the upstream body, and the
 * status mapping is alike wherever two upstreams answer alike. A provider
 * supplies only the word it calls itself in a message and, where it answers
 * differently from the common rule, the statuses it reads differently.
 */

export interface StatusErrorPolicy {
  /** How the provider names itself in a folded message. */
  readonly label: string;
  /** The 401 wording; defaults to the stored token being rejected. */
  readonly rejectedCredential?: string;
  /** Statuses meaning "the call itself is wrong"; defaults to 400 and 422. */
  readonly invalidRequestStatuses?: readonly number[];
  /** A status the default mapping does not describe: its code and wording. */
  readonly overrides?: Readonly<
    Record<number, readonly [IntegrationErrorCode, string]>
  >;
}

/** The provider's status folding, in the shape `FetchRetryPolicy` takes. */
export function statusErrorOf(
  policy: StatusErrorPolicy,
): (response: Response) => IntegrationError {
  const { label } = policy;
  return (response) => {
    const status = response.status;
    const override = policy.overrides?.[status];
    if (override !== undefined) {
      return new IntegrationError(override[0], override[1]);
    }
    if (status === 401) {
      return new IntegrationError(
        "CredentialRevoked",
        policy.rejectedCredential ?? `${label} rejected the stored token`,
      );
    }
    if (status === 403) {
      return new IntegrationError(
        "ProviderPermissionDenied",
        `${label} denied this operation`,
      );
    }
    if (status === 404) {
      return new IntegrationError(
        "ResourceNotFound",
        `${label} resource not found`,
      );
    }
    if (status === 429) {
      return new IntegrationError("RateLimited", `${label} rate limit reached`);
    }
    if ((policy.invalidRequestStatuses ?? [400, 422]).includes(status)) {
      return new IntegrationError(
        "InvalidRequest",
        `${label} rejected the request`,
      );
    }
    return new IntegrationError(
      "ProviderUnavailable",
      `${label} request failed`,
    );
  };
}

export interface TransportFailurePolicy {
  /** How the provider names itself in a folded message. */
  readonly label: string;
  /** The wording of a connection failure that is neither timeout nor TLS. */
  readonly unreachable?: string;
}

/**
 * The provider's transport folding: this deployment's own deadline, a TLS
 * handshake the user cannot fix from the connect form, and everything else
 * that means the upstream is not answering.
 */
export function transportFailureOf(
  policy: TransportFailurePolicy,
): (error: unknown, timedOut: boolean) => IntegrationError {
  return (error, timedOut) =>
    timedOut
      ? new IntegrationError(
          "UpstreamTimeout",
          `${policy.label} did not answer`,
        )
      : TLS_FAILURE.test(causeCode(error))
        ? new IntegrationError(
            "TlsFailure",
            `${policy.label} TLS handshake failed`,
          )
        : new IntegrationError(
            "ProviderUnavailable",
            policy.unreachable ?? `${policy.label} request failed`,
          );
}
