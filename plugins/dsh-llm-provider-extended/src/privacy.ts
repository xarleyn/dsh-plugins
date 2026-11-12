import { randomBytes } from "node:crypto";
import { LlmError, type GenerateOptions } from "@deepseek-ai/dsh-llm";
import { remaskReply } from "./privacy-reply.js";
import {
  compilePrivacyRules,
  PrivacyFilter,
  type PrivacySettings,
} from "./privacy-rules.js";

export function validatePrivacyProtocol(api: string): void {
  if (
    !["openai-completions", "openai-responses", "anthropic-messages"].includes(
      api,
    )
  )
    throw new LlmError(
      "Request masking requires Chat Completions, Responses or Anthropic Messages",
      "UNSUPPORTED_OPTION",
    );
}

/** A protected call can replay visible history. Opaque signatures and image bytes cannot be inspected. */
export function privacyHistory(
  options: GenerateOptions,
  filter: PrivacyFilter,
): GenerateOptions {
  if (
    options.messages.some((message) =>
      message.content.some((block) => block.type === "image"),
    )
  )
    throw new LlmError(
      "Request masking requires text-only history. Remove the image or start a text chat.",
      "UNSUPPORTED_CONTENT",
    );
  return {
    ...options,
    messages: options.messages.map((message) => {
      if (
        message.role !== "assistant" ||
        message.source.replayState === undefined
      )
        return message;
      const { replayState, ...source } = message.source;
      const blocks =
        replayState &&
        typeof replayState === "object" &&
        "blocks" in replayState &&
        Array.isArray(replayState.blocks)
          ? replayState.blocks
          : [];
      return {
        ...message,
        source,
        content: message.content.map((block, i) =>
          block.type === "text"
            ? { ...block, text: remaskReply(block.text, blocks[i], filter) }
            : block,
        ),
      };
    }),
  };
}

export function requestFilter(
  settings: PrivacySettings,
  readDictionary?: (ref: string) => string | undefined,
): PrivacyFilter {
  const ref = settings.dictionaryEnv;
  const dictionary = ref === undefined ? undefined : readDictionary?.(ref);
  if (ref !== undefined && !dictionary?.trim())
    throw new LlmError(
      "Private masking dictionary is unavailable or empty",
      "INVALID_CONFIG",
    );
  return new PrivacyFilter(
    compilePrivacyRules(settings, dictionary),
    randomBytes(6).toString("hex"),
  );
}
