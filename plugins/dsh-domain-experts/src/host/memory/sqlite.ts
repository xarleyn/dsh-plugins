import type { PluginLoggerLike } from "@yadsh/dsh-plugin-log";
import {
  SqliteDatabase,
  type SqliteMigration,
} from "@yadsh/dsh-plugin-kit/sqlite";
import type { MemoryRecord } from "../../types.js";
import { normalizeNamespace } from "../schema.js";
import {
  buildMemoryRecord,
  clampLimit,
  searchTextOf,
  tokenize,
  type MemoryTable,
} from "./shared.js";
import type { DomainMemoryProvider, MemoryQuery } from "./registry.js";

export const SQLITE_MEMORY_PROVIDER_ID = "sqlite";

/** How a record is addressed here: namespace and key are separate columns. */
const TABLE = "domain_memory";

/** Meta key recording that the unit's memory has been copied in. */
const IMPORT_META_KEY = "memory_import";

const COLUMNS = `${TABLE}.namespace, ${TABLE}.key, ${TABLE}.text, ${TABLE}.tags,
  ${TABLE}.created_at, ${TABLE}.updated_at`;

const MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    up: `
      -- One row per record, so a write touches the row it changes instead of
      -- rewriting every record ever stored. \`tags\` keeps the record's JSON
      -- array; \`search_text\` is the haystack the shared scorer defines, stored
      -- rather than computed in SQL because SQLite folds ASCII letters only
      -- while the query terms come from a Unicode-lowercased tokenizer.
      CREATE TABLE ${TABLE} (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        text TEXT NOT NULL,
        tags TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        search_text TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      ) STRICT;
      -- What every read of one domain's memory is ordered by.
      CREATE INDEX ${TABLE}_by_namespace
        ON ${TABLE} (namespace, updated_at);
    `,
  },
];

export interface SqliteMemoryProviderOptions {
  /** Database file this provider owns. */
  readonly filePath: string;
  /** The plugin's logger, passed through to the SQLite plumbing. */
  readonly logger?: PluginLoggerLike;
  /** Injectable clock, so a test can pin `createdAt` and `updatedAt`. */
  readonly now?: () => number;
}

/** What one import attempt did. */
export interface MemoryImportReport {
  readonly outcome:
    | "imported"
    | "already-imported"
    /** The database already held records, so nothing was overwritten. */
    | "kept-existing"
    /** The unit held nothing, so there was nothing to copy. */
    | "nothing-to-import";
  readonly records: number;
  readonly namespaces: number;
}

/** The provider plus the one-time migration step a deployment runs. */
export interface SqliteMemoryProvider extends DomainMemoryProvider {
  readonly filePath: string;
  /**
   * Copy the memory table of the storage unit into this database, once.
   *
   * The unit is left exactly as it was: that copy is the rollback path, and a
   * deployment that has checked the import can retire it.
   */
  importFromUnit(table: MemoryTable): MemoryImportReport;
  close(): void;
}

interface Row {
  readonly namespace: string;
  readonly key: string;
  readonly text: string;
  readonly tags: string;
  readonly created_at: number;
  readonly updated_at: number;
}

type SourceEntry = readonly [string, MemoryRecord];

/** SQLite hands back untyped, null-prototype records. */
function asRows<T>(value: unknown): T[] {
  return value as T[];
}

/**
 * Durable memory in a database of the plugin's own.
 *
 * The built-in provider answers from the storage unit's in-memory snapshot,
 * which its JSON backend rewrites whole on every write; this one keeps the same
 * records in a file where a write costs one row and clearing a namespace costs
 * one statement. The two share the scorer in `./shared.js` and are held to the
 * same answers by the parity test, because an expert that recalls different
 * memories after a deployment changed where they live is a regression no
 * operator would notice.
 */
