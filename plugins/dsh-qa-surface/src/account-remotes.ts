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
  QaClaimResult,
  QaOwnershipEntry,
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
  /** Identity probe; safe to call with an empty or expired token. */
  whoami(token: string): QaWhoamiResult;
  /** Migrate a browser's local chat index into server-side ownership. */
  claimSessions(token: string, sessionIds: readonly string[]): QaClaimResult;
  /** The token user's owned session ids; the sidebar list authority. */
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
      config.accounts.profile.instructionsMaxLength,
      config.accounts.profile.identities,
    ]);
    if (accounts === undefined || accountsOptions !== memoKey) {
      accounts = new QaAccounts(defaultAccountsFilePath(), {
        sessionTtlDays: config.accounts.sessionTtlDays,
        allowRegistration: config.accounts.allowRegistration,
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
    whoami: (token) => {
      if (!getConfig().accounts.enabled) return { authenticated: false };
      const store = requireAccounts();
      return run(() => store.whoami(token));
    },
    claimSessions: (token, sessionIds) => {
      const store = requireAccounts();
      return run(() => store.claimSessions(token, sessionIds));
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
  };
}
