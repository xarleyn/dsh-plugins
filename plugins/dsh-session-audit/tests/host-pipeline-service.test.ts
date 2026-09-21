/**
 * The scanner, the registry and the service: the SPEC §73 scenarios, plus the
 * §74 security cases that belong to the pipeline rather than to a component.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditRegistryEvent } from "@yadsh/dsh-audit-core";
import { root } from "./host-pipeline.helpers.js";
import {
  AUDIT_DIRECTORY,
  OTHER_SESSION_ID,
  REPORT,
  SESSION_ID,
  analysis,
  removeRoot,
  testService,
  writeAudit,
} from "./helpers/fixtures.js";

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

  it("lists the audits no session view can show, with the reason for each", async () => {
    const { service } = testService(root, { sessions: [] });
    await writeAudit(root, "session-41b4e63f", {
      analysis: analysis(SESSION_ID),
      report: REPORT,
    });
    // A schema this build does not read: no declared binding, no corpus match.
    await writeAudit(root, "audit-newer", {
      analysis: { schemaVersion: 7, trajectory: {} },
      report: REPORT,
    });
    // A directory whose analysis is not JSON at all: no session can own it.
    await writeAudit(root, "audit-broken", { analysis: {}, report: REPORT });
    await writeFile(
      join(root, "audit-broken", "analysis.json"),
      "{ not json",
      "utf8",
    );

    await service.refresh();

    const unattached = service.registry.unattached();
    const byId = Object.fromEntries(
      unattached.map((entry) => [entry.auditId, entry]),
    );
    expect(Object.keys(byId).sort()).toEqual(["audit-broken", "audit-newer"]);
    expect(byId["audit-broken"]?.status).toBe("invalid");
    expect(byId["audit-broken"]?.errors.map((entry) => entry.code)).toEqual([
      "INVALID_JSON",
    ]);
    expect(byId["audit-newer"]?.status).toBe("unresolved");
    expect(byId["audit-newer"]?.errors.map((entry) => entry.code)).toContain(
      "SESSION_NOT_FOUND",
    );
    // The bound audit is shown in its own session, so it is not reported here.
    expect(unattached.map((entry) => entry.auditId)).not.toContain(
      "session-41b4e63f",
    );
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
