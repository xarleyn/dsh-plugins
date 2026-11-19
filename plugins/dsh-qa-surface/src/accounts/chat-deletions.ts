import type {
  SqliteDatabase,
  SqliteMigration,
} from "@yadsh/dsh-plugin-kit/sqlite";
import { QaAccountsError } from "./errors.js";

export const chatDeletionMigration: SqliteMigration = {
  version: 8,
  up: `
      ALTER TABLE qa_ownership ADD COLUMN qa_owner_delete INTEGER NOT NULL DEFAULT 0;
      UPDATE qa_ownership SET qa_owner_delete=1 WHERE snapshot_hash IS NOT NULL;
      CREATE TABLE qa_deleted_chats (
        session_id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        owner_id TEXT,
        pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1))
      );
      CREATE INDEX qa_deleted_chats_root ON qa_deleted_chats(root_id);
      CREATE INDEX qa_deleted_chats_pending ON qa_deleted_chats(pending) WHERE pending = 1;
    `,
};

export class QaAccountChatDeletions {
  constructor(
    private readonly storage: SqliteDatabase,
    private readonly removeOwnership: (sessionIds: readonly string[]) => void,
  ) {}

  chatDeleted(sessionId: string): boolean {
    return (
      this.storage.db
        .prepare("SELECT 1 FROM qa_deleted_chats WHERE session_id=?")
        .get(sessionId) !== undefined
    );
  }

  ownerCanDeleteChat(sessionId: string): boolean {
    return (
      this.storage.db
        .prepare(
          "SELECT 1 FROM qa_ownership WHERE session_id=? AND qa_owner_delete=1",
        )
        .get(sessionId) !== undefined
    );
  }

  chatDeletion(
    rootId: string,
  ): { ownerId: string; pending: number } | undefined {
    return this.storage.db
      .prepare(
        "SELECT owner_id AS ownerId, pending FROM qa_deleted_chats WHERE session_id=? AND root_id=session_id",
      )
      .get(rootId) as { ownerId: string; pending: number } | undefined;
  }

  pendingChatDeletions(): readonly string[] {
    return (
      this.storage.db
        .prepare(
          "SELECT session_id AS id FROM qa_deleted_chats WHERE pending=1",
        )
        .all() as { id: string }[]
    ).map(({ id }) => id);
  }

  chatDeletionTargets(rootId: string): readonly string[] {
    return (
      this.storage.db
        .prepare(
          "SELECT session_id AS id FROM qa_deleted_chats WHERE root_id=?",
        )
        .all(rootId) as { id: string }[]
    ).map(({ id }) => id);
  }

  /** Fence QA access before any directory is erased. Old IDs stay retired. */
  markChatDeletion(
    rootId: string,
    ownerId: string,
    targets: readonly string[],
  ): void {
    this.storage.transaction(() => {
      const db = this.storage.db;
      const previous = this.chatDeletion(rootId);
      const owner = db
        .prepare(
          "SELECT user_id AS id FROM qa_ownership WHERE session_id=? AND qa_owner_delete=1",
        )
        .get(rootId) as { id: string } | undefined;
      if (
        previous
          ? previous.ownerId !== ownerId || previous.pending !== 1
          : owner?.id !== ownerId
      )
        throw new QaAccountsError(
          "conversation-unknown",
          "This chat is unavailable.",
        );
      const insert = db.prepare(
        "INSERT INTO qa_deleted_chats (session_id, root_id, owner_id, pending) VALUES (?,?,?,?) ON CONFLICT(session_id) DO NOTHING",
      );
      const targetOwner = db.prepare(
        "SELECT user_id AS id FROM qa_ownership WHERE session_id=?",
      );
      for (const id of targets) {
        const owned = targetOwner.get(id) as { id: string } | undefined;
        if (owned !== undefined && owned.id !== ownerId)
          throw new QaAccountsError(
            "conversation-not-removable",
            "The session tree contains a separately owned chat.",
          );
        insert.run(
          id,
          rootId,
          id === rootId ? ownerId : null,
          Number(id === rootId),
        );
      }
    });
  }

  finishChatDeletion(
    rootId: string,
    erase: (targets: readonly string[]) => boolean,
  ): void {
    this.storage.transaction(() => {
      if (this.chatDeletion(rootId)?.pending !== 1) return;
      const db = this.storage.db;
      const targets = this.chatDeletionTargets(rootId);
      if (!erase(targets)) return;
      this.removeOwnership(targets);
      db.prepare(
        "UPDATE qa_deleted_chats SET pending=0 WHERE session_id=?",
      ).run(rootId);
    });
  }
}
