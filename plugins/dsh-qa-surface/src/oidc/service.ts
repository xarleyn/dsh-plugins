import { timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import type { QaAccounts } from "../accounts/store.js";
import type {
  QaAccountRole,
  QaAccountSession,
  QaOidcStart,
  ResolvedQaSurfaceConfig,
} from "../types.js";

const TRANSACTION_TTL_MS = 5 * 60_000;
const HANDOFF_TTL_MS = 60_000;
const MAX_PENDING = 200;

interface Transaction {
  readonly expiresAt: number;
  readonly verifier: string;
  readonly nonce: string;
  readonly completionKey: string;
  readonly generation: number;
}

interface Identity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: QaAccountRole;
  readonly expiresAt: number;
  readonly autoProvision: boolean;
}

interface Handoff {
  readonly identity: Identity;
  readonly completionKey: string;
  readonly expiresAt: number;
  readonly generation: number;
}

/** A coarse refusal never carries provider responses, codes or tokens. */
export function oidcRefusal(): Error {
  return new Error(
    "Corporate sign-in failed. Please retry. (reason: forbidden)",
  );
}

function sameSecret(left: string, right: string): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

/** Authorization Code + PKCE with a browser-bound, single-use QA handoff. */
export class QaOidcService {
  private generation = 0;
  private key = "";
  private discovery: Promise<oidc.Configuration> | undefined;
  private readonly transactions = new Map<string, Transaction>();
  private readonly handoffs = new Map<string, Handoff>();
  private attempts: number[] = [];

  constructor(
    private readonly options: {
      config: () => ResolvedQaSurfaceConfig;
      accounts: () => QaAccounts | undefined;
      discover?: typeof oidc.discovery;
    },
  ) {}

  private sync(): ResolvedQaSurfaceConfig {
    const config = this.options.config();
    const settings = config.accounts.oidc;
    const secret = settings.clientSecretEnv
      ? process.env[settings.clientSecretEnv]
      : undefined;
    const key = JSON.stringify([
      settings,
      config.enabled,
      config.accounts.enabled,
      config.route.path,
      secret,
    ]);
    if (key !== this.key) {
      this.clear();
      this.key = key;
    }
    if (
      !config.enabled ||
      !config.accounts.enabled ||
      !settings.enabled ||
      (settings.clientSecretEnv && !secret)
    )
      throw oidcRefusal();
    return config;
  }

