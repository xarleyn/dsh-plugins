import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import {
  QaAccounts,
  QaAccountsError,
  defaultAccountsFilePath,
} from "./accounts/store.js";
import type {
  QaAccountProfileInput,
  QaAccountSession,
  QaAccountStartersInput,
  QaAccountUserPublic,
  QaIssuedServiceToken,
  QaOwnershipEntry,
  QaServiceTokenCreateInput,
  QaServiceTokenSummary,
  QaWhoamiResult,
  ResolvedQaSurfaceConfig,
} from "./types.js";

const ACCOUNTS_DISABLED_ERROR =
  "QA accounts are not enabled on this deployment.";

/**
 * Host-side bodies of the account remotes the `QaSurface` service exposes.
 * The `@Remote`-decorated signatures stay on the service class (typert code
 * generation reads the class shape); this context carries everything behind
 * them: store construction and memoization, the disabled refusal, and the
 * error mapping onto the shared `(reason: <code>)` wire marker.
 */
export interface QaAccountRemotes {
  /** The accounts store behind the runtime toggle, or undefined while off. */
  resolve(config: ResolvedQaSurfaceConfig): QaAccounts | undefined;
  /** Map a store failure onto the shared `(reason: <code>)` wire marker. */
  run<T>(operation: () => T, sessionIdForLog?: string): T;
  /**
   * The same mapping for an asynchronous body. A refusal thrown after an
   * `await` never reaches a synchronous `run`, and the administrative reads
   * await stored logs before they can decide anything.
   */
  runAsync<T>(
    operation: () => Promise<T>,
    sessionIdForLog?: string,
  ): Promise<T>;
  register(email: string, password: string): QaAccountSession;
  login(email: string, password: string): QaAccountSession;
  /**
   * Replace the token account's own password. The token is the identity, so a
   * browser can only ever change its own credential; the returned session
   * carries the fresh token that keeps this browser signed in.
   */
  changePassword(
    token: string,
    currentPassword: string,
    nextPassword: string,
  ): QaAccountSession;
  /**
   * File a forgotten-password request for the operator queue. The answer is
   * deliberately the same for every address, so the sign-in screen cannot be
   * used to learn which accounts exist.
   */
  requestPasswordReset(email: string): void;
  /** Identity probe; safe to call with an empty or expired token. */
  whoami(token: string): QaWhoamiResult;
  /**
   * The token user's owned session ids; the sidebar list authority.
   *
   * Migrating a browser's local chat index is NOT here: it has to refuse a
   * delegated session, which takes session lineage, and that lives in
   * `QaAccessService.claimSessions` — one entry point, no path around it.
   */
  ownedSessions(token: string): { readonly ids: readonly string[] };
  /**
   * Every chat-ownership entry with owner display names; the cross-user view
   * admin browsers group the sidebar by. Ordinary accounts are refused with
   * the dedicated reason, anonymous ones with auth-required.
   */
  listOwnership(token: string): {
    readonly entries: readonly QaOwnershipEntry[];
  };
  /** Replace the caller's own self-declared profile; the token is the identity. */
  updateProfile(
    token: string,
    input: QaAccountProfileInput,
  ): QaAccountUserPublic;
  /** Replace the caller's own starter buttons; the token is the identity. */
  updateStarters(
    token: string,
    input: QaAccountStartersInput,
  ): QaAccountUserPublic;
  /**
   * The caller's own integration tokens, newest last. Never a secret: the
   * plaintext exists only in the answer that minted it.
   */
  listServiceTokens(token: string): {
    readonly tokens: readonly QaServiceTokenSummary[];
  };
  /**
   * Mint one integration token for the caller. Refused while the integration
   * API is off: a credential that authenticates nothing is a credential that
   * only leaks.
   */
  createServiceToken(
    token: string,
    input: QaServiceTokenCreateInput,
  ): QaIssuedServiceToken;
  /** Revoke one of the caller's own integration tokens, by id. */
  revokeServiceToken(
    token: string,
    tokenId: string,
  ): { readonly revoked: boolean };
}

