import { createHash } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { scopedConfigError } from "../errors.js";
import type { ServiceRateLimitConfig } from "./types.js";

/**
 * One deployment-managed credential, as it appears under
 * `managedServiceCredentials.profiles[]` in YAML. Everything here is operator
 * input, so a typo fails loudly at load: a silently dropped profile would leave
 * users with a provider they cannot use through the managed path and no
 * explanation.
 */
export interface ManagedServiceCredentialProfileInput {
  readonly id?: string;
  readonly provider?: string;
  /**
   * Operator-facing instance id of the provider slice this credential belongs
   * to — the same id the connect form offers, such as a GitLab `instances[].id`.
   */
  readonly instance?: string;
  /** Safe alias shown to users, e.g. "QA GitLab Read-only". */
  readonly label?: string;
  /** Set to false to retire a profile without deleting its configuration. */
  readonly enabled?: boolean;
  readonly credential?: {
    readonly type?: string;
    readonly secretFile?: string;
    readonly secretEnv?: string;
  };
  /** Administrator-defined resource boundary; at least one kind is required. */
  readonly resources?: Readonly<
    Record<string, readonly (string | number)[] | undefined>
  >;
  /** Administrator narrowing of the service ceiling. Only `deny` is accepted. */
  readonly policy?: Readonly<Record<string, string | undefined>>;
}

/**
 * Operator request ceiling of the service mode; §27 of
 * `docs/specs/managed-service-credentials.md`.
 */
export interface ManagedServiceRateLimitInput {
  readonly perPrincipal?:
    { readonly requestsPerMinute?: number | undefined } | undefined;
  readonly perCredential?:
    | {
        readonly requestsPerMinute?: number | undefined;
        readonly maxConcurrent?: number | undefined;
      }
    | undefined;
}

export interface ManagedServiceCredentialsInput {
  readonly enabled?: boolean;
  /** Whether a new connection starts in service mode when a profile exists. */
  readonly defaultForNewConnections?: boolean;
  readonly profiles?: readonly ManagedServiceCredentialProfileInput[];
  readonly rateLimit?: ManagedServiceRateLimitInput | undefined;
}

export interface ManagedServiceCredentialProfileConfig {
  readonly id: string;
  readonly provider: string;
  readonly instance: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly authType: string;
  readonly secretRef: string;
  readonly resources: Readonly<Record<string, readonly string[]>>;
  readonly policy: Readonly<Record<string, "deny">>;
}

export interface ManagedServiceCredentialsConfig {
  readonly enabled: boolean;
  readonly defaultForNewConnections: boolean;
  readonly profiles: readonly ManagedServiceCredentialProfileConfig[];
  readonly rateLimit: ServiceRateLimitConfig;
}

/**
 * The design document's own §27 example, used as the shipped ceiling: a service
 * credential is shared, so an unconfigured deployment is the case that needs
 * the limit most. An operator who wants a dimension unbounded sets it to `0`.
 */
export const DEFAULT_SERVICE_RATE_LIMIT: ServiceRateLimitConfig = Object.freeze(
  {
    perPrincipal: Object.freeze({ requestsPerMinute: 120 }),
    perCredential: Object.freeze({
      requestsPerMinute: 1000,
      maxConcurrent: 16,
    }),
  },
);

export const MANAGED_SERVICE_CREDENTIALS_DEFAULTS = Object.freeze({
  enabled: false,
  defaultForNewConnections: true,
});

/**
 * Config schema of this slice. Profile entries stay opaque here on purpose:
 * `resolveManagedServiceCredentials` validates them in one place, where it can
 * fail loudly with the profile id in the message instead of an anonymous
 * schema error.
 */
export const managedServiceCredentialsSchema = z.object({
  enabled: z.boolean().default(MANAGED_SERVICE_CREDENTIALS_DEFAULTS.enabled),
  defaultForNewConnections: z
    .boolean()
    .default(MANAGED_SERVICE_CREDENTIALS_DEFAULTS.defaultForNewConnections),
  profiles: z.array(z.any()).default([]),
  rateLimit: z.any().default(undefined),
}) as unknown as z<ManagedServiceCredentialsInput>;

const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const RESOURCE_KIND = /^[a-z][a-z0-9_]{0,31}$/u;
const SECRET_ENV = /^[A-Z][A-Z0-9_]{0,63}$/u;
const MAX_PROFILES = 64;
const MAX_RESOURCES_PER_KIND = 512;
const MAX_REQUESTS_PER_MINUTE = 1_000_000;
const MAX_CONCURRENT = 4096;