export function createSqliteMemoryProvider(
  options: SqliteMemoryProviderOptions,
): SqliteMemoryProvider {
  const { filePath, logger } = options;
  const now = options.now ?? Date.now;
  const store = new SqliteDatabase(filePath, MIGRATIONS, {
    logger,
    label: "domain-experts-memory",
  });
  const db = store.db;

  const restore = (row: Row): MemoryRecord => ({
    namespace: row.namespace,
    key: row.key,
    text: row.text,
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const rowOf = (namespace: string, key: string): Row | undefined =>
    db
      .prepare(
        `SELECT ${COLUMNS} FROM ${TABLE} WHERE namespace = ? AND key = ?`,
      )
      .get(namespace, key) as Row | undefined;

  const insert = db.prepare(
    `INSERT INTO ${TABLE}
       (namespace, key, text, tags, created_at, updated_at, search_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const provider: SqliteMemoryProvider = {
    id: SQLITE_MEMORY_PROVIDER_ID,
    title: "SQLite memory",
    builtin: false,
    filePath,

    listNamespaces(): readonly string[] {
      const rows = db
        .prepare(`SELECT DISTINCT namespace FROM ${TABLE}`)
        .all() as { namespace: string }[];
      return rows
        .map((row) => row.namespace)
        .sort((left, right) => left.localeCompare(right, "en"));
    },

    async retrieve(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
      const terms = tokenize(query.query);
      const limit = clampLimit(query.limit);
      if (query.namespaces.length === 0) return [];

      // The predicate the built-in provider applies in JavaScript, pushed into
      // SQL: a record matches a term when the term is a substring of its search
      // text, and its score is the number of terms it contains. The tie-break
      // is the shared comparator's, in the collation SQLite itself sorts by.
      //
      // Named parameters, because the same term appears twice — once to score
      // the row in the select list, once to filter it — and a positional list
      // has to be written in the order the SQL text mentions them, which is not
      // the order a reader expects.
      const placeholders = query.namespaces
        .map((_unused, index) => `$n${String(index)}`)
        .join(", ");
      const params: Record<string, string | number> = { limit };
      query.namespaces.forEach((namespace, index) => {
        params[`n${String(index)}`] = namespace;
      });
      terms.forEach((term, index) => {
        params[`t${String(index)}`] = term;
      });
      const hit = terms.map(
        (_unused, index) => `(instr(search_text, $t${String(index)}) > 0)`,
      );
      const sql = `
        SELECT ${COLUMNS}, ${terms.length === 0 ? "0" : hit.join(" + ")} AS hits
          FROM ${TABLE}
         WHERE namespace IN (${placeholders})
           ${terms.length === 0 ? "" : `AND (${hit.join(" OR ")})`}
         ORDER BY hits DESC, updated_at DESC, namespace ASC, key ASC
         LIMIT $limit`;

      const rows = asRows<Row & { hits: number }>(db.prepare(sql).all(params));
      return rows.map(restore);
    },

    async inspect(namespace: string): Promise<readonly MemoryRecord[]> {
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM ${TABLE}
            WHERE namespace = ? ORDER BY updated_at DESC, key ASC`,
        )
        .all(normalizeNamespace(namespace)) as unknown as Row[];
      return rows.map(restore);
    },

    async remember(
      namespace: string,
      key: string,
      text: string,
      tags: readonly string[] = [],
    ): Promise<MemoryRecord> {
      const normalizedNamespace = normalizeNamespace(namespace);
      const trimmedKey = key.trim();
      return store.transaction(() => {
        const existing = rowOf(normalizedNamespace, trimmedKey);
        const record = buildMemoryRecord(
          { namespace: normalizedNamespace, key, text, tags },
          existing === undefined ? undefined : restore(existing),
          now(),
        );
        db.prepare(
          `INSERT INTO ${TABLE}
             (namespace, key, text, tags, created_at, updated_at, search_text)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(namespace, key) DO UPDATE SET
             text = excluded.text,
             tags = excluded.tags,
             updated_at = excluded.updated_at,
             search_text = excluded.search_text`,
        ).run(
          record.namespace,
          record.key,
          record.text,
          JSON.stringify(record.tags),
          record.createdAt,
          record.updatedAt,
          searchTextOf(record),
        );
        return record;
      });
    },

    async forget(namespace: string, key: string): Promise<boolean> {
      const info = db
        .prepare(`DELETE FROM ${TABLE} WHERE namespace = ? AND key = ?`)
        .run(normalizeNamespace(namespace), key.trim());
      return Number(info.changes) > 0;
    },

    async clear(namespace: string): Promise<number> {
      // One statement, where the built-in provider deletes record by record.
      const info = db
        .prepare(`DELETE FROM ${TABLE} WHERE namespace = ?`)
        .run(normalizeNamespace(namespace));
      return Number(info.changes);
    },

    importFromUnit(table: MemoryTable): MemoryImportReport {
      const marker = store.meta(IMPORT_META_KEY);
      if (marker !== undefined) {
        const seen = JSON.parse(marker) as {
          records?: number;
          namespaces?: number;
        };
        return {
          outcome: "already-imported",
          records: seen.records ?? 0,
          namespaces: seen.namespaces ?? 0,
        };
      }
      const held = countRows(db);
      if (held > 0) {
        // The database has records of its own already: a deployment that ran
        // before this marker existed, or one that has been writing through this
        // provider. Those records win — an import must never be able to
        // un-write memory.
        // Those records win — an import must never be able to un-write memory.
        return { outcome: "kept-existing", records: held, namespaces: 0 };
      }
      const source: readonly SourceEntry[] = [...table.entries()];
      if (source.length === 0) {
        return { outcome: "nothing-to-import", records: 0, namespaces: 0 };
      }

      store.transaction(() => {
        for (const [, record] of source) {
          insert.run(
            record.namespace,
            record.key,
            record.text,
            JSON.stringify(record.tags),
            record.createdAt,
            record.updatedAt,
            searchTextOf(record),
          );
        }
        // Checked inside the transaction: a mismatch rolls the whole import
        // back, so a failed migration leaves the memory where it was.
        assertImportArrived(source, db);
      });

      const namespaces = new Set(source.map(([, record]) => record.namespace));
      store.setMeta(
        IMPORT_META_KEY,
        JSON.stringify({
          outcome: "imported",
          records: source.length,
          namespaces: namespaces.size,
          at: new Date(now()).toISOString(),
        }),
      );
      return {
        outcome: "imported",
        records: source.length,
        namespaces: namespaces.size,
      };
    },

    close(): void {
      store.close();
    },
  };

  return provider;
}

