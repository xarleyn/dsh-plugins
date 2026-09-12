import type {
  QaAccountSession,
  QaAccountUserPublic,
  QaOwnershipEntry,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import type { QaAccountsApi, StorageLike } from "./types.js";

/** The `(reason: <code>)` marker the Host folds into account wire failures. */
const ACCOUNTS_REASON_MARKER = /\(reason: ([a-z-]+)\)/u;

export type QaAccountsSnapshot =
  | { readonly stage: "checking" }
  | {
      readonly stage: "gate";
      readonly mode: "login" | "register";
      readonly busy: boolean;
      readonly error: string | null;
    }
  | {
      readonly stage: "authed";
      readonly user: QaAccountUserPublic;
      /**
       * Server-known chat ids; the sidebar list authority. Own chats always,
       * plus every mapped chat for an admin (the cross-user grouping view).
       */
      readonly ownedIds: readonly string[];
      /**
       * The full ownership map; admins only, empty for ordinary accounts and
       * whenever the admin listing was refused or unavailable.
       */
      readonly ownership: readonly QaOwnershipEntry[];
      /** Bumped whenever ownedIds or ownership changes; re-projects lists. */
      readonly ownedRevision: number;
    };

/** Union of the own chat ids and every mapped one, own ids first. */
function mergeOwnershipIds(
  ownedIds: readonly string[],
  ownership: readonly QaOwnershipEntry[],
): readonly string[] {
  if (ownership.length === 0) return ownedIds;
  return [
    ...new Set([...ownedIds, ...ownership.map((entry) => entry.sessionId)]),
  ];
}

/**
 * Audience-safe copy for the coarse account refusal codes; anything unknown
 * falls back to the generic line.
 */
export function accountsErrorMessage(code: string | null): string {
  switch (code) {
    case "invalid-credentials":
      return "Неверный email или пароль.";
    case "admin-required":
      return "Недостаточно прав: действие доступно администратору.";
    case "account-disabled":
      return "Аккаунт отключён администратором.";
    case "email-taken":
      return "Этот email уже зарегистрирован.";
    case "invalid-email":
      return "Введите корректный email.";
    case "weak-password":
      return "Пароль должен быть не короче 8 символов.";
    case "invalid-display-name":
      return "Слишком длинное имя.";
    case "registration-disabled":
      return "Регистрация на этом сервере отключена.";
    case "rate-limited":
      return "Слишком много попыток. Подождите минуту.";
    default:
      return "Не удалось войти. Попробуйте ещё раз.";
  }
}

/** Extract the coarse account reason code from a Host wire failure. */
export function accountsReasonOf(failure: unknown): string | null {
  const message =
    typeof failure === "object" && failure !== null && "message" in failure
      ? String((failure as { message?: unknown }).message ?? "")
      : "";
  return ACCOUNTS_REASON_MARKER.exec(message)?.at(1) ?? null;
}

export interface QaAccountsControllerOptions {
  readonly remote: QaAccountsApi;
  readonly storage: StorageLike | undefined;
  /** Config snapshot getter; the token key follows the deployment identity. */
  readonly config: () => ResolvedQaSurfaceConfig;
  /**
   * The legacy per-browser chat index at login time, for the one-shot
   * ownership migration; conflicts are dropped through {@link forgetChat}.
   */
  readonly legacyChatIds?: () => readonly string[];
  readonly forgetChat?: (sessionId: string) => void;
}

/**
 * Browser-side account lifecycle: token persistence, the checking → gate →
 * authed state machine, and the ownership bookkeeping the sidebar list is
 * built from. Anonymous/failed identity never blocks a deployment with
 * accounts disabled — the caller simply does not mount this controller.
 */
export class QaAccountsController {
  private readonly listeners = new Set<() => void>();
  private snapshot: QaAccountsSnapshot = { stage: "checking" };
  private tokenValue: string | null = null;
  private disposed = false;

  constructor(private readonly options: QaAccountsControllerOptions) {}

  getSnapshot = (): QaAccountsSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  /** The bearer token threaded into gated remotes; null while anonymous. */
  /** The bearer token threaded into gated remotes; null while anonymous. */
  token(): string | null {
    return this.tokenValue;
  }

  /** Server-owned chat ids (empty until authed); falls back to nothing. */
  ownedIds(): readonly string[] {
    return this.snapshot.stage === "authed" ? this.snapshot.ownedIds : [];
  }

  /** Boot probe: restore the stored token and ask the Host who it is. */
  async start(): Promise<void> {
    if (this.disposed || this.snapshot.stage !== "checking") return;
    this.tokenValue = this.readStoredToken();
    if (this.tokenValue === null) {
      this.publish({ stage: "gate", mode: "login", busy: false, error: null });
      return;
    }
    try {
      const result = await this.options.remote.accountsWhoami(this.tokenValue);
      if (this.disposed) return;
      if (result.ok && result.value.authenticated) {
        await this.enterSession(this.tokenValue, result.value.user);
        return;
      }
      if (result.ok) {
        // A definite "not authenticated": the token is stale or rotated.
        this.tokenValue = null;
        this.clearStoredToken();
      }
    } catch (error) {
      // The connection is down or the Host refused the round trip; keep the
      // token and the checking stage so a reconnect retries the probe.
      console.warn("dsh-qa-surface: accounts whoami failed", error);
      return;
    }
    if (this.disposed) return;
    this.publish({ stage: "gate", mode: "login", busy: false, error: null });
  }

  async login(email: string, password: string): Promise<void> {
    await this.authenticate("login", () =>
      this.options.remote.accountsLogin(email, password),
    );
  }

  async register(email: string, password: string): Promise<void> {
    if (this.snapshot.stage !== "gate") return;
    await this.authenticate("register", () =>
      this.options.remote.accountsRegister(email, password),
    );
  }

  setMode(mode: "login" | "register"): void {
    if (this.snapshot.stage !== "gate" || this.snapshot.busy) return;
    this.publish({ ...this.snapshot, mode, error: null });
  }

  /** Drop the token and return to the gate (logout or expired identity). */
  signOut(): void {
    this.tokenValue = null;
    this.clearStoredToken();
    this.publish({ stage: "gate", mode: "login", busy: false, error: null });
  }

  /** Claim one freshly created chat so the ownership map stays current. */
  async claimNewSession(sessionId: string): Promise<void> {
    if (this.tokenValue === null || this.disposed) return;
    try {
      await this.options.remote.accountsClaimSessions(this.tokenValue, [
        sessionId,
      ]);
    } catch (error) {
      console.warn("dsh-qa-surface: session claim failed", error);
    }
  }

  private async authenticate(
    mode: "login" | "register",
    call: () => Promise<
      | { readonly ok: true; readonly value: QaAccountSession }
      | { readonly ok: false; readonly error: unknown }
    >,
  ): Promise<void> {
    if (this.snapshot.stage !== "gate" || this.snapshot.busy || this.disposed) {
      return;
    }
    this.publish({ ...this.snapshot, mode, busy: true, error: null });
    try {
      const result = await call();
      if (this.disposed) return;
      if (!result.ok) {
        const reason = accountsReasonOf(result.error);
        // The gate keeps its inputs on a rejection; the copy is coarse.
        this.publish({
          stage: "gate",
          mode,
          busy: false,
          error: accountsErrorMessage(reason),
        });
        return;
      }
      const { token, user } = result.value;
      this.tokenValue = token;
      this.saveStoredToken(token);
      await this.enterSession(token, user);
    } catch (error) {
      if (this.disposed) return;
      console.warn("dsh-qa-surface: account operation failed", error);
      this.publish({
        stage: "gate",
        mode,
        busy: false,
        error: accountsErrorMessage(null),
      });
    }
  }

  /** Own the account, migrate the legacy index, then project authed. */
  private async enterSession(
    token: string,
    user: QaAccountUserPublic,
  ): Promise<void> {
    const migration = this.options.legacyChatIds?.() ?? [];
    let ownedIds: readonly string[] = [];
    let ownership: readonly QaOwnershipEntry[] = [];
    try {
      const claimed = await this.options.remote.accountsClaimSessions(
        token,
        migration,
      );
      // Foreign chats disappear from this browser's index on purpose: their
      // owner claimed them first.
      for (const conflict of claimed.ok ? claimed.value.conflicts : []) {
        this.options.forgetChat?.(conflict);
      }
      const ids = await this.options.remote.accountsOwnedSessions(token);
      ownedIds = ids.ok ? ids.value.ids : [];
      // The cross-user ownership view is a separate operator opt-in. A
      // refusal only costs the grouping, never the admin's own chats.
      if (
        user.role === "admin" &&
        this.options.config().accounts.showOtherUsersChats
      ) {
        ownership = await this.fetchOwnership(token);
      }
    } catch (error) {
      console.warn("dsh-qa-surface: chat migration claim failed", error);
    }
    if (this.disposed) return;
    this.publish({
      stage: "authed",
      user,
      ownedIds: mergeOwnershipIds(ownedIds, ownership),
      ownership,
      ownedRevision: 1,
    });
  }

  /** Refresh the owned list after index changes; cheap enough to re-pull. */
  async refreshOwned(): Promise<void> {
    if (
      this.tokenValue === null ||
      this.disposed ||
      this.snapshot.stage !== "authed"
    ) {
      return;
    }
    try {
      const ids = await this.options.remote.accountsOwnedSessions(
        this.tokenValue,
      );
      if (this.disposed || !ids.ok || this.snapshot.stage !== "authed") return;
      let ownership = this.snapshot.ownership;
      if (
        this.snapshot.user.role === "admin" &&
        this.options.config().accounts.showOtherUsersChats
      ) {
        ownership = await this.fetchOwnership(this.tokenValue);
        if (this.disposed || this.snapshot.stage !== "authed") return;
      } else {
        ownership = [];
      }
      const ownedIds = mergeOwnershipIds(ids.value.ids, ownership);
      if (
        JSON.stringify(ownedIds) === JSON.stringify(this.snapshot.ownedIds) &&
        JSON.stringify(ownership) === JSON.stringify(this.snapshot.ownership)
      ) {
        return;
      }
      this.publish({
        ...this.snapshot,
        ownedIds,
        ownership,
        ownedRevision: this.snapshot.ownedRevision + 1,
      });
    } catch (error) {
      console.warn("dsh-qa-surface: owned sessions refresh failed", error);
    }
  }

  /** The admin cross-user ownership view; failures degrade to an empty map. */
  private async fetchOwnership(
    token: string,
  ): Promise<readonly QaOwnershipEntry[]> {
    try {
      const listed = await this.options.remote.accountsListOwnership(token);
      return listed.ok ? listed.value.entries : [];
    } catch (error) {
      console.warn("dsh-qa-surface: ownership list failed", error);
      return [];
    }
  }

  /** Session id → owner display name; empty unless an admin is signed in. */
  ownerNames(): ReadonlyMap<string, string> {
    if (
      this.snapshot.stage !== "authed" ||
      this.snapshot.user.role !== "admin" ||
      !this.options.config().accounts.showOtherUsersChats
    ) {
      return new Map();
    }
    return new Map(
      this.snapshot.ownership.map((entry) => [
        entry.sessionId,
        entry.displayName,
      ]),
    );
  }

  /**
   * The chat owner's display name for author labels: admins see it on
   * foreign chats only; the owner themself and ordinary accounts see none.
   */
  messageAuthorOf(sessionId: string): string | undefined {
    if (
      this.snapshot.stage !== "authed" ||
      this.snapshot.user.role !== "admin" ||
      !this.options.config().accounts.showOtherUsersChats
    ) {
      return undefined;
    }
    const entry = this.snapshot.ownership.find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (entry === undefined || entry.userId === this.snapshot.user.id) {
      return undefined;
    }
    return entry.displayName;
  }

  private readStoredToken(): string | null {
    try {
      const key = this.tokenKey();
      const value = this.options.storage?.getItem(key)?.trim() ?? "";
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }

  private saveStoredToken(token: string): void {
    try {
      this.options.storage?.setItem(this.tokenKey(), token);
    } catch {
      // A denied write only costs the browser its stay-logged-in state.
    }
  }

  private clearStoredToken(): void {
    try {
      this.options.storage?.removeItem(this.tokenKey());
    } catch {
      // Harmless: the next whoami reports anonymous.
    }
  }

  private tokenKey(): string {
    const config = this.options.config();
    return `${config.session.storageKey}:v1:${config.route.path}:account-token`;
  }

  private publish(snapshot: QaAccountsSnapshot): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
