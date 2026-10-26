import { randomUUID } from "node:crypto";
import { SqliteDatabase } from "@yadsh/dsh-plugin-kit/sqlite";
import { formAssert, QaFormError } from "./errors.js";
import { fingerprint } from "./fingerprint.js";
import type { QaFormRecord, QaFormStoreApi } from "./types.js";

// Node suites import the fingerprint from the store; keep that path working.
export { fingerprint } from "./fingerprint.js";

interface MutationReceipt {
  hash: string;
  result: string;
}

/** Full synchronous commits: snapshot, revision and mutation receipt share one transaction. */
export class QaFormStore implements QaFormStoreApi {
  readonly storage: SqliteDatabase;
  constructor(file: string) {
    this.storage = new SqliteDatabase(file, [
      {
        version: 1,
        up: `
      CREATE TABLE forms (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_key TEXT NOT NULL, state TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(session_id,request_key));
      CREATE UNIQUE INDEX one_draft ON forms(session_id) WHERE state='draft';
      CREATE TABLE mutations (form_id TEXT NOT NULL REFERENCES forms(id), id TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(form_id,id));
      CREATE TABLE resources (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms(id), data BLOB NOT NULL);
    `,
      },
    ]);
    this.storage.db.exec("PRAGMA synchronous = FULL");
    // One Host writer owns live uploads. After restart no old stream is alive.
    this.storage.transaction(() => {
      for (const row of this.storage.db
        .prepare("SELECT document FROM forms WHERE state='draft'")
        .all()) {
        const r = JSON.parse(String(row.document)) as QaFormRecord;
        let changed = false;
        for (const u of r.uploads)
          if (u.state === "pending" || u.state === "uploading") {
            u.state = "failed";
            u.error = "UPLOAD_INTERRUPTED";
            changed = true;
          }
        if (changed) {
          r.revision++;
          this.put(r);
        }
      }
    });
  }
  list(session: string): QaFormRecord[] {
    return this.storage.db
      .prepare(
        "SELECT document FROM forms WHERE session_id=? ORDER BY rowid DESC",
      )
      .all(session)
      .map((row) => JSON.parse(String(row.document)) as QaFormRecord);
  }
  get(session: string, id: string): QaFormRecord {
    const row = this.storage.db
      .prepare("SELECT document FROM forms WHERE session_id=? AND id=?")
      .get(session, id);
    formAssert(row, "ACCESS_DENIED", "Form access is unavailable.");
    const record = JSON.parse(String(row.document)) as QaFormRecord;
    formAssert(
      record.storage_version === 1,
      "STORAGE_UNAVAILABLE",
      "Unsupported form storage version.",
    );
    return record;
  }
  put(record: QaFormRecord): void {
    this.storage.db
      .prepare(
        "INSERT INTO forms(id,session_id,request_key,state,document) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,document=excluded.document",
      )
      .run(
        record.id,
        record.session_id,
        record.request_key,
        record.status,
        JSON.stringify(record),
      );
  }
  create(
    session: string,
    key: string,
    schema: QaFormRecord["schema"],
    creator = session,
  ): QaFormRecord {
    return this.storage.transaction(() => {
      const hash = fingerprint(schema),
        all = this.list(session),
        prior = all.find((r) => r.request_key === key);
      if (prior) {
        formAssert(
          prior.schema_hash === hash,
          "SCHEMA_CONFLICT",
          "This request key already has different requirements.",
        );
        this.editableOrSubmitted(prior);
        return prior;
      }
      const active = all.find((r) => r.status === "draft");
      if (active)
        throw new QaFormError(
          "ACTIVE_FORM_EXISTS",
          `Resume the existing form ${active.id}.`,
        );
      const record: QaFormRecord = {
        storage_version: 1,
        id: randomUUID(),
        session_id: session,
        creator_id: creator,
        request_key: key,
        schema,
        schema_hash: hash,
        status: "draft",
        revision: 0,
        created_at: new Date().toISOString(),
        answers: {},
        attachments: {},
        uploads: [],
        step: 0,
      };
      this.put(record);
      return record;
    });
  }
  editableOrSubmitted(record: QaFormRecord): void {
    formAssert(
      record.status === "draft" || record.status === "submitted",
      record.status === "expired" ? "FORM_EXPIRED" : "FORM_NOT_EDITABLE",
      "This form cannot be edited.",
    );
  }
  private mutationReceipt(formId: string, id: string): MutationReceipt | null {
    const row = this.storage.db
      .prepare("SELECT hash,result FROM mutations WHERE form_id=? AND id=?")
      .get(formId, id);
    return row ? { hash: String(row.hash), result: String(row.result) } : null;
  }
  replayedMutation(
    formId: string,
    mutationId: string,
    input: unknown,
  ): QaFormRecord | null {
    const prior = this.mutationReceipt(formId, mutationId);
    if (!prior) return null;
    formAssert(
      prior.hash === fingerprint(input),
      "IDEMPOTENCY_CONFLICT",
      "The mutation identity was already used for different data.",
    );
    return JSON.parse(prior.result) as QaFormRecord;
  }
  mutate(
    session: string,
    id: string,
    revision: number,
    mutationId: string,
    input: unknown,
    work: (r: QaFormRecord) => void,
  ): QaFormRecord {
    formAssert(
      typeof mutationId === "string" &&
        /^[a-zA-Z0-9_-]{1,100}$/u.test(mutationId),
      "INVALID_REQUEST",
      "A mutation identity is required.",
    );
    return this.storage.transaction(() => {
      const record = this.get(session, id),
        hash = fingerprint(input);
      const prior = this.mutationReceipt(id, mutationId);
      if (prior) {
        formAssert(
          prior.hash === hash,
          "IDEMPOTENCY_CONFLICT",
          "The mutation identity was already used for different data.",
        );
        return JSON.parse(prior.result) as QaFormRecord;
      }
      if (record.revision !== revision)
        throw new QaFormError(
          "REVISION_CONFLICT",
          "The form changed in another window. Reload the saved draft before retrying.",
          record.revision,
        );
      formAssert(
        record.status === "draft",
        "FORM_NOT_EDITABLE",
        "This form cannot be edited.",
      );
      work(record);
      record.revision++;
      this.put(record);
      this.storage.db
        .prepare(
          "INSERT INTO mutations(form_id,id,hash,result) VALUES(?,?,?,?)",
        )
        .run(id, mutationId, hash, JSON.stringify(record));
      return record;
    });
  }
  /** Async work happens before this short final transaction; no revision captured at upload start. */
  update(
    session: string,
    id: string,
    work: (r: QaFormRecord) => void,
  ): QaFormRecord {
    return this.storage.transaction(() => {
      const r = this.get(session, id);
      work(r);
      r.revision++;
      this.put(r);
      return r;
    });
  }
  resource(formId: string, id: string): Uint8Array {
    const row = this.storage.db
      .prepare("SELECT data FROM resources WHERE form_id=? AND id=?")
      .get(formId, id);
    formAssert(
      row?.data instanceof Uint8Array,
      "FILE_UNAVAILABLE",
      "The saved file is unavailable.",
    );
    return row.data;
  }
  saveResource(formId: string, id: string, data: Uint8Array): void {
    this.storage.db
      .prepare("INSERT INTO resources(id,form_id,data) VALUES(?,?,?)")
      .run(id, formId, data);
  }
  storedBytes(session: string): number {
    const row = this.storage.db
      .prepare(
        "SELECT COALESCE(SUM(length(data)),0) AS bytes FROM resources JOIN forms ON forms.id=resources.form_id WHERE forms.session_id=?",
      )
      .get(session);
    return Number(row?.bytes ?? 0);
  }
  identityReservedBytes(creator: string): number {
    const rows = this.storage.db
      .prepare(
        "SELECT document FROM forms WHERE json_extract(document,'$.creator_id')=?",
      )
      .all(creator);
    let total = 0;
    for (const row of rows) {
      const r = JSON.parse(String(row.document)) as QaFormRecord;
      total += r.uploads
        .filter((u) => u.state === "pending" || u.state === "uploading")
        .reduce((n, u) => n + u.size_bytes, 0);
      const saved = this.storage.db
        .prepare(
          "SELECT COALESCE(SUM(length(data)),0) AS bytes FROM resources WHERE form_id=?",
        )
        .get(r.id);
      total += Number(saved?.bytes ?? 0);
    }
    return total;
  }
  cancelSession(session: string): void {
    this.storage.transaction(() => {
      for (const r of this.list(session))
        if (r.status === "draft") {
          r.status = "cancelled";
          r.revision++;
          for (const u of r.uploads)
            if (u.state !== "ready") u.state = "cancelled";
          this.put(r);
        }
    });
  }
  close(): void {
    this.storage.close();
  }
}
