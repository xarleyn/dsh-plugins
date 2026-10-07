/**
 * Attachment roster of one chat, projected for the rail's files tab: a pure
 * scan of the durable transcript, newest message first. The browser never
 * re-reads file bytes (the attachment route serves images), so a row keeps
 * the same handle the transcript shows. A document the agent produced is on
 * the same roster: it is an attachment of the conversation, sent by the answer
 * rather than by the question.
 */

import type {
  QaArtifactView,
  QaImageView,
  QaMessage,
  QaFileView,
} from "../types.js";

/** Everything one message carried, in prompt order. */
export interface QaChatFileGroup {
  /** The message id; doubles as the transcript turn anchor. */
  readonly messageId: string;
  /** Wall-clock send time, when the transcript recorded one. */
  readonly timestamp?: number;
  readonly files: readonly QaFileView[];
  readonly images: readonly QaImageView[];
  /** Files this message's turn produced; empty on a message that made none. */
  readonly artifacts?: readonly QaArtifactView[];
}

/** Whether the group carries at least one attachment of either kind. */
export function groupHasAttachments(group: QaChatFileGroup): boolean {
  return (
    group.files.length > 0 ||
    group.images.length > 0 ||
    (group.artifacts?.length ?? 0) > 0
  );
}

/** Total attachment count across groups; the header badge's value. */
export function countChatAttachments(
  groups: readonly QaChatFileGroup[],
): number {
  let total = 0;
  for (const group of groups) {
    total +=
      group.files.length + group.images.length + (group.artifacts?.length ?? 0);
  }
  return total;
}

/**
 * Group the attachments of a chat by their message. A user message carries what
 * was sent; an assistant message carries what its turn produced, so a document
 * the stand made is listed beside the answer that made it instead of only on
 * disk. Messages with neither are dropped. The groups come out newest first,
 * matching a roster that grows at the bottom of the transcript.
 * @param messages - the chat's projected transcript.
 * @returns attachment groups, newest message first.
 */
export function collectChatFiles(
  messages: readonly QaMessage[],
): readonly QaChatFileGroup[] {
  const groups: QaChatFileGroup[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    const files = message.role === "user" ? (message.files ?? []) : [];
    const images = message.role === "user" ? (message.images ?? []) : [];
    const artifacts =
      message.role === "assistant" ? (message.artifacts ?? []) : [];
    if (files.length === 0 && images.length === 0 && artifacts.length === 0) {
      continue;
    }
    // A work row carries its own timing pair, not a message timestamp; it never
    // reaches this list anyway, since it holds no attachments.
    const timestamp = message.role === "work" ? undefined : message.timestamp;
    groups.push({
      messageId: message.id,
      ...(timestamp === undefined ? {} : { timestamp }),
      files,
      images,
      ...(artifacts.length === 0 ? {} : { artifacts }),
    });
  }
  return groups;
}
