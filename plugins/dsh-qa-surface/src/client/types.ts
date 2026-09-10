import type { ClientRemote } from "@deepseek-ai/dsh-api-gateway/client";
import type {
  ISessions,
  SessionFace,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote";
import type {} from "@deepseek-ai/dsh-agent-presets/remote";
import type { UiConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { QaLockdownProof, QaSessionState } from "../types.js";

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

/** Attestation channel to the Host admission boundary (`qaSurface/secureSession`). */
export type QaSecureSession = (
  sessionId: string,
) => Promise<
  | { readonly ok: true; readonly value: QaLockdownProof }
  | { readonly ok: false; readonly error: unknown }
>;

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
  viewingSubagent: null,
});
