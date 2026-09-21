/**
 * The browser's view of an unattached audit.
 *
 * Two things are load-bearing here. The code is the answer the reader gets, so
 * the first `error`-severity diagnostic wins over any warning an artefact
 * carries. And the host's message never crosses the wire: it quotes absolute
 * paths, and the wire is read by a browser that has no business knowing where
 * the audit root is.
 */
import { describe, expect, it } from "vitest";
import type { AuditRecord } from "@yadsh/dsh-audit-core";
import { toUnattachedValue } from "../src/host/unattached.js";

/** A record with no bound session, which is what makes it unattached. */
function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    auditId: "session-unknown",
    sessionId: null,
    sourceDirectory: "/srv/dsh/audits/session-unknown",
    status: "unresolved",
    schemaVersion: 1,
    fingerprint: "f",
    reportPath: "/srv/dsh/audits/session-unknown/REPORT.md",
    analysisPath: "/srv/dsh/audits/session-unknown/analysis.json",
    discoveredAt: "2026-09-19T00:00:00.000Z",
    modifiedAt: "2026-09-19T00:00:00.000Z",
    errors: [],
    ...overrides,
  };
}

describe("toUnattachedValue", () => {
  it("keeps the audit id, the status and the code, and nothing else", () => {
    const value = toUnattachedValue(
      record({
        errors: [
          {
            code: "SESSION_NOT_FOUND",
            message: 'no session matches the audit directory "session-unknown"',
            severity: "error",
          },
        ],
      }),
    );

    expect(value).toEqual({
      auditId: "session-unknown",
      status: "unresolved",
      code: "SESSION_NOT_FOUND",
      modifiedAt: "2026-09-19T00:00:00.000Z",
    });
  });

  it("never carries a path, even when the diagnostic quotes one", () => {
    const value = toUnattachedValue(
      record({
        status: "invalid",
        errors: [
          {
            code: "READ_FAILED",
            message:
              'cannot read "/srv/dsh/audits/session-unknown/analysis.json": EACCES',
            severity: "error",
          },
        ],
      }),
    );

    expect(JSON.stringify(value)).not.toContain("/srv/dsh");
    expect(Object.keys(value).sort()).toEqual([
      "auditId",
      "code",
      "modifiedAt",
      "status",
    ]);
  });

  it("prefers the blocking diagnostic over a warning", () => {
    const value = toUnattachedValue(
      record({
        errors: [
          {
            code: "SESSION_ID_MISMATCH",
            message: "the directory disagrees with the analysis",
            severity: "warning",
          },
          {
            code: "INVALID_SCHEMA",
            message: "analysis must be a JSON object at the top level",
            severity: "error",
          },
        ],
      }),
    );

    expect(value.code).toBe("INVALID_SCHEMA");
  });

  it("reports an empty code rather than inventing one", () => {
    expect(toUnattachedValue(record()).code).toBe("");
  });
});
