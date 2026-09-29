import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  QaQualityStore,
  QA_ROW_CAPS,
  type QualityRowKind,
} from "../../src/admin/quality-store.js";

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
 * Fill one family with `count` records, planted the way the store writes them.
 * Reaching a cap through the store's own API would cost a linear pass over the
 * in-memory list plus a write transaction per record, and the cap is what the
 * trim is defined over — so the bulk is planted and only the write under test
 * goes through the API.
 */
function seedRows(
  file: string,
  kind: QualityRowKind,
  count: number,
  record: (index: number) => { key: string; json: unknown },
): void {
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN");
    const insert = db.prepare(
      "INSERT INTO quality_rows (kind, key, seq, json) VALUES (?, ?, ?, ?)",
    );
    for (let index = 1; index <= count; index += 1) {
      const planted = record(index);
      insert.run(kind, planted.key, index, JSON.stringify(planted.json));
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

/** One rating per conversation, so a conversation owns exactly one row. */
function seedFeedback(file: string, count: number): void {
  seedRows(file, "feedback", count, (index) => ({
    key: `c${index}\u001fm${index}\u001fu1`,
    json: {
      id: `feedback-${index}`,
      conversationId: `c${index}`,
      messageId: `m${index}`,
      userId: "u1",
      rating: "positive",
      createdAt: "2026-09-15T00:00:00.000Z",
    },
  }));
}

/** One parked conversation per row, as `enqueueReview` without a message parks. */
function seedQueue(file: string, count: number): void {
  seedRows(file, "queue", count, (index) => ({
    key: `c${index}\u001f`,
    json: {
      conversationId: `c${index}`,
      userId: "r1",
      createdAt: "2026-09-15T00:00:00.000Z",
    },
  }));
}

/** One reviewer's verdict per conversation, keyed by the review's own id. */
function seedReviews(file: string, count: number): void {
  seedRows(file, "review", count, (index) => ({
    key: `review-${index}`,
    json: {
      id: `review-${index}`,
      conversationId: `c${index}`,
      reviewerId: "r1",
      status: "reviewed",
      issues: [],
      severity: "minor",
      createdAt: "2026-09-15T00:00:00.000Z",
    },
  }));
}

/** Open a store once to apply the schema, then leave the file to the test. */
function createSchema(file: string): void {
  new QaQualityStore(file).close();
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

/**
 * These tests walk a family up to its real cap — twenty thousand ratings, five
 * thousand verdicts, two thousand parked chats — and reopen the file to read
 * what survived. Locally the whole file runs in about a second; the release
 * runner is one shared container serving twenty jobs, where that walk is the
 * difference between a pass and a timeout that reads as a broken store.
 */
const CAP_TIMEOUT = { timeout: 30_000 } as const;

// A handle left open by a failing expectation keeps `qa-quality.db` locked for
// the rest of the run, and on Windows its temp directory cannot be removed.
afterEach(closeAll);

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
  });

  it(
    "keeps every rating of a full family that only re-judged one",
    CAP_TIMEOUT,
    () => {
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
      const rejudged = reopened.feedbackOf(`c${cap}`, `m${cap}`, "u1");
      expect(rejudged?.rating).toBe("negative");
      // The planted key is the one `rateFeedback` computes, so this write found
      // the row instead of adding a rival: identity and first-seen time stayed.
      // Should the key format ever move, the family would still hold `cap` rows
      // — one arrived and the oldest gave up its place — and only this would say
      // that the record was replaced rather than updated in place.
      expect(rejudged?.id).toBe(`feedback-${cap}`);
      expect(rejudged?.createdAt).toBe("2026-09-15T00:00:00.000Z");
    },
  );

  it(
    "keeps a full review family whole when one verdict is re-saved",
    CAP_TIMEOUT,
    () => {
      const { file } = rig();
      createSchema(file);
      const cap = QA_ROW_CAPS.review;
      seedReviews(file, cap);
      const store = openStore(file);

      // The second family whose writer relocates a row, with a cap of its own:
      // a reviewer overwriting their verdict must cost nobody their review.
      const { created } = store.saveReview("r1", {
        conversationId: `c${cap}`,
        status: "reviewed",
        issues: [],
        severity: "critical",
      });
      expect(created).toBe(false);

      expect(store.allReviews()).toHaveLength(cap);
      expect(rowCount(file, "review")).toBe(cap);
      closeAll();

      const reopened = openStore(file);
      const reviews = reopened.allReviews();
      expect(reviews).toHaveLength(cap);
      expect(reviews.find((row) => row.id === "review-1")?.severity).toBe(
        "minor",
      );
      const rejudged = reviews.find((row) => row.id === `review-${cap}`);
      expect(rejudged?.severity).toBe("critical");
      expect(rejudged?.createdAt).toBe("2026-09-15T00:00:00.000Z");
    },
  );

  it(
    "counts rows of a full family, not the gap a dropped entry left",
    CAP_TIMEOUT,
    () => {
      const { file } = rig();
      createSchema(file);
      const cap = QA_ROW_CAPS.queue;
      seedQueue(file, cap);
      const store = openStore(file);
      expect(store.manualQueue()).toHaveLength(cap);

      // The hole in the middle of the order must not be read as an extra row.
      expect(store.dequeueReview("c1000")).toBe(true);
      store.enqueueReview("r1", `c${cap + 1}`);
      expect(store.manualQueue()).toHaveLength(cap);
      expect(rowCount(file, "queue")).toBe(cap);
      expect(
        store.manualQueue().some((row) => row.conversationId === "c1"),
      ).toBe(true);

      // A write that does overflow the family still costs exactly its oldest entry.
      store.enqueueReview("r1", `c${cap + 2}`);
      expect(store.manualQueue()).toHaveLength(cap);
      expect(rowCount(file, "queue")).toBe(cap);
      expect(
        store.manualQueue().some((row) => row.conversationId === "c1"),
      ).toBe(false);
      expect(
        store.manualQueue().some((row) => row.conversationId === "c2"),
      ).toBe(true);
    },
  );

  it(
    "gives a conversation the harness lost only the room its own rows made",
    CAP_TIMEOUT,
    () => {
      const { file } = rig();
      createSchema(file);
      const cap = QA_ROW_CAPS.queue;
      seedQueue(file, cap);
      const store = openStore(file);

      // The ownership sweep is the writer that empties a family without filling
      // it back: it forgets a chat the Harness no longer holds, and the rows it
      // deleted leave their places in the order behind. Three rows gone is three
      // rows of room, so refilling to the cap must cost nothing — under a cut
      // that measures the order instead of counting the rows, every hole costs
      // one record of a conversation still on the stand.
      expect(store.dropConversations(["c900", "c1000", "c1100"])).toBe(3);
      const newcomers = [`c${cap + 1}`, `c${cap + 2}`, `c${cap + 3}`];
      for (const conversationId of newcomers)
        store.enqueueReview("r1", conversationId);

      expect(rowCount(file, "queue")).toBe(cap);
      expect(store.manualQueue()).toHaveLength(cap);
      const kept = new Set(
        store.manualQueue().map((entry) => entry.conversationId),
      );
      for (const dropped of ["c900", "c1000", "c1100"]) {
        expect(kept.has(dropped)).toBe(false);
      }
      for (const newcomer of newcomers) expect(kept.has(newcomer)).toBe(true);
      for (const oldest of ["c1", "c2", "c3"])
        expect(kept.has(oldest)).toBe(true);
      closeAll();

      const reopened = openStore(file);
      expect(reopened.manualQueue()).toHaveLength(cap);
    },
  );

  it("reads a family in its own order instead of sorting it", () => {
    const { file } = rig();
    createSchema(file);
    const db = new DatabaseSync(file);
    let cap: string;
    let reload: string;
    try {
      const planOf = (sql: string): string =>
        db
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .all("feedback")
          .map((row) => row.detail as string)
          .join("\n");

      // The two statements that order a family by `seq`. Both run against a
      // store that holds twenty thousand ratings: the cap reads the row at its
      // rank on every write, and a reload replays the family in insertion order
      // on every read that follows one. Sorted instead of walked, either would
      // build a temp B-tree of that whole family.
      cap = planOf(
        `SELECT seq FROM quality_rows WHERE kind = ? ORDER BY seq DESC
          LIMIT 1 OFFSET 10`,
      );
      reload = planOf(
        "SELECT json FROM quality_rows WHERE kind = ? ORDER BY seq",
      );
    } finally {
      db.close();
    }

    for (const plan of [cap, reload]) {
      expect(plan).toContain("quality_rows_kind_seq");
      expect(plan).not.toMatch(/TEMP B-TREE/);
    }
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
