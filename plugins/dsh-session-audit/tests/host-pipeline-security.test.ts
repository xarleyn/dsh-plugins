/**
 * The scanner, the registry and the service: the SPEC §73 scenarios, plus the
 * §74 security cases that belong to the pipeline rather than to a component.
 */
import { readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readArtifactText } from "../src/host/audit-loader.js";
import { root, siblingRoot } from "./host-pipeline.helpers.js";
import {
  AUDIT_DIRECTORY,
  OTHER_SESSION_ID,
  REPORT,
  SESSION_ID,
  analysis,
  testService,
  writeAudit,
} from "./helpers/fixtures.js";

/** What a file outside the audit root says, to prove which one was read. */
const OUTSIDE = "# Written outside the audit root";

/** No configured cap gets in the way of these containment cases. */
const UNLIMITED = 1024 * 1024;

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

  it("never shows bytes from a directory swapped for a link", async () => {
    const { service } = testService(root);
    const directory = await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    await service.refresh();
    expect(await service.readReport(AUDIT_DIRECTORY)).toContain(
      "# Trajectory Review",
    );

    // The paths the record holds still name files under the root, but the
    // directory behind them is now a link to a neighbour keeping the same
    // names. `lstat` of the artifact itself still says "regular file", so
    // containment has to be proved for every component of the chain.
    const outside = await siblingRoot();
    await writeFile(join(outside, "REPORT.md"), OUTSIDE, "utf8");
    await writeFile(
      join(outside, "analysis.json"),
      JSON.stringify(analysis(OTHER_SESSION_ID)),
      "utf8",
    );
    await rm(directory, { recursive: true, force: true });
    await symlink(outside, directory, "junction");

    // What a reader gets is the audit that was registered — never the
    // neighbour's bytes, which is what a read through the link would return.
    expect(await service.readReport(AUDIT_DIRECTORY)).not.toContain(OUTSIDE);
    expect(await service.readAnalysisJson(AUDIT_DIRECTORY)).not.toContain(
      OTHER_SESSION_ID,
    );
    expect((await service.getSessionAudit(SESSION_ID))?.report).toContain(
      "# Trajectory Review",
    );
    // And the next scan does not register the neighbour under this id.
    await service.refresh();
    expect(service.registry.get(AUDIT_DIRECTORY)).toBeUndefined();
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

describe("readArtifactText containment", () => {
  it("reads an ordinary file under the root", async () => {
    const directory = await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });

    const read = await readArtifactText(
      { path: join(directory, "REPORT.md"), size: 0, mtimeMs: 0 },
      UNLIMITED,
      root,
    );

    expect(read.ok && read.text).toContain("# Trajectory Review");
  });

  it("refuses a file whose parent directory was swapped for a link", async () => {
    const directory = await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
      report: REPORT,
    });
    const stat = {
      path: join(directory, "REPORT.md"),
      size: REPORT.length,
      mtimeMs: 0,
    };
    expect((await readArtifactText(stat, UNLIMITED, root)).ok).toBe(true);

    const outside = await siblingRoot();
    await writeFile(join(outside, "REPORT.md"), OUTSIDE, "utf8");
    await rm(directory, { recursive: true, force: true });
    await symlink(outside, directory, "junction");

    const read = await readArtifactText(stat, UNLIMITED, root);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.code).toBe("READ_FAILED");
    expect(read.error.message).not.toContain(OUTSIDE);
  });

  it("refuses a symlinked artefact inside an ordinary directory", async () => {
    const outside = await siblingRoot();
    await writeFile(join(outside, "REPORT.md"), OUTSIDE, "utf8");
    const directory = await writeAudit(root, AUDIT_DIRECTORY, {
      analysis: analysis(),
    });
    await symlink(
      join(outside, "REPORT.md"),
      join(directory, "REPORT.md"),
      "file",
    );

    const read = await readArtifactText(
      { path: join(directory, "REPORT.md"), size: 0, mtimeMs: 0 },
      UNLIMITED,
      root,
    );

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.message).not.toContain(OUTSIDE);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a parent that is a relative link",
    async () => {
      const directory = await writeAudit(root, AUDIT_DIRECTORY, {
        analysis: analysis(),
        report: REPORT,
      });
      const outside = await siblingRoot();
      await writeFile(join(outside, "REPORT.md"), OUTSIDE, "utf8");
      await rm(directory, { recursive: true, force: true });
      // "../session-audit-test-…" is an ordinary child of the root to any
      // comparison of the two strings; only the kernel knows where the file
      // actually is, and a lexical check never asks it.
      await symlink(
        relative(dirname(root), outside),
        join(root, AUDIT_DIRECTORY),
        "dir",
      );

      const read = await readArtifactText(
        { path: join(directory, "REPORT.md"), size: 0, mtimeMs: 0 },
        UNLIMITED,
        root,
      );

      expect(read.ok).toBe(false);
      if (read.ok) return;
      expect(read.error.message).not.toContain(OUTSIDE);
    },
  );
});
