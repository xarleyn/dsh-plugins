import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QaAccountsError } from "./accounts/errors.js";
import type { QaAccounts } from "./accounts/store.js";
import {
  conversationSessions,
  locateSessionDirectories,
  type QaSessionListing,
  type QaSessionLogReader,
  type QaStoredSessionEraser,
  type QaStoredSessionHeader,
} from "./admin/session-log.js";
import type { QaChatSharingStore } from "./chat-sharing/store.js";
import type { QaChatDeletionResult } from "./types.js";

const CHAT_DELETION_LIST_TIMEOUT_MS = 30_000;

interface ChatDeletionOptions {
  readonly log: QaSessionLogReader;
  readonly files: QaStoredSessionEraser;
  readonly sharing: () => QaChatSharingStore;
  readonly logger: Pick<PluginLogger, "warn" | "info">;
  readonly dropMetadata: (sessions: readonly string[]) => void;
  readonly fenceLive: (sessionId: string) => void;
  readonly home?: string;
}

interface ChatDeletionListing {
  readonly added: ReadonlyMap<string, QaStoredSessionHeader>;
  readonly result: Promise<QaSessionListing>;
  readonly stop: (() => void) | undefined;
  waiters: number;
}

/**
 * Retire the IDs before touching the filesystem. Retrying an interrupted
 * erasure can only remove the remaining files, never reopen a partial tree.
 */
export class QaChatDeletion {
  private recovering = false;
  private listing: ChatDeletionListing | undefined;

  constructor(private readonly options: ChatDeletionOptions) {}

  async request(
    accounts: QaAccounts,
    token: string,
    rootId: string,
  ): Promise<QaChatDeletionResult> {
    const actor = accounts.chatDeletionActor(token, rootId);
    if (actor.previous !== undefined) return { state: actor.previous };

    return await this.withListing((headers) => {
      const current = accounts.chatDeletionActor(token, rootId);
      if (current.previous !== undefined) return { state: current.previous };
      const root = headers.find((header) => header.id === rootId);
      if (root?.parentSessionId !== undefined && root.isFork !== true)
        throw new QaAccountsError(
          "conversation-unknown",
          "This chat is unavailable.",
        );
      const targets = conversationSessions([rootId], headers);
      locateSessionDirectories(
        targets,
        this.required(targets, headers),
        this.options.home,
      );
      this.options.sharing().withoutChatGrants(targets, () => {
        accounts.markChatDeletion(rootId, current.ownerId, targets);
      });
      return { state: this.finish(accounts, rootId, headers) };
    });
  }

  async recover(accounts: QaAccounts): Promise<void> {
    if (this.recovering) return;
    const roots = accounts.pendingChatDeletions();
    if (roots.length === 0) return;
    this.recovering = true;
    try {
      await this.withListing((headers) => {
        for (const rootId of roots) {
          const owner = accounts.pendingChatOwner(rootId);
          if (owner === undefined) continue;
          try {
            const targets = conversationSessions(
              accounts.chatDeletionTargets(rootId),
              headers,
            );
            accounts.markChatDeletion(rootId, owner, targets);
            this.finish(accounts, rootId, headers);
          } catch {
            this.options.logger.warn("chat.deletion-pending", {
              sessionId: rootId,
            });
          }
        }
      });
    } catch {
      this.options.logger.warn("chat.deletion-list-unavailable");
    } finally {
      this.recovering = false;
    }
  }

  private startListing(): ChatDeletionListing {
    const added = new Map<string, QaStoredSessionHeader>();
    const stop = this.options.log.watchCreated?.((header) =>
      added.set(header.id, header),
    );
    // Keep one scan and one watcher from the start of enumeration through
    // every joined deletion decision. A later caller can otherwise miss a
    // delegated session created and released during the shared scan.
    return {
      added,
      result: Promise.resolve().then(() =>
        this.options.log.list({ timeoutMs: CHAT_DELETION_LIST_TIMEOUT_MS }),
      ),
      stop,
      waiters: 0,
    };
  }

  private async withListing<T>(
    work: (headers: readonly QaStoredSessionHeader[]) => T,
  ): Promise<T> {
    const listing = (this.listing ??= this.startListing());
    listing.waiters += 1;
    try {
      const result = await listing.result;
      if (!result.complete)
        throw new QaAccountsError(
          "conversation-list-incomplete",
          "The Host cannot enumerate the complete session tree.",
        );
      return work([
        ...result.headers.filter(({ id }) => !listing.added.has(id)),
        ...listing.added.values(),
      ]);
    } finally {
      if (this.listing === listing) this.listing = undefined;
      listing.waiters -= 1;
      if (listing.waiters === 0) listing.stop?.();
    }
  }

  private required(
    targets: readonly string[],
    headers: readonly QaStoredSessionHeader[],
  ): ReadonlySet<string> {
    const targetSet = new Set(targets);
    return new Set(
      headers.map(({ id }) => id).filter((id) => targetSet.has(id)),
    );
  }

  private finish(
    accounts: QaAccounts,
    rootId: string,
    headers: readonly QaStoredSessionHeader[],
  ): QaChatDeletionResult["state"] {
    try {
      const sharing = this.options.sharing();
      let held = false;
      sharing.storage.transaction(() => {
        accounts.finishChatDeletion(rootId, (targets) => {
          const live = targets.filter((id) => this.options.log.live(id));
          for (const id of live) this.options.fenceLive(id);
          held = live.length > 0;
          if (held) return false;
          this.options.files.erase(targets, this.required(targets, headers));
          this.options.dropMetadata(targets);
          for (const id of targets) sharing.dropSession(id);
          return true;
        });
      });
      if (held) return "pending";
      this.options.logger.info("chat.deleted", { sessionId: rootId });
      return "deleted";
    } catch {
      this.options.logger.warn("chat.deletion-pending", { sessionId: rootId });
      return "pending";
    }
  }
}
