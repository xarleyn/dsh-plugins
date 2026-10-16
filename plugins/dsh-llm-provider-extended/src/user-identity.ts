import { LlmError, type GenerateOptions } from "@deepseek-ai/dsh-llm";

export type QaUserIdResolver = (options: GenerateOptions) => string | undefined;
const PROTOCOLS = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
]);

/** Refuse unsupported wire protocols at configuration and request boundaries. */
export function validateUserIdentityProtocol(
  mode: "qa-account" | undefined,
  api: string,
): void {
  if (mode === undefined) return;
  if (mode !== "qa-account" || !PROTOCOLS.has(api))
    throw new LlmError(
      "QA user identity requires a supported chat protocol",
      "UNSUPPORTED_OPTION",
    );
}

/** Capture trusted identity before credential or transport awaits. */
export function resolveUserIdentity(
  mode: "qa-account" | undefined,
  api: string,
  options: GenerateOptions,
  resolve: QaUserIdResolver | undefined,
): string | undefined {
  if (mode === undefined) return undefined;
  validateUserIdentityProtocol(mode, api);
  const id = options.sessionId === undefined ? undefined : resolve?.(options);
  if (id === undefined)
    throw new LlmError(
      "This provider requires an attested QA chat with an active account owner",
      "MISSING_USER_ID",
    );
  if (!/^[a-zA-Z0-9_-]{1,512}$/u.test(id))
    throw new LlmError("The QA user identifier is invalid", "INVALID_USER_ID");
  return id;
}

/** DeepSeek spells the same end-user identity differently in each protocol. */
export function userIdentityPayload(
  payload: unknown,
  id: string | undefined,
  api: string,
): unknown {
  if (id === undefined) return payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new LlmError("Provider SDK returned an invalid payload", "PROTOCOL");
  if (api === "openai-completions") return { ...payload, user_id: id };
  if (api === "openai-responses") return { ...payload, user: id };
  if (api === "anthropic-messages") {
    const metadata = (payload as { metadata?: unknown }).metadata;
    if (
      metadata !== undefined &&
      (typeof metadata !== "object" ||
        metadata === null ||
        Array.isArray(metadata))
    )
      throw new LlmError("Provider SDK returned invalid metadata", "PROTOCOL");
    return { ...payload, metadata: { ...metadata, user_id: id } };
  }
  throw new LlmError(
    "This protocol cannot carry QA identity",
    "UNSUPPORTED_OPTION",
  );
}
