import { readFileSync, statSync } from "node:fs";
import { IntegrationError } from "../errors.js";
import {
  digest,
  profilePolicyRevision,
  type ManagedServiceCredentialProfileConfig,
  type ManagedServiceCredentialsConfig,
} from "./config.js";
import type {
  ResolvedServiceCredential,
  ServiceCredentialProfile,
} from "./types.js";

interface CachedSecret {
  readonly revision: string;
  readonly secret: string;
  /** File stamp the cached value was read at; ignored for environment values. */
  readonly mtimeMs: number;
  readonly size: number;
}

/**
 * Deployment-owned service credentials. Profiles come from operator
 * configuration, their secrets from a mounted file or the environment, and
 * nothing here is reachable from a user: a user cannot create a profile, change
 * a secret, move an upstream identity or choose a profile by id.
 *
 * Secrets are read lazily and cached by file stamp, so rotating a mounted
 * secret takes effect on the next call without anyone reconnecting and without
 * restarting the host.
 */
export class ServiceCredentialRegistry {
  private readonly profiles: readonly ServiceCredentialProfile[];
  private readonly byPortal = new Map<string, ServiceCredentialProfile>();
  private readonly secrets = new Map<string, CachedSecret>();
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    config: ManagedServiceCredentialsConfig,
    resolvePortal: (provider: string, instance: string) => string | undefined,
    options: { readonly env?: NodeJS.ProcessEnv } = {},
  ) {
    this.env = options.env ?? process.env;
    const seen = new Set<string>();
    this.profiles = Object.freeze(
      config.profiles.map((profile) => {
        const portal = resolvePortal(profile.provider, profile.instance);
        if (portal === undefined || portal === "") {
          throw new Error(
            `qa-integrations managed service credentials: profile ${profile.id} names unknown ${profile.provider} instance "${profile.instance}"`,
          );
        }
        const resolved: ServiceCredentialProfile = Object.freeze({
          id: profile.id,
          provider: profile.provider,
          instance: profile.instance,
          portal,
          label: profile.label,
          authType: profile.authType,
          secretRef: profile.secretRef,
          enabled: profile.enabled,
          resources: profile.resources,
          policy: profile.policy,
          policyRevision: profilePolicyRevision(profile),
        });
        const key = portalKey(profile.provider, portal);
        if (seen.has(key)) {
          throw new Error(
            `qa-integrations managed service credentials: two profiles bind ${profile.provider} instance "${profile.instance}"`,
          );
        }
        seen.add(key);
        this.byPortal.set(key, resolved);
        return resolved;
      }),
    );
  }

  /** The profile a binding of this provider and portal resolves to, if any. */
  find(provider: string, portal: string): ServiceCredentialProfile | undefined {
    return this.byPortal.get(portalKey(provider, portal));
  }

  /** True when this provider/portal can offer service mode at all. */
  available(provider: string, portal: string): boolean {
    return this.find(provider, portal)?.enabled === true;
  }

  list(): readonly ServiceCredentialProfile[] {
    return this.profiles;
  }

  /**
   * The secret of one profile plus the revision of its content. Throwing here
   * is the fail-closed path: a profile whose secret is missing, empty or
   * unreadable serves nothing, and the message names the reference, never the
   * value.
   */
  readSecret(profile: ServiceCredentialProfile): ResolvedServiceCredential {
    const cached = this.load(profile);
    return {
      profile,
      secret: cached.secret,
      credentialRevision: cached.revision,
    };
  }

  /** Drop a cached secret; the next read re-reads it. Used by rotation tests. */
  forget(profileId: string): void {
    this.secrets.delete(profileId);
  }

  private load(profile: ServiceCredentialProfile): CachedSecret {
    if (profile.secretRef.startsWith("env:")) {
      return this.loadEnv(profile, profile.secretRef.slice("env:".length));
    }
    return this.loadFile(profile, profile.secretRef.slice("file:".length));
  }

  private loadEnv(
    profile: ServiceCredentialProfile,
    name: string,
  ): CachedSecret {
    const raw = this.env[name];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") {
      throw new IntegrationError(
        "ServiceCredentialUnavailable",
        `Service credential ${profile.id} is not available`,
      );
    }
    const revision = digest(value);
    const cached = this.secrets.get(profile.id);
    if (cached !== undefined && cached.revision === revision) return cached;
    const next: CachedSecret = {
      revision,
      secret: value,
      mtimeMs: 0,
      size: 0,
    };
    this.secrets.set(profile.id, next);
    return next;
  }

  private loadFile(
    profile: ServiceCredentialProfile,
    filePath: string,
  ): CachedSecret {
    let stamp: { readonly mtimeMs: number; readonly size: number };
    try {
      const stat = statSync(filePath);
      stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      throw new IntegrationError(
        "ServiceCredentialUnavailable",
        `Service credential ${profile.id} is not available`,
      );
    }
    const cached = this.secrets.get(profile.id);
    if (
      cached !== undefined &&
      cached.mtimeMs === stamp.mtimeMs &&
      cached.size === stamp.size
    ) {
      return cached;
    }
    let value: string;
    try {
      value = readFileSync(filePath, "utf8").trim();
    } catch {
      throw new IntegrationError(
        "ServiceCredentialUnavailable",
        `Service credential ${profile.id} is not available`,
      );
    }
    if (value === "") {
      throw new IntegrationError(
        "ServiceCredentialUnavailable",
        `Service credential ${profile.id} is not available`,
      );
    }
    const next: CachedSecret = {
      revision: digest(value),
      secret: value,
      mtimeMs: stamp.mtimeMs,
      size: stamp.size,
    };
    this.secrets.set(profile.id, next);
    return next;
  }
}

/** Profiles are matched by provider and portal, never by a caller-chosen id. */
export function portalKey(provider: string, portal: string): string {
  return `${provider}\u0000${portal}`;
}

/** Config-shape of one profile, re-exported for the config composition root. */
export type { ManagedServiceCredentialProfileConfig };