const configError = scopedConfigError(
  "qa-integrations managed service credentials",
);

function nonEmpty(value: unknown, what: string, index: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") throw configError(`profiles[${index}].${what} is required`);
  return text;
}

/**
 * One resource list of a profile. Values are the identifiers the provider
 * itself accepts in a call — a GitLab project id or full path, a TeamCity
 * project id — so the boundary and a tool argument compare as strings.
 */
function normalizeResources(
  input: ManagedServiceCredentialProfileInput["resources"],
  id: string,
): Readonly<Record<string, readonly string[]>> {
  const kinds: Record<string, readonly string[]> = {};
  for (const [rawKind, values] of Object.entries(input ?? {})) {
    const kind = rawKind.trim();
    if (!RESOURCE_KIND.test(kind)) {
      throw configError(
        `profile ${id} has an invalid resource kind "${rawKind}"`,
      );
    }
    if (!Array.isArray(values)) {
      throw configError(`profile ${id}.resources.${kind} must be a list`);
    }
    if (values.length > MAX_RESOURCES_PER_KIND) {
      throw configError(
        `profile ${id}.resources.${kind} accepts at most ${MAX_RESOURCES_PER_KIND} entries`,
      );
    }
    const refs: string[] = [];
    for (const value of values) {
      const ref =
        typeof value === "number" && Number.isFinite(value)
          ? String(value)
          : typeof value === "string"
            ? value.trim()
            : "";
      if (ref === "") {
        throw configError(
          `profile ${id}.resources.${kind} entries must be non-empty strings or numbers`,
        );
      }
      if (!refs.includes(ref)) refs.push(ref);
    }
    if (refs.length === 0) {
      throw configError(`profile ${id}.resources.${kind} is empty`);
    }
    kinds[kind] = Object.freeze(refs);
  }
  if (Object.keys(kinds).length === 0) {
    // A managed credential without a resource boundary would see everything its
    // upstream identity sees, which is the opposite of the model this feature
    // implements. Refusing here keeps that invariant a load-time one.
    throw configError(
      `profile ${id} must define a resource boundary (resources.<kind>)`,
    );
  }
  return Object.freeze(kinds);
}

/**
 * Administrator policy of one profile. The service ceiling is a hard maximum,
 * so this map may only remove: a key set to anything but `deny` is rejected
 * rather than ignored, because an operator who wrote `allow` believes they
 * widened something.
 */
function normalizePolicy(
  input: ManagedServiceCredentialProfileInput["policy"],
  id: string,
): Readonly<Record<string, "deny">> {
  const policy: Record<string, "deny"> = {};
  for (const [rawKey, value] of Object.entries(input ?? {})) {
    const key = rawKey.trim();
    if (key === "") {
      throw configError(`profile ${id} has an empty policy key`);
    }
    if (value !== "deny") {
      throw configError(
        `profile ${id}.policy["${rawKey}"] must be "deny": the service ceiling can only be narrowed`,
      );
    }
    policy[key] = "deny";
  }
  return Object.freeze(policy);
}

/**
 * One ceiling number. A limit is protection, so a typo here must not quietly
 * remove it: anything that is not a plain non-negative integer is refused at
 * load, and only `0` means "this dimension is unbounded".
 */
function normalizeCeiling(
  value: unknown,
  path: string,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw configError(`rateLimit.${path} must be a non-negative integer`);
  }
  if (value > maximum) {
    throw configError(`rateLimit.${path} accepts at most ${maximum}`);
  }
  return value;
}

function normalizeRateLimit(
  input: ManagedServiceRateLimitInput | undefined,
): ServiceRateLimitConfig {
  if (
    input !== undefined &&
    (typeof input !== "object" || Array.isArray(input))
  ) {
    throw configError("rateLimit must be a mapping");
  }
  const perPrincipal = input?.perPrincipal;
  if (
    perPrincipal !== undefined &&
    (typeof perPrincipal !== "object" ||
      perPrincipal === null ||
      Array.isArray(perPrincipal))
  ) {
    throw configError("rateLimit.perPrincipal must be a mapping");
  }
  const perCredential = input?.perCredential;
  if (
    perCredential !== undefined &&
    (typeof perCredential !== "object" ||
      perCredential === null ||
      Array.isArray(perCredential))
  ) {
    throw configError("rateLimit.perCredential must be a mapping");
  }
  return Object.freeze({
    perPrincipal: Object.freeze({
      requestsPerMinute: normalizeCeiling(
        perPrincipal?.requestsPerMinute,
        "perPrincipal.requestsPerMinute",
        MAX_REQUESTS_PER_MINUTE,
        DEFAULT_SERVICE_RATE_LIMIT.perPrincipal.requestsPerMinute,
      ),
    }),
    perCredential: Object.freeze({
      requestsPerMinute: normalizeCeiling(
        perCredential?.requestsPerMinute,
        "perCredential.requestsPerMinute",
        MAX_REQUESTS_PER_MINUTE,
        DEFAULT_SERVICE_RATE_LIMIT.perCredential.requestsPerMinute,
      ),
      maxConcurrent: normalizeCeiling(
        perCredential?.maxConcurrent,
        "perCredential.maxConcurrent",
        MAX_CONCURRENT,
        DEFAULT_SERVICE_RATE_LIMIT.perCredential.maxConcurrent,
      ),
    }),
  });
}

