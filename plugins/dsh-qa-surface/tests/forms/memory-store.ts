import { randomUUID } from "node:crypto";
import { QaFormService } from "../../src/forms/service.js";
import { DEFAULT_FORM_POLICY } from "../../src/forms/schema.js";
import { formAssert, QaFormError } from "../../src/forms/errors.js";
import { fingerprint } from "../../src/forms/fingerprint.js";
import type {
  QaFormPolicy,
  QaFormRecord,
  QaFormStoreApi,
} from "../../src/forms/types.js";

interface MutationReceipt {
  hash: string;
  result: string;
}

/**
 * An in-memory `QaFormStoreApi` for component tests.
 *
 * The shipped store is sqlite-backed, and a jsdom test environment must not
 * load the sqlite bridge, so the client fixture mounts this instead. It mirrors
 * the store's observable semantics — deep-copied records, insertion-ordered
 * listings, the mutation ledger with its idempotency refusals, revision
 * conflicts, draft uniqueness and quota accounting — while durability itself
 * stays pinned by the node suites against the real store.
 */
export class QaFormMemoryStore implements QaFormStoreApi {
  private readonly forms = new Map<string, QaFormRecord>();
  private readonly resources = new Map<string, Uint8Array>();
  private readonly mutations = new Map<string, Map<string, MutationReceipt>>();

  private copy(record: QaFormRecord): QaFormRecord {
    return JSON.parse(JSON.stringify(record)) as QaFormRecord;
  }
  private put(record: QaFormRecord): void {
    this.forms.set(record.id, this.copy(record));
  }
  private receipt(formId: string, mutationId: string): MutationReceipt | null {
    return this.mutations.get(formId)?.get(mutationId) ?? null;
  }
  list(session: string): QaFormRecord[] {
    return [...this.forms.values()]
      .filter((r) => r.session_id === session)
      .reverse()
      .map((r) => this.copy(r));
  }
  get(session: string, id: string): QaFormRecord {
    const record = this.forms.get(id);
    formAssert(
      record && record.session_id === session,
      "ACCESS_DENIED",
      "Form access is unavailable.",
    );
    formAssert(
      record.storage_version === 1,
      "STORAGE_UNAVAILABLE",
      "Unsupported form storage version.",
    );
    return this.copy(record);
  }
  create(
    session: string,
    key: string,
    schema: QaFormRecord["schema"],
    creator = session,
  ): QaFormRecord {
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
    return this.copy(record);
  }
  editableOrSubmitted(record: QaFormRecord): void {
    formAssert(
      record.status === "draft" || record.status === "submitted",
      record.status === "expired" ? "FORM_EXPIRED" : "FORM_NOT_EDITABLE",
      "This form cannot be edited.",
    );
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
    const record = this.get(session, id),
      hash = fingerprint(input);
    const prior = this.receipt(id, mutationId);
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
    this.mutations.set(
      id,
      (this.mutations.get(id) ?? new Map()).set(mutationId, {
        hash,
        result: JSON.stringify(record),
      }),
    );
    return record;
  }
  update(
    session: string,
    id: string,
    work: (r: QaFormRecord) => void,
  ): QaFormRecord {
    const r = this.get(session, id);
    work(r);
    r.revision++;
    this.put(r);
    return r;
  }
  resource(formId: string, id: string): Uint8Array {
    const data = this.resources.get(`${formId}\u0000${id}`);
    formAssert(
      data instanceof Uint8Array,
      "FILE_UNAVAILABLE",
      "The saved file is unavailable.",
    );
    return data;
  }
  saveResource(formId: string, id: string, data: Uint8Array): void {
    this.resources.set(`${formId}\u0000${id}`, data);
  }
  storedBytes(session: string): number {
    let total = 0;
    for (const [key, data] of this.resources) {
      const record = this.forms.get(key.split("\u0000")[0] ?? "");
      if (record?.session_id === session) total += data.byteLength;
    }
    return total;
  }
  identityReservedBytes(creator: string): number {
    let total = 0;
    for (const record of this.forms.values()) {
      if (record.creator_id !== creator) continue;
      total += record.uploads
        .filter((u) => u.state === "pending" || u.state === "uploading")
        .reduce((n, u) => n + u.size_bytes, 0);
      for (const [key, data] of this.resources)
        if (key.startsWith(`${record.id}\u0000`)) total += data.byteLength;
    }
    return total;
  }
  cancelSession(session: string): void {
    for (const r of this.list(session))
      if (r.status === "draft") {
        r.status = "cancelled";
        r.revision++;
        for (const u of r.uploads)
          if (u.state !== "ready") u.state = "cancelled";
        this.put(r);
      }
  }
  replayedMutation(
    formId: string,
    mutationId: string,
    input: unknown,
  ): QaFormRecord | null {
    const prior = this.receipt(formId, mutationId);
    if (!prior) return null;
    formAssert(
      prior.hash === fingerprint(input),
      "IDEMPOTENCY_CONFLICT",
      "The mutation identity was already used for different data.",
    );
    return JSON.parse(prior.result) as QaFormRecord;
  }
  close(): void {}
}

export function memoryFixture() {
  const store = new QaFormMemoryStore();
  let policy: QaFormPolicy = { ...DEFAULT_FORM_POLICY, enabled: true };
  const service = () => new QaFormService(store, () => policy);
  return {
    get store() {
      return store;
    },
    get service() {
      return service();
    },
    policy: (next: Partial<QaFormPolicy>) => {
      policy = { ...policy, ...next };
    },
    close() {
      store.close();
    },
  };
}
