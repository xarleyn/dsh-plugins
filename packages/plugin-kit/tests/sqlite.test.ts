import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SqliteDatabase,
  SqliteStoreError,
  type SqliteMigration,
} from "../src/sqlite.js";

const MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    up: "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
  },
  {
    version: 2,
    up: "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
  },
];

function tempFile(name = "store.db"): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "qa-sqlite-")), name);
}

describe("SqliteDatabase", () => {
  it("creates its directory, applies every migration and records the version", () => {
    const file = path.join(
      mkdtempSync(path.join(tmpdir(), "qa-sqlite-")),
      "nested",
      "store.db",
    );
    const store = new SqliteDatabase(file, MIGRATIONS);

    expect(store.schemaVersion).toBe(2);
    store.db
      .prepare("INSERT INTO notes (id, body) VALUES (?, ?)")
      .run("a", "b");
    expect(
      store.db.prepare("SELECT body FROM notes WHERE id = ?").get("a"),
    ).toEqual({
      body: "b",
    });
    store.close();
  });

  it("does not re-run a migration that already landed", () => {
    const file = tempFile();
    new SqliteDatabase(file, MIGRATIONS).close();
    // A plain CREATE TABLE would throw on the second open, so a clean reopen
    // is the assertion that no step ran twice.
    const reopened = new SqliteDatabase(file, MIGRATIONS);
    expect(reopened.schemaVersion).toBe(2);
    reopened.close();
  });

  it("applies only the migrations a database is missing", () => {
    const file = tempFile();
    new SqliteDatabase(file, [MIGRATIONS[0] as SqliteMigration]).close();
    const extended = new SqliteDatabase(file, MIGRATIONS);
    expect(extended.schemaVersion).toBe(2);
    // The step that ran is the new one; the old one would have thrown.
    extended.db
      .prepare("INSERT INTO notes (id, body, pinned) VALUES (?, ?, ?)")
      .run("a", "b", 1);
    extended.close();
  });

  it("refuses a database written by a newer schema", () => {
    const file = tempFile();
    const newer = new SqliteDatabase(file, [
      ...MIGRATIONS,
      { version: 3, up: "CREATE TABLE later (id TEXT PRIMARY KEY)" },
    ]);
    newer.close();

    expect(() => new SqliteDatabase(file, MIGRATIONS)).toThrow(/newer schema/u);
    expect(() => new SqliteDatabase(file, MIGRATIONS)).toThrow(
      SqliteStoreError,
    );
  });

  it("reports a version of zero for a database with no migrations", () => {
    const store = new SqliteDatabase(tempFile(), []);
    expect(store.schemaVersion).toBe(0);
    store.close();
  });

  it("commits a transaction and rolls one back", () => {
    const store = new SqliteDatabase(tempFile(), MIGRATIONS);
    const insert = store.db.prepare(
      "INSERT INTO notes (id, body) VALUES (?, ?)",
    );

    store.transaction(() => {
      insert.run("kept", "yes");
    });
    expect(() =>
      store.transaction(() => {
        insert.run("dropped", "no");
        throw new Error("boom");
      }),
    ).toThrow(/boom/u);

    expect(store.db.prepare("SELECT id FROM notes").all()).toHaveLength(1);
    store.close();
  });

  it("joins a nested transaction to the one in flight", () => {
    const store = new SqliteDatabase(tempFile(), MIGRATIONS);
    const insert = store.db.prepare(
      "INSERT INTO notes (id, body) VALUES (?, ?)",
    );

    store.transaction(() => {
      insert.run("outer", "1");
      store.transaction(() => insert.run("inner", "2"));
    });
    expect(store.db.prepare("SELECT id FROM notes").all()).toHaveLength(2);

    // The inner work is rolled back with the outer one, which is the point of
    // joining rather than opening a second transaction.
    expect(() =>
      store.transaction(() => {
        insert.run("outer-2", "1");
        store.transaction(() => insert.run("inner-2", "2"));
        throw new Error("boom");
      }),
    ).toThrow(/boom/u);
    expect(store.db.prepare("SELECT id FROM notes").all()).toHaveLength(2);
    store.close();
  });

  it("runs in WAL mode so a second process can read it", () => {
    const store = new SqliteDatabase(tempFile(), MIGRATIONS);
    const mode = store.db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(mode.journal_mode).toBe("wal");
    store.close();
  });

  it("keeps the database readable across a reopen", () => {
    const file = tempFile();
    const first = new SqliteDatabase(file, MIGRATIONS);
    first.db
      .prepare("INSERT INTO notes (id, body) VALUES (?, ?)")
      .run("a", "b");
    first.setMeta("secret", "s3cret");
    first.close();

    const second = new SqliteDatabase(file, MIGRATIONS);
    expect(second.meta("secret")).toBe("s3cret");
    expect(readFileSync(file).length).toBeGreaterThan(0);
    second.close();
    expect(statSync(file).isFile()).toBe(true);
  });

  it("refuses to work through a closed database", () => {
    const store = new SqliteDatabase(tempFile(), MIGRATIONS);
    store.close();
    expect(() => store.meta("schema_version")).toThrow(/closed/u);
    expect(() => store.transaction(() => undefined)).toThrow(/closed/u);
  });
});