function countRows(db: SqliteDatabase["db"]): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${TABLE}`).get() as {
      count: number;
    }
  ).count;
}

/**
 * Compare the copy against the original record by record, not by counter alone.
 *
 * The counter catches a row that never landed; this catches a row that landed
 * wrongly — a tag dropped in serialization, a timestamp that arrived as a
 * string, a text re-truncated on the way in. Any of those throws, the
 * transaction rolls back, and the storage unit still holds every record.
 */
function assertImportArrived(
  source: readonly SourceEntry[],
  db: SqliteDatabase["db"],
): void {
  const problems: string[] = [];
  const select = db.prepare(
    `SELECT text, tags, created_at, updated_at FROM ${TABLE}
      WHERE namespace = ? AND key = ?`,
  );
  for (const [, record] of source) {
    const row = select.get(record.namespace, record.key) as
      | {
          text: string;
          tags: string;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (row === undefined) {
      problems.push(`${record.namespace}/${record.key} did not arrive`);
      continue;
    }
    if (row.text !== record.text) {
      problems.push(`${record.namespace}/${record.key} has different text`);
    }
    if (JSON.stringify(JSON.parse(row.tags)) !== JSON.stringify(record.tags)) {
      problems.push(`${record.namespace}/${record.key} has different tags`);
    }
    if (row.created_at !== record.createdAt) {
      problems.push(`${record.namespace}/${record.key} has a new createdAt`);
    }
    if (row.updated_at !== record.updatedAt) {
      problems.push(`${record.namespace}/${record.key} has a new updatedAt`);
    }
  }
  const rows = countRows(db);
  if (rows !== source.length) {
    problems.push(`${TABLE} holds ${rows} rows for ${source.length} records`);
  }
  if (problems.length > 0) {
    throw new Error(
      `domain-experts: importing the storage unit's memory failed verification (${problems.join(
        "; ",
      )}); the import was rolled back and the unit still holds every record`,
    );
  }
}
