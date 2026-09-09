import type { IApiClient } from "@deepseek-ai/dsh-client-connection/client";
import type {
  ISessions,
  SessionRuntime,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { QaLockdownProof, QaSessionState } from "../types.js";

/** DSH session runtime surface the QA controller is allowed to touch. */
export type QaSessions = ISessions & Pick<SessionRuntime, "create">;

/** Narrow client API slice used to pin the preset and model of a fresh chat. */
export type QaSessionsApi = Pick<IApiClient["sessions"], "selectModel"> & {
  readonly selectAgentPreset: IApiClient["agentPresets"]["select"];
};

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
});