/** A logger that keeps what the store reported, in the order it reported it. */
function recordingLogger(): {
  readonly events: {
    level: "debug" | "info" | "warn" | "error";
    event: string;
    fields: Record<string, unknown>;
  }[];
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
} {
  const events: {
    level: "debug" | "info" | "warn" | "error";
    event: string;
    fields: Record<string, unknown>;
  }[] = [];
  const push =
    (level: "debug" | "info" | "warn" | "error") =>
    (event: string, fields: Record<string, unknown> = {}): void => {
      events.push({ level, event, fields });
    };
  return {
    events,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
}

describe("SqliteDatabase logging", () => {
  it("reports the open, the version reached and the steps that ran", () => {
    const logger = recordingLogger();
    new SqliteDatabase(tempFile("store.db"), MIGRATIONS, { logger }).close();

    expect(logger.events).toEqual([
      {
        level: "info",
        event: "store/db-opened",
        fields: expect.objectContaining({
          schemaVersion: 2,
          appliedMigrations: [1, 2],
        }),
      },
    ]);
  });

  it("names an reopened database without claiming migrations it did not run", () => {
    const file = tempFile("notes.db");
    new SqliteDatabase(file, MIGRATIONS).close();
    const logger = recordingLogger();
    new SqliteDatabase(file, MIGRATIONS, { logger }).close();

    expect(logger.events).toEqual([
      {
        level: "info",
        event: "notes/db-opened",
        fields: expect.objectContaining({ appliedMigrations: [] }),
      },
    ]);
  });

  it("uses the label a store is given, so two databases tell apart", () => {
    const logger = recordingLogger();
    new SqliteDatabase(tempFile(), MIGRATIONS, {
      logger,
      label: "domain-experts-memory",
    }).close();

    expect(logger.events[0]?.event).toBe("domain-experts-memory/db-opened");
  });

  it("records the refusal it is about to raise", () => {
    const file = tempFile("store.db");
    new SqliteDatabase(file, [
      ...MIGRATIONS,
      { version: 3, up: "CREATE TABLE later (id TEXT PRIMARY KEY)" },
    ]).close();

    const logger = recordingLogger();
    expect(() => new SqliteDatabase(file, MIGRATIONS, { logger })).toThrow(
      /newer schema/u,
    );
    expect(logger.events).toEqual([
      {
        level: "error",
        event: "store/db-refused",
        fields: expect.objectContaining({
          schemaVersion: 3,
          highestKnownVersion: 2,
        }),
      },
    ]);
  });

  it("stays silent when no logger is given", () => {
    // Every store written before this option exists passes two arguments; a
    // required logger would have turned an additive change into their break.
    expect(() =>
      new SqliteDatabase(tempFile(), MIGRATIONS).close(),
    ).not.toThrow();
  });
});
