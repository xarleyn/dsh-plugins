import type { StorageLike } from "./types.js";

/** Cap on the per-browser chat index so localStorage cannot grow unbounded. */
const MAX_INDEXED_CHATS = 50;

/**
 * Browser-local chat bookkeeping: a most-recently-used index of chat ids for
 * the sidebar plus the id of the chat this browser reopens on load. Both live
 * under the deployment's storage key and route path, and every access
 * tolerates a denied or broken store — persistence must never prevent a real
 * DSH session.
 */
export class QaChatIndex {
  private readonly storage: StorageLike | undefined;
  private readonly sessionKey: string;
  private readonly chatKey: string;

  constructor(storage: StorageLike | undefined, prefix: string) {
    this.storage = storage;
    this.sessionKey = `${prefix}:session`;
    this.chatKey = `${prefix}:chats`;
  }

  /** This browser's indexed chat ids, most recently used first. */
  chatIds(): readonly string[] {
    try {
      const raw = this.storage?.getItem(this.chatKey) ?? "[]";
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return [
        ...new Set(parsed.filter((id): id is string => typeof id === "string")),
      ].slice(0, MAX_INDEXED_CHATS);
    } catch {
      return [];
    }
  }

  /**
   * Add one chat to the index without reordering anything. Display order is
   * the host's `updatedAt`, so merely opening a chat must not move it — the
   * index is membership only.
   */
  addChat(sessionId: string): void {
    try {
      if (this.chatIds().includes(sessionId)) return;
      const next = [sessionId, ...this.chatIds()].slice(0, MAX_INDEXED_CHATS);
      this.storage?.setItem(this.chatKey, JSON.stringify(next));
    } catch {
      // A denied localStorage write must not prevent the bound chat.
    }
  }

  forgetChat(sessionId: string): void {
    try {
      const next = this.chatIds().filter((id) => id !== sessionId);
      this.storage?.setItem(this.chatKey, JSON.stringify(next));
    } catch {
      // A denied localStorage removal is harmless; the id is revalidated later.
    }
  }

  /** The persisted chat id this browser reopens on load, or null. */
  activeId(): string | null {
    try {
      const value = this.storage?.getItem(this.sessionKey)?.trim() ?? "";
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }

  saveActive(sessionId: string): void {
    try {
      this.storage?.setItem(this.sessionKey, sessionId);
    } catch {
      // A denied localStorage write must not prevent a real DSH session.
    }
  }

  clearActive(): void {
    try {
      this.storage?.removeItem(this.sessionKey);
    } catch {
      // A denied localStorage removal is harmless; the id is revalidated later.
    }
  }
}