function normalizeProfile(
  input: ManagedServiceCredentialProfileInput,
  index: number,
  seen: Set<string>,
): ManagedServiceCredentialProfileConfig {
  const id = nonEmpty(input.id, "id", index);
  if (!PROFILE_ID.test(id)) {
    throw configError(
      `profiles[${index}].id must be lowercase latin, digits or dashes`,
    );
  }
  if (seen.has(id)) throw configError(`profiles[${index}].id is a duplicate`);
  seen.add(id);

  const provider = nonEmpty(input.provider, "provider", index);
  if (!PROVIDER_ID.test(provider)) {
    throw configError(`profiles[${index}].provider must be a provider id`);
  }
  const instance = nonEmpty(input.instance, "instance", index);

  const secretFile =
    typeof input.credential?.secretFile === "string"
      ? input.credential.secretFile.trim()
      : "";
  const secretEnv =
    typeof input.credential?.secretEnv === "string"
      ? input.credential.secretEnv.trim()
      : "";
  if (secretFile === "" && secretEnv === "") {
    throw configError(
      `profile ${id} needs credential.secretFile or credential.secretEnv`,
    );
  }
  if (secretFile !== "" && secretEnv !== "") {
    throw configError(
      `profile ${id} must set either credential.secretFile or credential.secretEnv, not both`,
    );
  }
  if (secretEnv !== "" && !SECRET_ENV.test(secretEnv)) {
    throw configError(
      `profile ${id}.credential.secretEnv must be an environment variable name`,
    );
  }

  const label = typeof input.label === "string" ? input.label.trim() : "";
  const authType =
    typeof input.credential?.type === "string" &&
    input.credential.type.trim() !== ""
      ? input.credential.type.trim()
      : "token";

  return Object.freeze({
    id,
    provider,
    instance,
    label: label === "" ? id : label,
    enabled: input.enabled ?? true,
    authType,
    secretRef: secretFile === "" ? `env:${secretEnv}` : `file:${secretFile}`,
    resources: normalizeResources(input.resources, id),
    policy: normalizePolicy(input.policy, id),
  });
}

export function resolveManagedServiceCredentials(
  input: ManagedServiceCredentialsInput = {},
): ManagedServiceCredentialsConfig {
  const profiles = input.profiles ?? [];
  if (!Array.isArray(profiles)) {
    throw configError("profiles must be a list");
  }
  if (profiles.length > MAX_PROFILES) {
    throw configError(`profiles accepts at most ${MAX_PROFILES} entries`);
  }
  const seen = new Set<string>();
  return Object.freeze({
    enabled: input.enabled ?? MANAGED_SERVICE_CREDENTIALS_DEFAULTS.enabled,
    defaultForNewConnections:
      input.defaultForNewConnections ??
      MANAGED_SERVICE_CREDENTIALS_DEFAULTS.defaultForNewConnections,
    profiles: Object.freeze(
      profiles.map((profile, index) => normalizeProfile(profile, index, seen)),
    ),
    rateLimit: normalizeRateLimit(input.rateLimit),
  });
}

/**
 * Revision of everything about a profile that policy decisions depend on. A
 * change here means every cache, cursor and pending action that was produced
 * under the previous revision has to be treated as stale.
 */
export function profilePolicyRevision(
  profile: ManagedServiceCredentialProfileConfig,
): string {
  return digest(
    JSON.stringify({
      id: profile.id,
      provider: profile.provider,
      portal: profile.instance,
      enabled: profile.enabled,
      resources: profile.resources,
      policy: profile.policy,
    }),
  );
}

/** Short content digest; used for revisions and never as a secret fingerprint. */
export function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
