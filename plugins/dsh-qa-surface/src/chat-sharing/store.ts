import { SqliteDatabase } from "@yadsh/dsh-plugin-kit/sqlite";
import type { QaAccounts } from "../accounts/store.js";
import type {
  QaChatAccess,
  QaChatGrant,
  QaChatMode,
  QaChatAuthor,
} from "./types.js";

/** Separate schema: installing sharing does not upgrade the accounts CLI's DB. */
export class QaChatSharingStore {
  readonly storage: SqliteDatabase;
  constructor(
    filePath: string,
    private readonly accounts: () => QaAccounts,
  ) {
    this.storage = new SqliteDatabase(filePath, [
      {
        version: 1,
        up: `
      CREATE TABLE grants (session_id TEXT NOT NULL, owner_id TEXT NOT NULL,
        user_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('read','collaborate')),
        revision INTEGER NOT NULL, PRIMARY KEY(session_id,user_id));
      CREATE TABLE authors (session_id TEXT NOT NULL, request_id TEXT NOT NULL,
        user_id TEXT NOT NULL, display_name TEXT NOT NULL, grant_revision INTEGER,
        PRIMARY KEY(session_id,request_id));
      CREATE TABLE revisions (session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    `,
      },
    ]);
  }

  access(token: string, sessionId: string): QaChatAccess {
    const accounts = this.accounts();
    const actor = accounts.currentUser(token);
    const ownerId = accounts.ownerIdOf(sessionId);
    const owner =
      ownerId === undefined ? undefined : accounts.accountById(ownerId);
    if (owner === undefined) throw new Error("Chat access is unavailable.");
    if (actor.id === owner.id)
      return {
        sessionId,
        ownerId: owner.id,
        ownerName: owner.displayName,
        actorId: actor.id,
        mode: "owner",
        revision: 0,
      };
    const grant = this.storage.db
      .prepare(
        "SELECT mode, revision FROM grants WHERE session_id=? AND owner_id=? AND user_id=?",
      )
      .get(sessionId, owner.id, actor.id) as
      { mode: QaChatMode; revision: number } | undefined;
    if (grant === undefined) throw new Error("Chat access is unavailable.");
    return {
      sessionId,
      ownerId: owner.id,
      ownerName: owner.displayName,
      actorId: actor.id,
      mode: grant.mode,
      revision: grant.revision,
    };
  }

  owner(token: string, sessionId: string): QaChatAccess {
    const access = this.access(token, sessionId);
    if (access.mode !== "owner")
      throw new Error("This action requires the chat owner.");
    return access;
  }

  write(token: string, sessionId: string): QaChatAccess {
    const access = this.access(token, sessionId);
    if (access.mode === "read") throw new Error("This chat is read-only.");
    return access;
  }

  /** Exact address lookup after ownership, never an account directory. */
  set(
    token: string,
    sessionId: string,
    email: string,
    mode: QaChatMode | null,
  ): readonly QaChatGrant[] {
    this.storage.transaction(() => {
      const access = this.owner(token, sessionId);
      if (mode !== null && mode !== "read" && mode !== "collaborate")
        throw new Error("Invalid chat access mode.");
      const user = this.accounts().findUser(email);
      if (
        user === undefined ||
        (mode !== null && this.accounts().accountById(user.id) === undefined) ||
        user.id === access.ownerId
      )
        throw new Error("The recipient account is unavailable.");
      this.storage.db
        .prepare(
          `INSERT INTO revisions VALUES (?,1)
        ON CONFLICT(session_id) DO UPDATE SET revision=revision+1`,
        )
        .run(sessionId);
      const { revision } = this.storage.db
        .prepare("SELECT revision FROM revisions WHERE session_id=?")
        .get(sessionId) as { revision: number };
      if (mode === null)
        this.storage.db
          .prepare("DELETE FROM grants WHERE session_id=? AND user_id=?")
          .run(sessionId, user.id);
      else
        this.storage.db
          .prepare(
            `INSERT INTO grants VALUES (?,?,?,?,?)
        ON CONFLICT(session_id,user_id) DO UPDATE SET owner_id=excluded.owner_id,
        mode=excluded.mode, revision=excluded.revision`,
          )
          .run(sessionId, access.ownerId, user.id, mode, revision);
    });
    return this.grants(token, sessionId);
  }

