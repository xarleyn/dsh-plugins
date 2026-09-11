import type { ClientRemote } from "@deepseek-ai/dsh-api-gateway/client";
import type {
  ISessions,
  SessionFace,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote";
import type {} from "@deepseek-ai/dsh-agent-presets/remote";
import type { UiConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  QaAccountSession,
  QaClaimResult,
  QaLockdownProof,
  QaSessionState,
  QaSourceFilePreview,
  QaTurnSources,
  QaWhoamiResult,
} from "../types.js";

/** Wire content one prompt carries: text plus base64 image uploads. */
export type QaPromptContent = Parameters<SessionFace["prompt"]>[0];

/** DSH session runtime surface the QA controller is allowed to touch. */
export type QaSessions = ISessions;

/** Narrow client API slice used to pin the preset and model of a fresh chat. */
export type QaSessionsApi = {
  selectModel: ClientRemote["session"]["selectModel"];
  selectAgentPreset: ClientRemote["agentPresets"]["select"];
};

/**
 * Conversation assembly the QA transcript is projected from: the per-Session
 * binding carries the assembled Chat view (nodes, partials, tool calls).
 */
export type QaConversation = Pick<UiConversation, "binding">;

/**
 * Attestation channel to the Host admission boundary
 * (`qaSurface/secureSession`). The account token rides as the first argument
 * when accounts are enabled; an empty string is the anonymous caller.
 */
export type QaSecureSession = (
  token: string,
  sessionId: string,
) => Promise<
  | { readonly ok: true; readonly value: QaLockdownProof }
  | { readonly ok: false; readonly error: unknown }
>;

export interface QaSourceApi {
  sources(
    token: string,
    sessionId: string,
  ): Promise<
    | { readonly ok: true; readonly value: readonly QaTurnSources[] }
    | { readonly ok: false; readonly error: unknown }
  >;
  readSourceFile(
    token: string,
    sessionId: string,
    sourcePath: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaSourceFilePreview }
    | { readonly ok: false; readonly error: unknown }
  >;
}

/** A source API with the account token already bound at the call site. */
export type QaBoundSourceApi = {
  sources(
    sessionId: string,
  ): Promise<
    | { readonly ok: true; readonly value: readonly QaTurnSources[] }
    | { readonly ok: false; readonly error: unknown }
  >;
  readSourceFile(
    sessionId: string,
    sourcePath: string,
  ): Promise<
    | { readonly ok: true; readonly value: QaSourceFilePreview }
    | { readonly ok: false; readonly error: unknown }
  >;
};

/** Account remotes exposed by the plugin's own typert namespace. */
export interface QaAccountsApi {
  accountsWhoami(token: string): Promise<RemoteResult<QaWhoamiResult>>;
  accountsLogin(
    email: string,
    password: string,
  ): Promise<RemoteResult<QaAccountSession>>;
  accountsRegister(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<RemoteResult<QaAccountSession>>;
  accountsClaimSessions(
    token: string,
    sessionIds: readonly string[],
  ): Promise<RemoteResult<QaClaimResult>>;
  accountsOwnedSessions(
    token: string,
  ): Promise<RemoteResult<{ readonly ids: readonly string[] }>>;
}

type RemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: unknown };

/** Minimal persistence contract; backed by `window.localStorage` in the app. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The state projected while no QA chat is bound (route inactive or booting). */
export const QA_SESSION_IDLE_STATE: QaSessionState = Object.freeze({
  phase: "idle",
  sessionId: null,
  messages: Object.freeze([]),
  error: null,
  canSend: false,
  canStop: false,
  chatsRevision: 0,
  sources: Object.freeze([]),
  sourcesComplete: true,
  incompleteSourceOrigins: undefined,
  viewingSubagent: null,
});
