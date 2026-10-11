import type { QaAccountRole } from "./policy.js";

/** The account fields projected to browsers; never includes credentials. */
export interface QaAccountUserPublic {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: QaAccountRole;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
  readonly disabled: boolean;
  /** Self-declared identity the QA prompt renders; empty until edited. */
  readonly profile: QaAccountProfile;
  /** The account's own starter buttons; empty until customized. */
  readonly starters: QaAccountStarters;
  /** Which channels a finished turn may use for this reader. */
  readonly notifications: QaAccountNotifications;
}

/** One external system the deployment collects a handle for. */
export interface QaAccountIdentityField {
  /** Stable lowercase key: the profile's storage key and the prompt's label. */
  readonly key: string;
  /** Operator copy shown in the profile form. */
  readonly label: string;
}

/**
 * What one account says about itself. Every value is the owner's own wording,
 * which is why the prompt renders it as self-declared rather than as a
 * verified directory attribute.
 */
export interface QaAccountProfile {
  /** Full name as the user writes it; empty when unset. */
  readonly fullName: string;
  /** External-system handles, keyed by the declared field key. */
  readonly identities: Readonly<Record<string, string>>;
  /** Free-form guidance about how the user wants answers; empty when unset. */
  readonly instructions: string;
  /** ISO timestamp of the last edit; null while the profile is untouched. */
  readonly updatedAt: string | null;
}

/** Full-replace profile write: an absent value clears the stored one. */
export interface QaAccountProfileInput {
  readonly fullName: string;
  readonly identities: Readonly<Record<string, string>>;
  readonly instructions: string;
}

/** One starter button: what it reads and what pressing it sends. */
export interface QaAccountStarter {
  readonly label: string;
  readonly prompt: string;
}

/**
 * An account's own starter buttons plus the choice about the deployment's
 * built-in suggestions. Pure UI preferences: unlike the profile, none of this
 * reaches the agent prompt.
 */
export interface QaAccountStarters {
  readonly items: readonly QaAccountStarter[];
  /** Hide the deployment's suggested questions in this account's composer. */
  readonly hideDefaults: boolean;
}

/** Full-replace starters write: an absent value clears the stored one. */
export interface QaAccountStartersInput {
  readonly items: readonly QaAccountStarter[];
  readonly hideDefaults: boolean;
}

/**
 * What one account allows a finished turn to do to it. Pure UI preferences:
 * unlike the profile, none of this reaches the agent prompt, and unlike the
 * starter buttons, none of it is content — it is two switches over the
 * channels the plugin already knows how to raise.
 *
 * The deployment's `config.notifications` sits above these: a channel the stand
 * closed stays closed whatever an account asks for, which is the operator's
 * answer to a laptop more than one person signs in on.
 */
export interface QaAccountNotifications {
  /** Show the in-page line naming the chat whose turn ended. */
  readonly inApp: boolean;
  /**
   * Hand the same fact to the operating system while this page is hidden or
   * behind another window. Needs the browser's permission as well: without it
   * the line stays inside the page and nothing asks a second time.
   */
  readonly desktop: boolean;
}

/** Full-replace notifications write: both channels are always sent. */
export interface QaAccountNotificationsInput {
  readonly inApp: boolean;
  readonly desktop: boolean;
}

/** One successful login/registration: the bearer token plus the user. */
export interface QaAccountSession {
  readonly token: string;
  readonly user: QaAccountUserPublic;
}

/**
 * One forgotten-password request waiting for an operator. The address and name
 * travel with it so the console can show who is locked out without a second
 * lookup; the count makes repeated taps visible instead of silent.
 */
export interface QaPasswordResetRequest {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly requestedAt: string;
  readonly lastRequestedAt: string;
  readonly requestCount: number;
  /** True when the account is disabled: a reset will not let it sign in. */
  readonly disabled: boolean;
}

export type QaWhoamiResult =
  | { readonly authenticated: false }
  | { readonly authenticated: true; readonly user: QaAccountUserPublic };

/** Bulk ownership claim outcome for one browser's local chat index. */
export interface QaClaimResult {
  readonly claimed: number;
  /** Ids already owned by a different user; the browser drops them. */
  readonly conflicts: readonly string[];
}

/**
 * What an integration token may do. The credential a non-browser application
 * presents to the QA HTTP API carries its own scopes, so a bridge that asks
 * questions cannot read back conversations it was never given.
 */
export type QaServiceTokenScope = "ask" | "sessions:read";

/**
 * What an account asks a new integration token to be. The credential is always
 * issued to the caller: nothing a browser sends may name another account, so
 * this shape has no owner field and the administrative path keeps its own.
 */
export interface QaServiceTokenCreateInput {
  /** A note the operator's list shows; empty becomes a generic label. */
  readonly label?: string;
  /** Requested scopes; unknown ones are dropped, empty falls back to `ask`. */
  readonly scopes?: readonly string[];
  /** How long the token lives, in days; bounded server-side. */
  readonly ttlDays?: number;
}

/**
 * One integration token as a list shows it. The plaintext is deliberately not
 * part of this shape: a secret is shown once, when it is minted, and a list
 * that could repeat it would be a list that leaks it.
 */
export interface QaServiceTokenSummary {
  readonly id: string;
  readonly label: string;
  readonly scopes: readonly QaServiceTokenScope[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly useCount: number;
}

/** One freshly minted token: the plaintext is here and nowhere else, ever. */
export interface QaIssuedServiceToken extends QaServiceTokenSummary {
  /** The credential to hand to the integration. Never recoverable later. */
  readonly token: string;
}

/**
 * One chat-ownership entry as the admin views see it: the session, its owner
 * and the owner's display name resolved at read time (a disabled account
 * still names its chats).
 */
export interface QaOwnershipEntry {
  readonly sessionId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly claimedAt: string;
}
