/**
 * Attachment roster of one chat, projected for the rail's files tab: a pure
 * scan of the durable transcript, newest message first. The browser never
 * re-reads file bytes (the attachment route serves images), so a row keeps
 * the same handle the transcript shows.
 */

import type { QaImageView, QaMessage, QaFileView } from "../types.js";

/** Everything one user message carried, in prompt order. */
export interface QaChatFileGroup {
  /** The user message id; doubles as the transcript turn anchor. */
  readonly messageId: string;
  /** Wall-clock send time, when the transcript recorded one. */
  readonly timestamp?: number;
  readonly files: readonly QaFileView[];
  readonly images: readonly QaImageView[];
}

/** Whether the group carries at least one attachment of either kind. */
export function groupHasAttachments(group: QaChatFileGroup): boolean {
  return group.files.length > 0 || group.images.length > 0;
}

/** Total attachment count across groups; the header badge's value. */
export function countChatAttachments(
  groups: readonly QaChatFileGroup[],
): number {
  let total = 0;
  for (const group of groups) {
    total += group.files.length + group.images.length;
  }
  return total;
}

/**
 * Group the attachments of a chat by their sending message. Only user
 * messages can carry attachments; messages without any are dropped. The
 * groups come out newest message first, matching a roster that grows at the
 * bottom of the transcript.
 * @param messages - the chat's projected transcript.
 * @returns attachment groups, newest message first.
 */
export function collectChatFiles(
  messages: readonly QaMessage[],
): readonly QaChatFileGroup[] {
  const groups: QaChatFileGroup[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user") continue;
    const files = message.files ?? [];
    const images = message.images ?? [];
    if (files.length === 0 && images.length === 0) continue;
    groups.push({
      messageId: message.id,
      ...(message.timestamp === undefined
        ? {}
        : { timestamp: message.timestamp }),
      files,
      images,
    });
  }
  return groups;
}
