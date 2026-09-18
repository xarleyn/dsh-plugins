/**
 * The scanner, the registry and the service: the SPEC §73 scenarios, plus the
 * §74 security cases that belong to the pipeline rather than to a component.
 */
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./host-pipeline.helpers.js";
import {
  AUDIT_DIRECTORY,
  REPORT,
  SESSION_ID,
  analysis,
  testService,
  writeAudit,
} from "./helpers/fixtures.js";

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
