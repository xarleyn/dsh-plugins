import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { QaQualityStore, QA_ROW_CAPS } from "../../src/admin/quality-store.js";

const open: QaQualityStore[] = [];

/** Build a store the assertions below leave closable. */
function openStore(file: string): QaQualityStore {
  const store = new QaQualityStore(file);
  open.push(store);
  return store;
}

function closeAll(): void {
  for (const store of open.splice(0)) store.close();
}

function rig(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-quality-store-"));
  return { dir, file: path.join(dir, "qa-quality.db") };
}

/** Read the first column of a query out of the store's own database. */
function column<T>(file: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(file);
  try {
    return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(
      (row) => Object.values(row)[0] as T,
    );
  } finally {
    db.close();
  }
}

/** How many rows of one family the database holds. */
function rowCount(file: string, kind: string): number {
  return (
    column<number>(
      file,
      "SELECT COUNT(*) FROM quality_rows WHERE kind = ?",
      kind,
    )[0] ?? -1
  );
}

/**
 * Fill the feedback family with `count` ratings, one per conversation, written
 * the way the store writes them. Reaching the cap through the store's own API
 * would cost one pass over the in-memory list per record, and the cap is what
 * the trim is defined over, so these rows are planted instead.
 */
function seedFeedback(file: string, count: number): void {
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN");
    const insert = db.prepare(
      "INSERT INTO quality_rows (kind, key, seq, json) VALUES ('feedback', ?, ?, ?)",
    );
    for (let seq = 1; seq <= count; seq += 1) {
      insert.run(
        `c${seq}\u001fm${seq}\u001fu1`,
        seq,
        JSON.stringify({
          id: `feedback-${seq}`,
          conversationId: `c${seq}`,
          messageId: `m${seq}`,
          userId: "u1",
          rating: "positive",
          createdAt: "2026-09-15T00:00:00.000Z",
        }),
      );
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

/** Open a store once to apply the schema, then leave the file to the test. */
function createSchema(file: string): void {
  openStore(file).close();
}

/** A `qa-quality.json` as a pre-0.8.0 release wrote it. */
function writeLegacy(dir: string): string {
  const file = path.join(dir, "qa-quality.json");
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        version: 1,
        feedback: [
          {
            id: "feedback-1",
            conversationId: "c1",
            messageId: "4",
            userId: "u1",
            rating: "negative",
            reasons: ["missing_information"],
            createdAt: "2026-09-15T00:00:00.000Z",
          },
        ],
        reviews: [
          {
            id: "review-1",
            conversationId: "c1",
            reviewerId: "r1",
            status: "reviewed",
            issues: ["context.missing_knowledge"],
            severity: "critical",
            createdAt: "2026-09-15T00:00:00.000Z",
          },
        ],
        queue: [
          {
            conversationId: "c2",
            userId: "r1",
            createdAt: "2026-09-15T00:00:00.000Z",
          },
        ],
        audit: [
          {
            id: "audit-1",
            timestamp: "2026-09-15T00:00:00.000Z",
            actorId: "admin",
            action: "user.disabled",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return file;
}

describe("QaQualityStore storage", () => {
  it("writes one row per record and reads it back in a second instance", () => {
    const { file } = rig();
    const first = openStore(file);
    first.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u1" },
      { rating: "positive", comment: "clear" },
    );
    first.saveReview("r1", {
      conversationId: "c1",
      status: "reviewed",
      issues: [],
      severity: "minor",
    });
    first.enqueueReview("r1", "c2");
    first.appendAudit({ actorId: "admin", action: "user.disabled" });
    closeAll();

    expect(
      column<string>(file, "SELECT kind FROM quality_rows ORDER BY kind, seq"),
    ).toEqual(["audit", "feedback", "queue", "review"]);
    const reopened = openStore(file);
    expect(reopened.allFeedback()).toHaveLength(1);
    expect(reopened.allFeedback()[0]?.comment).toBe("clear");
    expect(reopened.allReviews()).toHaveLength(1);
    expect(reopened.manualQueue()).toHaveLength(1);
    expect(reopened.auditEvents()).toHaveLength(1);
    closeAll();
  });

  it("keeps every record of one conversation apart", () => {
    const { file } = rig();
    const store = openStore(file);
    // The key identifying a rating must not truncate at its first separator:
    // collapsing two messages into one row would lose a person's verdict.
    for (const messageId of ["4", "5"]) {
      store.rateFeedback(
        { conversationId: "c1", messageId, userId: "u1" },
        { rating: "positive" },
      );
    }
    store.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u2" },
      { rating: "negative" },
    );

    expect(store.allFeedback()).toHaveLength(3);
    expect(
      column<number>(
        file,
        "SELECT COUNT(*) FROM quality_rows WHERE kind = 'feedback'",
      ),
    ).toEqual([3]);
    closeAll();
  });

  it("drops a queue entry rather than rewriting the list", () => {
    const { file } = rig();
    const store = openStore(file);
    store.enqueueReview("r1", "c2");
    store.enqueueReview("r1", "c3");

    expect(store.dequeueReview("c2")).toBe(true);
    expect(store.dequeueReview("c2")).toBe(false);

    expect(
      column<string>(file, "SELECT key FROM quality_rows WHERE kind = 'queue'"),
    ).toEqual(["c3\u001f"]);
    closeAll();
  });

  it("keeps every rating of a full family that only re-judged one", () => {
    const { file } = rig();
    createSchema(file);
    const cap = QA_ROW_CAPS.feedback;
    seedFeedback(file, cap);
    const store = openStore(file);

    // Re-rating the newest record adds no row: the oldest rating has nothing
    // that displaced it. The updated record does move to the end of the order,
    // which leaves its old `seq` behind as a gap, and the gap is not a row.
    store.rateFeedback(
      { conversationId: `c${cap}`, messageId: `m${cap}`, userId: "u1" },
      { rating: "negative" },
    );

    expect(store.allFeedback()).toHaveLength(cap);
    expect(rowCount(file, "feedback")).toBe(cap);
    closeAll();

    // The trimmed database, not the in-memory list, is what the next open reads.
    const reopened = openStore(file);
    expect(reopened.allFeedback()).toHaveLength(cap);
    expect(reopened.feedbackOf("c1", "m1", "u1")?.rating).toBe("positive");
    expect(reopened.feedbackOf(`c${cap}`, `m${cap}`, "u1")?.rating).toBe(
      "negative",
    );
    closeAll();
  });

  it("counts rows of a full family, not the gap a dropped entry left", () => {
    const { file } = rig();
    const store = openStore(file);
    const cap = QA_ROW_CAPS.queue;
    for (let index = 1; index <= cap; index += 1) {
      store.enqueueReview("r1", `c${index}`);
    }
    expect(store.manualQueue()).toHaveLength(cap);

    // The hole in the middle of the order must not be read as an extra row.
    expect(store.dequeueReview("c1000")).toBe(true);
    store.enqueueReview("r1", `c${cap + 1}`);
    expect(store.manualQueue()).toHaveLength(cap);
    expect(rowCount(file, "queue")).toBe(cap);
    expect(store.manualQueue().some((row) => row.conversationId === "c1")).toBe(
      true,
    );

    // A write that does overflow the family still costs exactly its oldest entry.
    store.enqueueReview("r1", `c${cap + 2}`);
    expect(store.manualQueue()).toHaveLength(cap);
    expect(rowCount(file, "queue")).toBe(cap);
    expect(store.manualQueue().some((row) => row.conversationId === "c1")).toBe(
      false,
    );
    expect(store.manualQueue().some((row) => row.conversationId === "c2")).toBe(
      true,
    );
    closeAll();
  });

  it("imports the pre-SQLite file and renames it aside", () => {
    const { dir, file } = rig();
    const legacy = writeLegacy(dir);

    const store = openStore(file);

    expect(store.allFeedback()[0]?.reasons).toEqual(["missing_information"]);
    expect(store.allReviews()[0]?.id).toBe("review-1");
    expect(store.manualQueue()).toHaveLength(1);
    expect(store.auditEvents()[0]?.id).toBe("audit-1");
    expect(readdirSync(dir).some((name) => name.includes(".migrated-"))).toBe(
      true,
    );
    expect(() => readFileSync(legacy, "utf8")).toThrow();
    closeAll();
  });

  it("never overwrites a verdict the database already holds", () => {
    const { dir, file } = rig();
    const store = openStore(file);
    store.rateFeedback(
      { conversationId: "c1", messageId: "4", userId: "u1" },
      { rating: "positive" },
    );
    store.close();
    const legacy = writeLegacy(dir);

    const reopened = openStore(file);

    expect(reopened.allFeedback()).toHaveLength(1);
    expect(reopened.allFeedback()[0]?.rating).toBe("positive");
    // The leftover file stays where it is: dropping it is the operator's call.
    expect(readFileSync(legacy, "utf8")).toContain("missing_information");
    closeAll();
  });

  it("refuses a file it cannot recognize and leaves it in place", () => {
    const { dir, file } = rig();
    const legacy = path.join(dir, "qa-quality.json");
    writeFileSync(legacy, '{"version":2}\n', "utf8");

    expect(() => new QaQualityStore(file)).toThrow(/refusing to import/u);
    expect(readFileSync(legacy, "utf8")).toBe('{"version":2}\n');
  });

  it("refuses a legacy record the store cannot render", () => {
    const { dir, file } = rig();
    writeFileSync(
      path.join(dir, "qa-quality.json"),
      `${JSON.stringify({
        version: 1,
        feedback: [
          {
            id: "broken",
            conversationId: "c1",
            messageId: "4",
            userId: "u1",
            rating: "sideways",
            createdAt: "2026-09-15T00:00:00.000Z",
          },
        ],
        reviews: [],
        queue: [],
        audit: [],
      })}\n`,
      "utf8",
    );

    expect(() => new QaQualityStore(file)).toThrow(/rating must be one of/u);
  });
});