/** Build the account-remotes context for one `QaSurface` service instance. */
export function createQaAccountRemotes(options: {
  getConfig: () => ResolvedQaSurfaceConfig;
  logger: PluginLogger;
}): QaAccountRemotes {
  const { getConfig, logger } = options;
  // Memoized across remotes: rebuilt only when the account-affecting options
  // change; the file is shared across rebuilds.
  let accounts: QaAccounts | undefined;
  let accountsOptions: string | undefined;

  const resolve = (config: ResolvedQaSurfaceConfig): QaAccounts | undefined => {
    if (!config.accounts.enabled) return undefined;
    const memoKey = JSON.stringify([
      config.accounts.sessionTtlDays,
      config.accounts.allowRegistration,
      config.accounts.maxAuthAttemptsPerMinute,
      config.accounts.profile.instructionsMaxLength,
      config.accounts.profile.identities,
    ]);
    if (accounts === undefined || accountsOptions !== memoKey) {
      accounts = new QaAccounts(defaultAccountsFilePath(), {
        sessionTtlDays: config.accounts.sessionTtlDays,
        allowRegistration: config.accounts.allowRegistration,
        maxAuthAttemptsPerMinute: config.accounts.maxAuthAttemptsPerMinute,
        instructionsMaxLength: config.accounts.profile.instructionsMaxLength,
        identityFields: config.accounts.profile.identities,
      });
      accountsOptions = memoKey;
    }
    return accounts;
  };

  /** The accounts store, or the disabled refusal the browser maps to copy. */
  const requireAccounts = (): QaAccounts => {
    const store = resolve(getConfig());
    if (store === undefined) {
      throw new Error(ACCOUNTS_DISABLED_ERROR);
    }
    return store;
  };

  const mapError = (error: unknown, sessionIdForLog?: string): unknown => {
    if (error instanceof QaAccountsError) {
      logger.warn("accounts.rejected", {
        reason: error.reason,
        sessionId: sessionIdForLog,
      });
      return new Error(
        `QA accounts refused the request (reason: ${error.reason})`,
        { cause: error },
      );
    }
    return error;
  };

  const run = <T>(operation: () => T, sessionIdForLog?: string): T => {
    try {
      return operation();
    } catch (error) {
      throw mapError(error, sessionIdForLog);
    }
  };

  const runAsync = async <T>(
    operation: () => Promise<T>,
    sessionIdForLog?: string,
  ): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      throw mapError(error, sessionIdForLog);
    }
  };

  return {
    resolve,
    run,
    runAsync,
    register: (email, password) => {
      const store = requireAccounts();
      return run(() => store.register(email, password));
    },
    login: (email, password) => {
      const store = requireAccounts();
      return run(() => store.login(email, password));
    },
    changePassword: (token, currentPassword, nextPassword) => {
      const store = requireAccounts();
      const session = run(() =>
        store.changePassword(token, currentPassword, nextPassword),
      );
      // Who changed a password is worth a log line; the password itself never
      // is. A change signs every other browser out, so a user asking "why was
      // I logged out?" has an answer in the Host log.
      logger.info("accounts.password-changed", { userId: session.user.id });
      return session;
    },
    requestPasswordReset: (email) => {
      const store = requireAccounts();
      run(() => store.requestPasswordReset(email));
    },
    whoami: (token) => {
      if (!getConfig().accounts.enabled) return { authenticated: false };
      const store = requireAccounts();
      return run(() => store.whoami(token));
    },
    ownedSessions: (token) => {
      if (!getConfig().accounts.enabled) return { ids: [] };
      const store = requireAccounts();
      return run(() => ({ ids: store.ownedSessionIds(token) }));
    },
    listOwnership: (token) => {
      if (!getConfig().accounts.enabled) return { entries: [] };
      const store = requireAccounts();
      return run(() => ({ entries: store.listOwnership(token) }));
    },
    updateProfile: (token, input) => {
      const config = getConfig();
      const store = requireAccounts();
      return run(() => {
        if (!config.accounts.profile.enabled) {
          throw new QaAccountsError(
            "profile-disabled",
            "self-service profiles are disabled on this deployment",
          );
        }
        return store.updateOwnProfile(token, input);
      });
    },
    updateStarters: (token, input) => {
      const config = getConfig();
      const store = requireAccounts();
      return run(() => {
        if (!config.accounts.starters.enabled) {
          throw new QaAccountsError(
            "starters-disabled",
            "self-service starter messages are disabled on this deployment",
          );
        }
        return store.updateOwnStarters(token, input);
      });
    },
    listServiceTokens: (token) => {
      const store = requireAccounts();
      return run(() => ({ tokens: store.listServiceTokens(token) }));
    },
    createServiceToken: (token, input) => {
      const config = getConfig();
      const store = requireAccounts();
      return run(() => {
        if (!config.integration.enabled) {
          throw new QaAccountsError(
            "integration-disabled",
            "the QA integration API is disabled on this deployment",
          );
        }
        // The owner is never taken from the request: an integration token is
        // minted for the account that authenticated, which is also why the
        // admin path (`mintServiceToken` with a `userId`) is not reachable
        // from here.
        return store.mintServiceToken(token, {
          ...(input.label === undefined ? {} : { label: input.label }),
          ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
          ...(input.ttlDays === undefined ? {} : { ttlDays: input.ttlDays }),
        });
      });
    },
    revokeServiceToken: (token, tokenId) => {
      const store = requireAccounts();
      return run(() => ({
        revoked: store.revokeServiceToken(token, tokenId),
      }));
    },
  };
}
