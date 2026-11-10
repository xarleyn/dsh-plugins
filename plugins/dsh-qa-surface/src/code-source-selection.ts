import { SqliteDatabase } from "@yadsh/dsh-plugin-kit/sqlite";
import type { CodeSourcesCatalog } from "@yadsh/dsh-plugin-kit/code-sources";
import type { QaChatCodeSources } from "./types/code-sources.js";
import { qaDelegatedHeader } from "./shared/session-lineage.js";

export interface CodeSourceSession {
  readonly header: {
    readonly parentSession?: unknown;
    readonly isSeeded?: boolean;
    readonly origin?: unknown;
  };
}

/** Durable chat preference and immutable snapshots for delegated/forked children. */
export class QaCodeSourceSelection {
  readonly storage: SqliteDatabase;
  constructor(
    filePath: string,
    private readonly configured: () => CodeSourcesCatalog,
    private readonly session: (id: string) => CodeSourceSession | undefined,
    private readonly busy: (id: string) => boolean,
  ) {
    this.storage = new SqliteDatabase(filePath, [
      {
        version: 1,
        up: `
      CREATE TABLE selections (session_id TEXT PRIMARY KEY, source_id TEXT);
    `,
      },
    ]);
  }

  private stored(id: string): { source_id: string | null } | undefined {
    return this.storage.db
      .prepare("SELECT source_id FROM selections WHERE session_id=?")
      .get(id) as { source_id: string | null } | undefined;
  }

  /** Resolve old/resumed children through their durable lineage when no snapshot exists. */
  selected(id: string): string | null {
    const seen = new Set<string>();
    let current = id;
    while (!seen.has(current) && seen.size < 64) {
      seen.add(current);
      const stored = this.stored(current);
      if (stored !== undefined) return stored.source_id;
      const header = this.session(current)?.header;
      if (header === undefined && current !== id)
        throw new Error(
          "Code source parent session is unavailable; no default was substituted.",
        );
      if (
        header === undefined ||
        !qaDelegatedHeader(header) ||
        typeof header.parentSession !== "string"
      )
        return null;
      current = header.parentSession;
    }
    throw new Error("Code source session lineage is unavailable.");
  }

  catalog(id?: string): CodeSourcesCatalog {
    const catalog = this.configured();
    const source = id === undefined ? null : this.selected(id);
    // Preserve a removed id: the tool resolver must refuse, never silently switch.
    return source === null ? catalog : { ...catalog, defaultSource: source };
  }

  view(id: string, owner: boolean): QaChatCodeSources {
    const selectedSource = this.selected(id);
    const catalog = this.catalog(id);
    const effectiveSource =
      catalog.defaultSource ||
      (catalog.entries.length === 1 ? catalog.entries[0]!.id : null);
    return {
      selectedSource,
      effectiveSource,
      entries: catalog.entries.map(({ id, label }) => ({ id, label })),
      unavailable:
        effectiveSource !== null &&
        !catalog.entries.some((entry) => entry.id === effectiveSource),
      writable:
        owner &&
        !qaDelegatedHeader(this.session(id)?.header ?? {}) &&
        !this.busy(id),
    };
  }

  select(id: string, source: string | null): QaChatCodeSources {
    if (this.busy(id))
      throw new Error(
        "Дождитесь завершения ответа и очереди перед сменой версии.",
      );
    if (qaDelegatedHeader(this.session(id)?.header ?? {}))
      throw new Error("Источник подагента задаётся родительским чатом.");
    if (
      source !== null &&
      (typeof source !== "string" ||
        !this.configured().entries.some((entry) => entry.id === source))
    )
      throw new Error("Выбранный источник кода недоступен.");
    this.save(id, source);
    return this.view(id, true);
  }

  inherit(id: string, parent: string, managedParent = false): void {
    const parentPreference = this.stored(parent);
    if (!managedParent && parentPreference === undefined) return;
    if (this.stored(id) !== undefined) return;
    const catalog = this.catalog(parent);
    if (catalog.entries.length === 0 && parentPreference === undefined) return;
    this.save(
      id,
      catalog.defaultSource ||
        (catalog.entries.length === 1 ? catalog.entries[0]!.id : null),
    );
  }

  private save(id: string, source: string | null): void {
    this.storage.db
      .prepare(
        "INSERT INTO selections(session_id,source_id) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET source_id=excluded.source_id",
      )
      .run(id, source);
  }
  close(): void {
    this.storage.close();
  }
}