  grants(token: string, sessionId: string): readonly QaChatGrant[] {
    const owner = this.owner(token, sessionId);
    const rows = this.storage.db
      .prepare(
        "SELECT user_id,mode FROM grants WHERE session_id=? AND owner_id=?",
      )
      .all(sessionId, owner.ownerId) as unknown as {
      user_id: string;
      mode: QaChatMode;
    }[];
    return rows.flatMap((row) => {
      // Ownership was checked above. Disabled recipients stay in the owner's
      // management list so their durable grants can still be revoked.
      const user = this.accounts().accountById(row.user_id, true);
      return user === undefined
        ? []
        : [
            {
              userId: user.id,
              email: user.email,
              displayName: user.displayName,
              mode: row.mode,
            },
          ];
    });
  }

  visible(token: string): readonly QaChatAccess[] {
    const actor = this.accounts().currentUser(token);
    const rows = this.storage.db
      .prepare("SELECT session_id FROM grants WHERE user_id=?")
      .all(actor.id) as unknown as { session_id: string }[];
    const ids = new Set([
      ...this.accounts().ownedSessionIds(token),
      ...rows.map((row) => row.session_id),
    ]);
    return [...ids].flatMap((id) => {
      try {
        return [this.access(token, id)];
      } catch {
        return [];
      }
    });
  }

  revalidate(token: string, previous: QaChatAccess): QaChatAccess {
    const current = this.access(token, previous.sessionId);
    if (
      current.actorId !== previous.actorId ||
      current.ownerId !== previous.ownerId ||
      current.mode !== previous.mode ||
      current.revision !== previous.revision
    )
      throw new Error("Chat access changed during the operation.");
    return current;
  }

  recordAuthor(token: string, access: QaChatAccess, requestId: string): void {
    this.revalidate(token, access);
    const actor = this.accounts().currentUser(token);
    this.storage.db
      .prepare("INSERT INTO authors VALUES (?,?,?,?,?)")
      .run(
        access.sessionId,
        requestId,
        actor.id,
        actor.displayName,
        access.mode === "owner" ? null : access.revision,
      );
  }

  authors(token: string, sessionId: string): readonly QaChatAuthor[] {
    this.access(token, sessionId);
    return this.storage.db
      .prepare(
        `SELECT request_id AS requestId, user_id AS userId,
      display_name AS displayName FROM authors WHERE session_id=?`,
      )
      .all(sessionId) as unknown as QaChatAuthor[];
  }

  requestActor(
    sessionId: string,
    requestId: string,
  ): { userId: string; revision: number | null } | undefined {
    return this.storage.db
      .prepare(
        "SELECT user_id AS userId, grant_revision AS revision FROM authors WHERE session_id=? AND request_id=?",
      )
      .get(sessionId, requestId) as
      { userId: string; revision: number | null } | undefined;
  }

  /** Copy only immutable attribution for the native prefix, never memberships. */
  forkAuthors(
    sourceId: string,
    targetId: string,
    requests: readonly string[],
  ): void {
    this.storage.transaction(() => {
      for (const request of new Set(requests))
        this.storage.db
          .prepare(
            `INSERT INTO authors
        SELECT ?,request_id,user_id,display_name,NULL FROM authors WHERE session_id=? AND request_id=?`,
          )
          .run(targetId, sourceId, request);
    });
  }

  dropSession(id: string): void {
    this.storage.transaction(() => {
      this.storage.db.prepare("DELETE FROM grants WHERE session_id=?").run(id);
      this.storage.db.prepare("DELETE FROM authors WHERE session_id=?").run(id);
      this.storage.db
        .prepare(
          `INSERT INTO revisions VALUES (?,1)
        ON CONFLICT(session_id) DO UPDATE SET revision=revision+1`,
        )
        .run(id);
    });
  }

  actorStillAllowed(
    sessionId: string,
    userId: string,
    revision: number,
  ): boolean {
    const ownerId = this.accounts().ownerIdOf(sessionId);
    return (
      this.accounts().accountById(userId) !== undefined &&
      ownerId !== undefined &&
      this.accounts().accountById(ownerId) !== undefined &&
      this.storage.db
        .prepare(
          "SELECT 1 FROM grants WHERE session_id=? AND owner_id=? AND user_id=? AND mode='collaborate' AND revision=?",
        )
        .get(sessionId, ownerId, userId, revision) !== undefined
    );
  }
}
