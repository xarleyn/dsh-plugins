/**
 * Per-chat cache of resolved attachment URLs. Attachment reads are
 * session-scoped (the loader reads the bound session's durable store), and
 * attachment ids are only unique within a chat, so both the cache and the
 * blob lifetime are keyed by chat, not by the page.
 */
export class SessionAssetRepository {
  private readonly bySession = new Map<string, Map<string, Promise<string>>>();

  /** Resolve one attachment of one chat, deduplicating concurrent reads. */
  resolve(
    sessionId: string,
    attachmentId: string,
    load: (attachmentId: string) => Promise<string>,
  ): Promise<string> {
    const byAttachment =
      this.bySession.get(sessionId) ?? new Map<string, Promise<string>>();
    this.bySession.set(sessionId, byAttachment);
    let pending = byAttachment.get(attachmentId);
    if (pending === undefined) {
      pending = load(attachmentId);
      byAttachment.set(attachmentId, pending);
      // A failed read must not poison the slot: the broken view retries by
      // re-resolving on demand.
      pending.catch(() => {
        if (byAttachment.get(attachmentId) === pending)
          byAttachment.delete(attachmentId);
      });
    }
    return pending;
  }

  /**
   * Revoke the chat's blob URLs and drop its cache. Data URLs need no
   * revocation; a failed resolution never produced a URL at all.
   */
  release(sessionId: string): void {
    const byAttachment = this.bySession.get(sessionId);
    if (byAttachment === undefined) return;
    this.bySession.delete(sessionId);
    for (const pending of byAttachment.values())
      void pending.then(revokeIfBlob, () => undefined);
  }

  dispose(): void {
    for (const sessionId of [...this.bySession.keys()]) this.release(sessionId);
  }
}

function revokeIfBlob(url: string): void {
  if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}
