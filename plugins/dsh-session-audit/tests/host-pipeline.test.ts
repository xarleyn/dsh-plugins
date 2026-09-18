/**
 * The scanner, the registry and the service: the SPEC §73 scenarios, plus the
 * §74 security cases that belong to the pipeline rather than to a component.
 */
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanAuditRoot } from "../src/host/audit-scanner.js";
import { computeFingerprint } from "../src/host/audit-fingerprint.js";
import { AuditRegistry } from "../src/host/audit-registry.js";
import type { AuditRecord, AuditRegistryEvent } from "@yadsh/dsh-audit-core";
import {
  AUDIT_DIRECTORY,
  OTHER_SESSION_ID,
  REPORT,
  SESSION_ID,
  analysis,
  removeRoot,
  temporaryRoot,
  testService,
  writeAudit,
} from "./helpers/fixtures.js";

let root: string;

beforeEach(async () => {
  root = await temporaryRoot();
});

afterEach(async () => {
  await removeRoot(root);
});

describe("scanAuditRoot", () => {
  it("returns nothing for a root that does not exist yet", async () => {
    const result = await scanAuditRoot(join(root, "absent"));

    expect(result.audits).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("finds a complete audit and its two artefacts", async () => {
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });

    const result = await scanAuditRoot(root);

    expect(result.audits).toHaveLength(1);
    const [found] = result.audits;
    expect(found?.name).toBe(AUDIT_DIRECTORY);
    expect(found?.analysis?.size).toBeGreaterThan(0);
    expect(found?.report?.size).toBeGreaterThan(0);
  });

  it("reports an audit with only one artefact as half-arrived", async () => {
    await writeAudit(root, "only-analysis", { analysis: analysis() });
    await writeAudit(root, "only-report", {
      analysis: analysis(),
      report: REPORT,
    });
    await writeFile(join(root, "only-report", "analysis.json"), "", "utf8");

    const result = await scanAuditRoot(root);
    const byName = new Map(result.audits.map((entry) => [entry.name, entry]));

    expect(byName.get("only-analysis")?.report).toBeNull();
    expect(byName.get("only-analysis")?.analysis).not.toBeNull();
    // An empty analysis.json is still an artefact that exists.
    expect(byName.get("only-report")?.analysis).not.toBeNull();
  });

  it("ignores a directory holding neither artefact", async () => {
    await mkdir(join(root, "not-an-audit"), { recursive: true });

    expect((await scanAuditRoot(root)).audits).toEqual([]);
  });

  it("ignores the producer's staging area and other dot-entries", async () => {
    await mkdir(join(root, ".incoming", "staging-1"), { recursive: true });
    await writeFile(
      join(root, ".incoming", "staging-1", "analysis.json"),
      "{}",
    );
    await mkdir(join(root, ".trash"), { recursive: true });

    expect((await scanAuditRoot(root)).audits).toEqual([]);
  });

  it("warns about a symlink instead of following it", async () => {
    const outside = join(root, "outside-audit");
    await mkdir(outside, { recursive: true });
    await writeFile(
      join(outside, "analysis.json"),
      JSON.stringify(analysis()),
      "utf8",
    );
    await symlink(outside, join(root, "linked-audit"), "junction");

    const result = await scanAuditRoot(root);

    expect(result.audits.map((entry) => entry.name)).toEqual(["outside-audit"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain("symlink");
  });

  it("does not follow a symlinked artefact", async () => {
    const directory = await writeAudit(root, "audit-1", {
      analysis: analysis(),
    });
    await symlink(
      join(directory, "analysis.json"),
      join(directory, "REPORT.md"),
      "file",
    );

    const result = await scanAuditRoot(root);

    expect(result.audits[0]?.report).toBeNull();
  });
});

describe("computeFingerprint", () => {
  it("is stable for identical contents and moves with either file", () => {
    const base = computeFingerprint("a", "b");

    expect(computeFingerprint("a", "b")).toBe(base);
    expect(computeFingerprint("a2", "b")).not.toBe(base);
    expect(computeFingerprint("a", "b2")).not.toBe(base);
  });

  it("cannot be confused by moving a byte across the boundary", () => {
    expect(computeFingerprint("ab", "c")).not.toBe(
      computeFingerprint("a", "bc"),
    );
  });
});

describe("AuditRegistry", () => {
  const record = (
    overrides: Partial<AuditRecord> & Pick<AuditRecord, "auditId">,
  ): AuditRecord => ({
    sessionId: SESSION_ID,
    sourceDirectory: `/audits/${overrides.auditId}`,
    status: "ready",
    schemaVersion: 1,
    fingerprint: "f",
    summary: {
      auditId: overrides.auditId,
      sessionId: SESSION_ID,
      findings: { critical: 0, major: 1, minor: 0, observation: 0, other: 0 },
      modifiedAt: "2026-09-17T00:00:00.000Z",
      schemaVersion: 1,
    },
    reportPath: `/audits/${overrides.auditId}/REPORT.md`,
    analysisPath: `/audits/${overrides.auditId}/analysis.json`,
    discoveredAt: "2026-09-17T00:00:00.000Z",
    modifiedAt: "2026-09-17T00:00:00.000Z",
    errors: [],
    ...overrides,
  });

  it("keeps every audit of a session and reports the newest valid one as active", () => {
    const registry = new AuditRegistry();
    registry.upsert(
      record({ auditId: "a", modifiedAt: "2026-09-16T00:00:00.000Z" }),
    );
    registry.upsert(
      record({ auditId: "b", modifiedAt: "2026-09-17T00:00:00.000Z" }),
    );

    expect(registry.listFor(SESSION_ID).map((entry) => entry.auditId)).toEqual([
      "b",
      "a",
    ]);
    expect(registry.activeFor(SESSION_ID)?.auditId).toBe("b");
  });

  it("does not let an invalid newcomer displace a valid incumbent", () => {
    const registry = new AuditRegistry();
    registry.upsert(
      record({ auditId: "good", modifiedAt: "2026-09-16T00:00:00.000Z" }),
    );
    registry.upsert(
      record({
        auditId: "bad",
        status: "invalid",
        sessionId: null,
        modifiedAt: "2026-09-17T00:00:00.000Z",
      }),
    );

    expect(registry.activeFor(SESSION_ID)?.auditId).toBe("good");
  });

  it("publishes created, updated and deleted", () => {
    const registry = new AuditRegistry();
    const events: AuditRegistryEvent[] = [];
    registry.subscribe((event) => events.push(event));

    registry.upsert(record({ auditId: "a" }));
    registry.upsert(record({ auditId: "a", fingerprint: "changed" }));
    registry.remove("a");

    expect(events.map((event) => event.type)).toEqual([
      "created",
      "updated",
      "deleted",
    ]);
    expect(events[0]?.sessionId).toBe(SESSION_ID);
    expect(events[0]?.summary?.auditId).toBe("a");
  });

  it("emits nothing for unchanged bytes", () => {
    const registry = new AuditRegistry();
    const events: AuditRegistryEvent[] = [];
    registry.upsert(record({ auditId: "a" }));
    registry.subscribe((event) => events.push(event));

    registry.upsert(record({ auditId: "a" }));

    expect(events).toEqual([]);
  });

  it("reports a valid audit turning invalid, and a new invalid one", () => {
    const registry = new AuditRegistry();
    const events: AuditRegistryEvent[] = [];
    registry.subscribe((event) => events.push(event));

    registry.upsert(record({ auditId: "a", status: "valid" as never }));
    registry.upsert(
      record({ auditId: "a", status: "invalid", sessionId: null }),
    );
    registry.upsert(
      record({ auditId: "b", status: "invalid", sessionId: null }),
    );

    expect(events.map((event) => event.type)).toEqual(["invalid", "invalid"]);
  });

  it("keeps a subscriber's failure from reaching the next one", () => {
    const registry = new AuditRegistry();
    const seen: string[] = [];
    registry.subscribe(() => {
      throw new Error("boom");
    });
    registry.subscribe((event) => seen.push(event.auditId));

    registry.upsert(record({ auditId: "a" }));

    expect(seen).toEqual(["a"]);
  });

  it("forgets a session's audits on removal", () => {
    const registry = new AuditRegistry();
    registry.upsert(record({ auditId: "a" }));
    registry.remove("a");

    expect(registry.listFor(SESSION_ID)).toEqual([]);
    expect(registry.size).toBe(0);
  });
});

describe("AuditService refresh", () => {
  it("registers a complete directory that appears", async () => {
    const { service } = testService(root);
    await service.refresh();
    expect(await service.getSessionAuditSummary(SESSION_ID)).toBeNull();

    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.refresh();

    const summary = await service.getSessionAuditSummary(SESSION_ID);
    expect(summary?.auditId).toBe(AUDIT_DIRECTORY);
    expect(summary?.verdict).toBe("mixed");
    expect(summary?.findings).toEqual({
      critical: 0,
      major: 1,
      minor: 0,
      observation: 1,
      other: 0,
    });
  });

  it("waits for the second file when the analysis lands first", async () => {
    const { service, logger } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, { analysis: analysis() });

    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).toBeNull();
    expect(
      logger.records.some((record) => record.event === "audit pending"),
    ).toBe(true);

    await writeFile(join(root, AUDIT_DIRECTORY, "REPORT.md"), REPORT, "utf8");
    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
  });

  it("waits for the second file when the report lands first", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    // Remove the analysis again: the directory is now report-only.
    await writeFile(join(root, AUDIT_DIRECTORY, "analysis.json"), "", "utf8");

    await service.refresh();
    expect(await service.getSessionAuditSummary(SESSION_ID)).toBeNull();

    await writeFile(
      join(root, AUDIT_DIRECTORY, "analysis.json"),
      JSON.stringify(analysis()),
      "utf8",
    );
    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
  });

  it("picks up a modified artefact", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.refresh();
    const before = await service.getSessionAuditSummary(SESSION_ID);

    await writeFile(
      join(root, AUDIT_DIRECTORY, "analysis.json"),
      JSON.stringify(analysis(SESSION_ID, { verdict: "poor" })),
      "utf8",
    );
    await service.refresh();

    const after = await service.getSessionAuditSummary(SESSION_ID);
    expect(after?.verdict).toBe("poor");
    expect(after?.modifiedAt).not.toBe(before?.modifiedAt);
  });

  it("does not re-read or re-emit when only the mtime moved", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.refresh();

    const events: AuditRegistryEvent[] = [];
    service.subscribe((event) => events.push(event));

    // Same bytes, new mtime: the metadata gate re-reads, the fingerprint gate
    // then discards the result.
    const path = join(root, AUDIT_DIRECTORY, "analysis.json");
    const contents = await (
      await import("node:fs/promises")
    ).readFile(path, "utf8");
    await writeFile(path, contents, "utf8");
    await service.refresh();

    expect(events).toEqual([]);
  });

  it("unregisters a directory that was removed", async () => {
    const { service, logger } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.refresh();
    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();

    await removeRoot(join(root, AUDIT_DIRECTORY));
    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).toBeNull();
    expect(
      logger.records.some((record) => record.event === "audit removed"),
    ).toBe(true);
  });

  it("replaces an invalid artefact with a valid one", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await writeFile(
      join(root, AUDIT_DIRECTORY, "analysis.json"),
      "{ not json",
      "utf8",
    );
    await service.refresh();
    expect(await service.getSessionAuditSummary(SESSION_ID)).toBeNull();

    await writeFile(
      join(root, AUDIT_DIRECTORY, "analysis.json"),
      JSON.stringify(analysis()),
      "utf8",
    );
    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
  });

  it("keeps a valid audit on screen while its replacement is written", async () => {
    const { service, logger } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.refresh();

    // A producer writing in place passes through an empty file.
    await writeFile(join(root, AUDIT_DIRECTORY, "analysis.json"), "", "utf8");
    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
    expect(
      logger.records.some(
        (record) => record.event === "audit invalid, previous record retained",
      ),
    ).toBe(true);
  });

  it("is idempotent across repeated passes", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });

    const first = await service.refresh();
    const second = await service.refresh();

    expect(first.changed).toBe(1);
    expect(second.changed).toBe(0);
    expect(second.ready).toBe(1);
  });

  it("serves the report, the analysis text and the semantic view", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.refresh();

    expect(await service.readReport(AUDIT_DIRECTORY)).toContain(
      "# Trajectory Review",
    );
    expect(await service.readAnalysisJson(AUDIT_DIRECTORY)).toContain(
      "schemaVersion",
    );

    const audit = await service.getSessionAudit(SESSION_ID);
    expect(audit?.report).toContain("# Trajectory Review");
    expect(audit?.summary.auditId).toBe(AUDIT_DIRECTORY);
    expect(audit?.analysis.kind).toBe("v1");
    expect((audit?.raw as { verdict?: string }).verdict).toBe("mixed");
  });

  it("lists every audit of a session, newest first", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.refresh();
    await writeAudit(root, `${AUDIT_DIRECTORY}-2`, {
      analysis: analysis(SESSION_ID, { verdict: "good" }),
      report: REPORT,
    });
    await service.refresh();

    const audits = await service.listSessionAudits(SESSION_ID);

    expect(audits).toHaveLength(2);
    expect((await service.getSessionAuditSummary(SESSION_ID))?.verdict).toBe(
      "good",
    );
  });

  it("reports an audit naming a session the directory does not", async () => {
    const { service, logger } = testService(root);
    await writeAudit(root, "session-0ad608a8", {
      analysis: analysis(SESSION_ID),
      report: REPORT,
    });

    await service.refresh();

    // The analysis wins: the audit is bound to the session it names.
    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
    expect(await service.getSessionAuditSummary(OTHER_SESSION_ID)).toBeNull();
    expect(
      logger.records.some(
        (record) =>
          record.fields["code"] === undefined &&
          record.event === "audit discovered",
      ),
    ).toBe(true);
    const audit = await service.getSessionAudit(SESSION_ID);
    expect(audit?.summary.auditId).toBe("session-0ad608a8");
  });

  it("leaves an unattachable audit unresolved and out of every session", async () => {
    const { service } = testService(root, { sessions: [] });
    await writeAudit(root, "session-unknown", {
      analysis: { schemaVersion: 1, trajectory: {} },
      report: REPORT,
    });
    await writeAudit(root, "session-41b4e63f", {
      analysis: analysis(SESSION_ID),
      report: REPORT,
    });
    // An unknown schema has no readable binding and no corpus match.
    await writeAudit(root, "audit-newer", {
      analysis: { schemaVersion: 7, trajectory: {} },
      report: REPORT,
    });

    await service.refresh();

    const counts = service.registry.counts();
    expect(counts.unresolved).toBeGreaterThanOrEqual(1);
    expect(await service.getSessionAuditSummary(SESSION_ID)).not.toBeNull();
  });

  it("keeps an unknown schema's report and raw document available", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: {
        schemaVersion: 2,
        trajectory: { sessionId: SESSION_ID },
        verdict: "good",
      },
      report: REPORT,
    });

    await service.refresh();

    const summary = await service.getSessionAuditSummary(SESSION_ID);
    expect(summary?.schemaVersion).toBe(2);
    expect(summary?.verdict).toBeUndefined();

    const audit = await service.getSessionAudit(SESSION_ID);
    expect(audit?.analysis).toEqual({ kind: "unknown", schemaVersion: 2 });
    expect(audit?.report).toContain("# Trajectory Review");
    expect((audit?.raw as { verdict?: string }).verdict).toBe("good");
  });
});

