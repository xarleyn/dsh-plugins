import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "@yadsh/dsh-plugin-kit/sqlite";
import { writeRemovalQuality } from "../admin/quality-store.js";
import { dropAttachedUserSharing } from "../chat-sharing/store.js";
import type { QaAdminAuditEvent } from "../types.js";

interface RemovalStores {
  readonly qualityPath: string;
  readonly sharingPath?: string;
}

interface RemovalRow {
  readonly user_id: string;
  readonly quality_path: string;
  readonly sharing_path: string | null;
  readonly audit_json: string;
}

export const removalJournalMigration = {
  version: 7,
  up: `
    CREATE TABLE qa_account_removals (
      user_id TEXT PRIMARY KEY, quality_path TEXT NOT NULL, sharing_path TEXT,
      audit_json TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0 CHECK(applied IN (0,1))
    );
    CREATE TABLE qa_pending_session_removals (
      session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES qa_account_removals(user_id) ON DELETE CASCADE
    );
    CREATE INDEX qa_pending_removals_by_user ON qa_pending_session_removals(user_id);`,
};

/** FULL orders the durable decision, destination receipts, and final acknowledgement
 * across separate WAL files. Each commit below may safely be the last before restart. */
export function withRemovalStores<T>(
  db: DatabaseSync,
  stores: RemovalStores,
  work: () => T,
): T {
  const previous = db.prepare("PRAGMA main.synchronous").get()!
    .synchronous as number;
  const attached: string[] = [];
  try {
    db.exec("PRAGMA main.synchronous=FULL");
    for (const [schema, file] of [
      ["qa_quality", stores.qualityPath],
      ["qa_sharing", stores.sharingPath],
    ] as const) {
      if (file === undefined) continue;
      if (!existsSync(file))
        throw new Error("Account removal database is unavailable: " + schema);
      db.prepare(`ATTACH DATABASE ? AS ${schema}`).run(path.resolve(file));
      attached.push(schema);
      db.exec(`PRAGMA ${schema}.synchronous=FULL`);
    }
    return work();
  } finally {
    for (const schema of attached.reverse())
      db.exec(`DETACH DATABASE ${schema}`);
    db.exec(`PRAGMA main.synchronous=${previous}`);
  }
}

export function journalAccountRemoval(
  db: DatabaseSync,
  userId: string,
  stores: RemovalStores,
  audit: QaAdminAuditEvent,
  sessions: readonly string[],
): void {
  db.prepare(
    "INSERT INTO qa_account_removals(user_id, quality_path, sharing_path, audit_json) VALUES(?,?,?,?)",
  ).run(
    userId,
    path.resolve(stores.qualityPath),
    stores.sharingPath ? path.resolve(stores.sharingPath) : null,
    JSON.stringify(audit),
  );
  const reserve = db.prepare(
    "INSERT INTO qa_pending_session_removals(session_id,user_id) VALUES(?,?)",
  );
  for (const session of sessions) reserve.run(session, userId);
}

function applyOnce(
  db: DatabaseSync,
  schema: "qa_quality" | "qa_sharing",
  receipt: string,
  apply: () => void,
): void {
  // The receipt and the data it describes always live in the SAME database.
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO ${schema}.qa_meta(key,value) VALUES(?, '1')`,
    )
    .run(receipt);
  if (result.changes) apply();
}

function replay(storage: SqliteDatabase, row: RemovalRow): void {
  const db = storage.db;
  const audit = JSON.parse(row.audit_json) as QaAdminAuditEvent;
  const receipt = "account-removal/" + audit.id;
  const state = db.prepare(
    "SELECT applied FROM qa_account_removals WHERE user_id=?",
  );
  const id = row.user_id;
  const sessions = db
    .prepare(
      "SELECT session_id FROM qa_pending_session_removals WHERE user_id=?",
    )
    .all(id)
    .map((row) => String(row.session_id));
  if (row.sharing_path !== null)
    storage.transaction(() => {
      if (state.get(id)?.applied === 0)
        applyOnce(db, "qa_sharing", receipt, () =>
          dropAttachedUserSharing(db, id, sessions),
        );
    });
  storage.transaction(() => {
    if (state.get(id)?.applied === 0)
      applyOnce(db, "qa_quality", receipt, () =>
        writeRemovalQuality(db, audit, sessions),
      );
  });
  // A destination and its receipt are durable before the accounts checkpoint.
  storage.transaction(() =>
    db
      .prepare(
        "UPDATE qa_account_removals SET applied=1 WHERE user_id=? AND applied=0",
      )
      .run(id),
  );
  storage.transaction(() => {
    if (state.get(id)?.applied !== 1) return;
    db.prepare("DELETE FROM qa_quality.qa_meta WHERE key=?").run(receipt);
    if (row.sharing_path !== null)
      db.prepare("DELETE FROM qa_sharing.qa_meta WHERE key=?").run(receipt);
  });
  storage.transaction(() =>
    db
      .prepare("DELETE FROM qa_account_removals WHERE user_id=? AND applied=1")
      .run(id),
  );
}

export function recoverAccountRemovals(
  storage: SqliteDatabase,
  userId?: string,
): void {
  const select =
    "SELECT user_id,quality_path,sharing_path,audit_json FROM qa_account_removals";
  const rows = (userId === undefined
    ? storage.db.prepare(select).all()
    : storage.db
        .prepare(select + " WHERE user_id=?")
        .all(userId)) as unknown as RemovalRow[];
  const errors: unknown[] = [];
  for (const row of rows) {
    try {
      withRemovalStores(
        storage.db,
        {
          qualityPath: row.quality_path,
          ...(row.sharing_path === null
            ? {}
            : { sharingPath: row.sharing_path }),
        },
        () => replay(storage, row),
      );
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      "Pending account removal could not be reconciled",
      { cause: errors[0] },
    );
}
