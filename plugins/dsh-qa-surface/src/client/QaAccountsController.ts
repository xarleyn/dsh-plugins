import type {
  QaAccountProfileInput,
  QaAccountSession,
  QaAccountStartersInput,
  QaAccountUserPublic,
  QaIssuedServiceToken,
  QaOwnershipEntry,
  QaServiceTokenCreateInput,
  QaServiceTokenSummary,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { qaStorageNamespace } from "../shared/session-key.js";
import type {
  QaAccountsApi,
  QaIntegrationTokenResult,
  StorageLike,
} from "./types.js";

/** The `(reason: <code>)` marker the Host folds into account wire failures. */
const ACCOUNTS_REASON_MARKER = /\(reason: ([a-z-]+)\)/u;

/**
 * What the sign-in card says after a forgotten-password request. It names the
 * request, never the account: a real address and an unknown one get the same
 * sentence, which is the whole point of the endpoint.
 */
export const QA_RESET_FILED_NOTICE =
  "Заявка отправлена оператору. Если такой аккаунт есть, пароль сбросят — затем войдите с новым паролем.";

export type QaAccountsSnapshot =
  | { readonly stage: "checking" }
  | {
      readonly stage: "gate";
      readonly mode: "login" | "register" | "reset";
      readonly busy: boolean;
      readonly error: string | null;
      /** Neutral confirmation of a filed reset request; null otherwise. */
      readonly notice?: string | null;
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
    case "invalid-current-password":
      return "Текущий пароль неверен.";
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
    case "invalid-profile":
      return "Проверьте поля профиля: значение слишком длинное или недопустимое.";
    case "profile-disabled":
      return "Профиль отключён на этом сервере.";
    case "invalid-starters":
      return "Проверьте подсказки: заполните название и промпт, текст не слишком длинный.";
    case "starters-disabled":
      return "Свои подсказки отключены на этом сервере.";
    case "integration-disabled":
      return "Интеграционный API выключен на этом стенде: такому токену некуда обращаться. Включите его в настройках стенда.";
    case "auth-required":
      return "Сессия истекла. Войдите заново.";
    case "forbidden":
      return "Этот токен принадлежит другой учётной записи или уже удалён.";
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
  /**
   * Replay this browser's locally held ratings onto the account it just signed
   * in as, for the chats that account owns. Runs once per account: the surface
   * is usable while it is in flight, and a failure costs only the retry the
   * next login performs.
   */
  readonly harvestRatings?: (context: {
    readonly token: string;
    readonly accountId: string;
    readonly ownedIds: readonly string[];
  }) => Promise<void>;
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

  setMode(mode: "login" | "register" | "reset"): void {
    if (this.snapshot.stage !== "gate" || this.snapshot.busy) return;
    // Switching cards drops the previous answer: "заявка отправлена" must not
    // survive a return to the sign-in form, where it would read as a result of
    // the wrong action.
    this.publish({ ...this.snapshot, mode, error: null, notice: null });
  }

  /**
   * File a forgotten-password request for the operator queue. The card says
   * the same thing whether or not the address exists — the Host refuses to
   * tell, and so does this controller.
   */
  async requestPasswordReset(email: string): Promise<void> {
    if (this.snapshot.stage !== "gate" || this.snapshot.busy || this.disposed) {
      return;
    }
    const mode = this.snapshot.mode;
    this.publish({
      stage: "gate",
      mode,
      busy: true,
      error: null,
      notice: null,
    });
    try {
      const result =
        await this.options.remote.accountsRequestPasswordReset(email);
      if (this.disposed) return;
      if (!result.ok) {
        this.publish({
          stage: "gate",
          mode,
          busy: false,
          error: accountsErrorMessage(accountsReasonOf(result.error)),
          notice: null,
        });
        return;
      }
      this.publish({
        stage: "gate",
        mode,
        busy: false,
        error: null,
        notice: QA_RESET_FILED_NOTICE,
      });
    } catch (error) {
      if (this.disposed) return;
      console.warn("dsh-qa-surface: password reset request failed", error);
      this.publish({
        stage: "gate",
        mode,
        busy: false,
        error: accountsErrorMessage(null),
        notice: null,
      });
    }
  }

  /**
   * Change the signed-in user's own password. The Host answers with a fresh
   * token, because the write bumps the account's token version — this browser
   * keeps its session only by storing that token. Resolves to audience-safe
   * refusal copy, or to null once the snapshot carries the new account.
   */
  async changePassword(
    currentPassword: string,
    nextPassword: string,
  ): Promise<string | null> {
    const token = this.tokenValue;
    if (this.disposed || token === null || this.snapshot.stage !== "authed") {
      return accountsErrorMessage(null);
    }
    try {
      const result = await this.options.remote.accountsChangePassword(
        token,
        currentPassword,
        nextPassword,
      );
      if (this.disposed || this.snapshot.stage !== "authed") return null;
      if (!result.ok) {
        return accountsErrorMessage(accountsReasonOf(result.error));
      }
      this.tokenValue = result.value.token;
      this.saveStoredToken(result.value.token);
      this.publish({ ...this.snapshot, user: result.value.user });
      return null;
    } catch (error) {
      console.warn("dsh-qa-surface: password change failed", error);
      return accountsErrorMessage(null);
    }
  }

  /** Drop the token and return to the gate (logout or expired identity). */
  signOut(): void {
    this.tokenValue = null;
    this.clearStoredToken();
    this.publish({ stage: "gate", mode: "login", busy: false, error: null });
  }

  /**
   * Claim one freshly created chat so the ownership map stays current, and
   * remember it in the owned list the sidebar shows.
   *
   * The claim runs on every bind — a chat created now and one reopened later
   * both take this path. A chat the Host reports as taken by another account
   * stays out of the list: the page then holds a binding whose ownership
   * belongs to someone else, and showing it is exactly what the list must not
   * do. A claim that never reached the Host still records the id, because the
   * page opened this chat through the attendance boundary, which claims an
   * unowned chat for whoever asks first and refuses another account's — so the
   * binding is this account's either way, and hiding a chat the visitor is
   * looking at would be the greater lie.
   */
  async claimNewSession(sessionId: string): Promise<void> {
    const token = this.tokenValue;
    if (token === null || this.disposed || this.snapshot.stage !== "authed") {
      return;
    }
    let conflict = false;
    try {
      const claimed = await this.options.remote.accountsClaimSessions(token, [
        sessionId,
      ]);
      conflict = claimed.ok && claimed.value.conflicts.includes(sessionId);
    } catch (error) {
      console.warn("dsh-qa-surface: session claim failed", error);
    }
    if (this.disposed || conflict) return;
    this.noteOwnedSession(sessionId);
  }

  /**
   * Add one chat this page holds to the owned list. The list is what the
   * sidebar shows and what every cross-chat projection is scoped by, so a chat
   * created or opened after login enters it here — the next login is not a
   * reasonable price for a chat the visitor is looking at. Ids already known,
   * and the ones an admin's cross-user view contributed, are left as they are.
   */
  private noteOwnedSession(sessionId: string): void {
    const snapshot = this.snapshot;
    if (snapshot.stage !== "authed" || snapshot.ownedIds.includes(sessionId)) {
      return;
    }
    this.publish({
      ...snapshot,
      ownedIds: [...snapshot.ownedIds, sessionId],
      ownedRevision: snapshot.ownedRevision + 1,
    });
  }

  /**
   * Replace the signed-in user's own profile. Resolves to audience-safe
   * refusal copy when the Host rejected the write, and to null once the
   * snapshot carries the stored profile — the form reports the outcome inline
   * rather than through the gate's state machine.
   */
  async updateProfile(input: QaAccountProfileInput): Promise<string | null> {
    const token = this.tokenValue;
    if (this.disposed || token === null || this.snapshot.stage !== "authed") {
      return accountsErrorMessage(null);
    }
    try {
      const result = await this.options.remote.accountsUpdateProfile(
        token,
        input,
      );
      if (this.disposed || this.snapshot.stage !== "authed") return null;
      if (!result.ok) {
        return accountsErrorMessage(accountsReasonOf(result.error));
      }
      this.publish({ ...this.snapshot, user: result.value });
      return null;
    } catch (error) {
      console.warn("dsh-qa-surface: profile update failed", error);
      return accountsErrorMessage(null);
    }
  }

  /**
   * Replace the signed-in user's own starter buttons, mirroring
   * {@link updateProfile}: refusal copy on rejection, null once the snapshot
   * carries the stored record, so the composer picks the new buttons up.
   */
  async updateStarters(input: QaAccountStartersInput): Promise<string | null> {
    const token = this.tokenValue;
    if (this.disposed || token === null || this.snapshot.stage !== "authed") {
      return accountsErrorMessage(null);
    }
    try {
      const result = await this.options.remote.accountsUpdateStarters(
        token,
        input,
      );
      if (this.disposed || this.snapshot.stage !== "authed") return null;
      if (!result.ok) {
        return accountsErrorMessage(accountsReasonOf(result.error));
      }
      this.publish({ ...this.snapshot, user: result.value });
      return null;
    } catch (error) {
      console.warn("dsh-qa-surface: starters update failed", error);
      return accountsErrorMessage(null);
    }
  }

  /**
   * The signed-in user's integration tokens. Resolves to the list, or to the
   * copy the page renders when the Host refused the read; the tokens are not
   * part of the account snapshot, because they are not part of the account.
   */
  async serviceTokens(): Promise<
    QaIntegrationTokenResult<readonly QaServiceTokenSummary[]>
  > {
    const token = this.tokenValue;
    if (this.disposed || token === null || this.snapshot.stage !== "authed") {
      return { ok: false, error: accountsErrorMessage(null) };
    }
    try {
      const result = await this.options.remote.accountsListServiceTokens(token);
      if (!result.ok) {
        return {
          ok: false,
          error: accountsErrorMessage(accountsReasonOf(result.error)),
        };
      }
      return { ok: true, value: result.value.tokens };
    } catch (error) {
      console.warn("dsh-qa-surface: integration token list failed", error);
      return { ok: false, error: accountsErrorMessage(null) };
    }
  }

  /**
   * Mint one integration token for the signed-in user. The plaintext is in the
   * answer and nowhere else — the caller has to hand it over now, because
   * nothing can show it again.
   */
  async createServiceToken(
    input: QaServiceTokenCreateInput,
  ): Promise<QaIntegrationTokenResult<QaIssuedServiceToken>> {
    const token = this.tokenValue;
    if (this.disposed || token === null || this.snapshot.stage !== "authed") {
      return { ok: false, error: accountsErrorMessage(null) };
    }
    try {
      const result = await this.options.remote.accountsCreateServiceToken(
        token,
        input,
      );
      if (!result.ok) {
        return {
          ok: false,
          error: accountsErrorMessage(accountsReasonOf(result.error)),
        };
      }
      return { ok: true, value: result.value };
    } catch (error) {
      console.warn("dsh-qa-surface: integration token create failed", error);
      return { ok: false, error: accountsErrorMessage(null) };
    }
  }

  /**
   * Revoke one of the signed-in user's integration tokens. The Host is the
   * authority on whose token it is; a refusal is shown as it arrives.
   */
  async revokeServiceToken(
    tokenId: string,
  ): Promise<QaIntegrationTokenResult<null>> {
    const token = this.tokenValue;
    if (this.disposed || token === null || this.snapshot.stage !== "authed") {
      return { ok: false, error: accountsErrorMessage(null) };
    }
    try {
      const result = await this.options.remote.accountsRevokeServiceToken(
        token,
        tokenId,
      );
      if (!result.ok) {
        return {
          ok: false,
          error: accountsErrorMessage(accountsReasonOf(result.error)),
        };
      }
      return { ok: true, value: null };
    } catch (error) {
      console.warn("dsh-qa-surface: integration token revoke failed", error);
      return { ok: false, error: accountsErrorMessage(null) };
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

  /** Own the account, migrate the legacy index, replay held ratings, then auth. */
  private async enterSession(
    token: string,
    user: QaAccountUserPublic,
  ): Promise<void> {
    const migration = this.options.legacyChatIds?.() ?? [];
    let ownedIds: readonly string[] = [];
    let ownership: readonly QaOwnershipEntry[] = [];
    let ownershipKnown = false;
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
      ownershipKnown = ids.ok;
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
    // An ownership list that never arrived would read as "nothing of yours is
    // here", so the replay waits for a login that actually knows the answer.
    if (ownershipKnown) {
      try {
        // Its own failure boundary: ratings a browser still holds are worth a
        // replay, but never worth withholding the session the user asked for.
        await this.options.harvestRatings?.({
          token,
          accountId: user.id,
          ownedIds,
        });
      } catch (error) {
        console.warn("dsh-qa-surface: rating harvest failed", error);
      }
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
    return `${qaStorageNamespace(this.options.config())}:account-token`;
  }

  private publish(snapshot: QaAccountsSnapshot): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