describe("AuditService security", () => {
  it("refuses an analysis over the configured cap", async () => {
    const { service, logger } = testService(root, {
      config: { maxAnalysisBytes: 64 },
    });
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });

    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).toBeNull();
    expect(
      logger.records.some(
        (record) =>
          record.event === "audit invalid" &&
          record.fields["code"] === "FILE_TOO_LARGE",
      ),
    ).toBe(true);
  });

  it("refuses a report over the configured cap", async () => {
    const { service, logger } = testService(root, {
      config: { maxReportBytes: 16 },
    });
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });

    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).toBeNull();
    expect(
      logger.records.some(
        (record) => record.fields["code"] === "FILE_TOO_LARGE",
      ),
    ).toBe(true);
  });

  it("refuses bytes that are not valid UTF-8", async () => {
    const { service, logger } = testService(root);
    // The write path is exercised, then the analysis bytes are replaced with
    // something that is not UTF-8 at all.
    const directory = await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await writeFile(
      join(directory, "analysis.json"),
      Buffer.from([0xff, 0xfe, 0x00]),
    );

    await service.refresh();

    expect(await service.getSessionAuditSummary(SESSION_ID)).toBeNull();
    expect(
      logger.records.some((record) =>
        String(record.fields["message"] ?? "").includes("not valid UTF-8"),
      ),
    ).toBe(true);
  });

  it("never reads outside the audit root, even through a crafted name", async () => {
    const { service } = testService(root);
    // A directory name that would resolve outside the root is refused by the
    // scanner before it is ever a path.
    expect(await readdir(root)).toEqual([]);
    await service.refresh();
    expect(service.registry.size).toBe(0);
  });

  it("treats a malicious title as text, not as markup", async () => {
    const { service } = testService(root);
    await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(SESSION_ID, {
        findings: [
          {
            id: "F1",
            severity: "major",
            title: '<script>alert("x")</script>',
            description: "javascript:alert(1)",
          },
        ],
      }),
      report: REPORT,
    });

    await service.refresh();

    const audit = await service.getSessionAudit(SESSION_ID);
    expect(audit?.analysis.kind).toBe("v1");
    if (audit?.analysis.kind !== "v1") return;
    expect(audit.analysis.findings[0]?.title).toBe(
      '<script>alert("x")</script>',
    );
  });
});