  clear(): void {
    this.generation++;
    this.discovery = undefined;
    this.transactions.clear();
    this.handoffs.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, tx] of this.transactions)
      if (tx.expiresAt <= now) this.transactions.delete(id);
    for (const [id, item] of this.handoffs)
      if (item.expiresAt <= now) this.handoffs.delete(id);
    this.attempts = this.attempts.filter((at) => at > now - 60_000);
  }

  private client(config: ResolvedQaSurfaceConfig): Promise<oidc.Configuration> {
    if (!this.discovery) {
      const settings = config.accounts.oidc;
      const secret = settings.clientSecretEnv
        ? process.env[settings.clientSecretEnv]
        : undefined;
      const request = (this.options.discover ?? oidc.discovery)(
        new URL(settings.issuer),
        settings.clientId,
        secret ? { client_secret: secret } : {},
        secret ? oidc.ClientSecretBasic(secret) : oidc.None(),
        { timeout: 10 },
      ).then((client) => {
        // TLS token endpoint validation alone is insufficient for our persisted identity.
        oidc.enableNonRepudiationChecks(client);
        return client;
      });
      this.discovery = request;
      void request.catch(() => {
        if (this.discovery === request) this.discovery = undefined;
      });
    }
    return this.discovery;
  }

  async start(): Promise<QaOidcStart> {
    try {
      const config = this.sync();
      this.prune();
      if (
        this.attempts.length >= config.accounts.maxAuthAttemptsPerMinute ||
        this.transactions.size + this.handoffs.size >= MAX_PENDING
      )
        throw oidcRefusal();
      this.attempts.push(Date.now());
      const generation = this.generation;
      const client = await this.client(config);
      this.sync();
      if (generation !== this.generation) throw oidcRefusal();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const completionKey = oidc.randomState();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      this.sync();
      if (generation !== this.generation) throw oidcRefusal();
      if (this.transactions.size + this.handoffs.size >= MAX_PENDING)
        throw oidcRefusal();
      this.transactions.set(state, {
        verifier,
        nonce,
        completionKey,
        generation,
        expiresAt: Date.now() + TRANSACTION_TTL_MS,
      });
      const authorizationUrl = oidc.buildAuthorizationUrl(client, {
        redirect_uri: config.accounts.oidc.redirectUri,
        scope: "openid profile email",
        response_mode: "query",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return { authorizationUrl: authorizationUrl.href, completionKey };
    } catch {
      throw oidcRefusal();
    }
  }

  /** Callback is reconstructed from configured origin, never Host/Forwarded headers. */
  async callback(requestUrl: string): Promise<string> {
    try {
      const config = this.sync();
      this.prune();
      const expected = new URL(config.accounts.oidc.redirectUri);
      const current = new URL(requestUrl, expected.origin);
      if (
        current.origin !== expected.origin ||
        current.pathname !== expected.pathname ||
        current.hash ||
        current.searchParams.getAll("state").length !== 1
      )
        throw oidcRefusal();
      const state = current.searchParams.get("state") ?? "";
      const tx = this.transactions.get(state);
      if (!tx || tx.generation !== this.generation) throw oidcRefusal();
      // Consume before network I/O: concurrent callbacks cannot redeem the same transaction.
      this.transactions.delete(state);
      const client = await this.client(config);
      const tokens = await oidc.authorizationCodeGrant(client, current, {
        pkceCodeVerifier: tx.verifier,
        expectedState: state,
        expectedNonce: tx.nonce,
        idTokenExpected: true,
      });
      this.sync();
      if (tx.generation !== this.generation || tx.expiresAt <= Date.now())
        throw oidcRefusal();
      const claims = tokens.claims();
      if (
        !claims ||
        claims.iss !== config.accounts.oidc.issuer ||
        typeof claims.sub !== "string" ||
        !claims.sub ||
        claims.sub.length > 512 ||
        claims.email_verified !== true ||
        typeof claims.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(claims.email) ||
        claims.email.length > 254
      )
        throw oidcRefusal();
      const resources = claims.resource_access as
        Record<string, { roles?: unknown }> | undefined;
      const rawRoles = resources?.[config.accounts.oidc.clientId]?.roles;
      const roles = Array.isArray(rawRoles)
        ? rawRoles.filter((role): role is string => typeof role === "string")
        : [];
      const settings = config.accounts.oidc;
      if (settings.requiredRole && !roles.includes(settings.requiredRole))
        throw oidcRefusal();
      const role: QaAccountRole =
        settings.adminRole && roles.includes(settings.adminRole)
          ? "admin"
          : settings.reviewerRole && roles.includes(settings.reviewerRole)
            ? "reviewer"
            : "user";
      const expiresAt = Math.min(
        claims.exp * 1000,
        Date.now() + settings.sessionTtlSeconds * 1000,
      );
      if (expiresAt <= Date.now()) throw oidcRefusal();
      const handoff = oidc.randomState();
      if (this.transactions.size + this.handoffs.size >= MAX_PENDING)
        throw oidcRefusal();
      this.handoffs.set(handoff, {
        completionKey: tx.completionKey,
        generation: tx.generation,
        expiresAt: Math.min(expiresAt, Date.now() + HANDOFF_TTL_MS),
        identity: {
          issuer: claims.iss,
          subject: claims.sub,
          email: claims.email.trim().toLowerCase(),
          displayName:
            typeof claims.name === "string" && claims.name.trim()
              ? claims.name.trim().slice(0, 200)
              : claims.email,
          role,
          expiresAt,
          autoProvision: settings.autoProvision,
        },
      });
      // Only an opaque one-time handle reaches the fragment; provider tokens stay server-side.
      return `${new URL(config.route.path, expected.origin).href}#qa-oidc=${encodeURIComponent(handoff)}`;
    } catch {
      throw oidcRefusal();
    }
  }

  complete(handoff: string, completionKey: string): QaAccountSession {
    this.sync();
    this.prune();
    const item = this.handoffs.get(handoff);
    if (
      !item ||
      item.generation !== this.generation ||
      !sameSecret(item.completionKey, completionKey)
    )
      throw oidcRefusal();
    this.handoffs.delete(handoff);
    const accounts = this.options.accounts();
    if (!accounts) throw oidcRefusal();
    try {
      return accounts.loginOidc(item.identity);
    } catch {
      throw oidcRefusal();
    }
  }

  async logout(token: string): Promise<string | null> {
    const config = this.sync();
    if (!this.options.accounts()?.logoutOidc(token)) return null;
    try {
      const client = await this.client(config);
      if (!client.serverMetadata().end_session_endpoint) return null;
      return oidc.buildEndSessionUrl(client, {
        client_id: config.accounts.oidc.clientId,
        post_logout_redirect_uri: new URL(
          config.route.path,
          config.accounts.oidc.redirectUri,
        ).href,
      }).href;
    } catch {
      return null;
    }
  }
}
