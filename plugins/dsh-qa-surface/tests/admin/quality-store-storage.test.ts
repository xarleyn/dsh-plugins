import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { QaQualityStore } from "../../src/admin/quality-store.js";

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
