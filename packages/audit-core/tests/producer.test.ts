import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditPublishError, publishAudit } from "../src/producer/index.js";
import { AUDIT_INCOMING_DIRECTORY } from "../src/paths.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "audit-core-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const analysis = (sessionId: string) => ({
  schemaVersion: 1,
  trajectory: { sessionId },
  verdict: "good",
  findings: [{ id: "F1", severity: "minor", title: "A minor thing" }],
});

const SESSION = "session-41b4e63f-9e35-4406-927b-25a60b7be2c2";

describe("publishAudit", () => {
  it("publishes both artefacts under the derived directory name", async () => {
    const result = await publishAudit({
      auditRoot: root,
      analysis: analysis(SESSION),
      report: "# Trajectory Review\n\nEverything is fine.\n",
    });

    expect(result.auditId).toBe("session-41b4e63f");
    expect(result.directory).toBe(join(root, "session-41b4e63f"));

    const written = JSON.parse(
      await readFile(join(result.directory, "analysis.json"), "utf8"),
    );
    expect(written.trajectory.sessionId).toBe(SESSION);
    expect(await readFile(join(result.directory, "REPORT.md"), "utf8")).toBe(
      "# Trajectory Review\n\nEverything is fine.\n",
    );
  });

  it("leaves no staging directory behind", async () => {
    await publishAudit({
      auditRoot: root,
      analysis: analysis(SESSION),
      report: "report",
    });

    expect(await readdir(join(root, AUDIT_INCOMING_DIRECTORY))).toEqual([]);
    expect((await readdir(root)).sort()).toEqual([
      AUDIT_INCOMING_DIRECTORY,
      "session-41b4e63f",
    ]);
  });

  it("creates the audit root when it does not exist yet", async () => {
    const nested = join(root, "deep", "audits");
    const result = await publishAudit({
      auditRoot: nested,
      analysis: analysis(SESSION),
      report: "report",
    });

    // `readdir` reports in filesystem order, not sorted: compare the set.
    expect((await readdir(result.directory)).sort()).toEqual([
      "REPORT.md",
      "analysis.json",
    ]);
  });

  it("honours an explicit directory name", async () => {
    const result = await publishAudit({
      auditRoot: root,
      analysis: analysis(SESSION),
      report: "report",
      directoryName: "audit-f3e452",
    });

    expect(result.auditId).toBe("audit-f3e452");
  });

  it("publishes beside an existing audit rather than over it", async () => {
    const first = await publishAudit({
      auditRoot: root,
      analysis: analysis(SESSION),
      report: "first",
    });
    const second = await publishAudit({
      auditRoot: root,
      analysis: analysis(SESSION),
      report: "second",
    });

    expect(second.auditId).toBe("session-41b4e63f-2");
    expect(second.directory).not.toBe(first.directory);
    // The earlier audit is untouched: a producer never destroys one.
    expect(await readFile(join(first.directory, "REPORT.md"), "utf8")).toBe(
      "first",
    );
    expect(await readFile(join(second.directory, "REPORT.md"), "utf8")).toBe(
      "second",
    );
  });

  it("replaces the incumbent only when asked to", async () => {
    const first = await publishAudit({
      auditRoot: root,
      analysis: analysis(SESSION),
      report: "old",
    });
    const second = await publishAudit({
      auditRoot: root,
      analysis: analysis(SESSION),
      report: "new",
      onConflict: "replace",
    });

    expect(second.directory).toBe(first.directory);
    expect(await readFile(join(first.directory, "REPORT.md"), "utf8")).toBe(
      "new",
    );
    expect((await readdir(root)).sort()).toEqual([
      AUDIT_INCOMING_DIRECTORY,
      "session-41b4e63f",
    ]);
  });

  it("refuses an analysis that does not validate, and stages nothing", async () => {
    await expect(
      publishAudit({
        auditRoot: root,
        analysis: { schemaVersion: 1, trajectory: {} },
        report: "report",
      }),
    ).rejects.toBeInstanceOf(AuditPublishError);

    // The root may have been created, but no audit and no staging survived.
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses an analysis that declares no session id at all", async () => {
    // An unknown schema still parses, but nothing names a directory for it.
    await expect(
      publishAudit({
        auditRoot: root,
        analysis: { schemaVersion: 2, trajectory: {} },
        report: "report",
      }),
    ).rejects.toThrow(/without a trajectory\.sessionId/u);

    expect(await readdir(root)).toEqual([]);
  });

  it("refuses a directory name that would escape the audit root", async () => {
    await expect(
      publishAudit({
        auditRoot: root,
        analysis: analysis(SESSION),
        report: "report",
        directoryName: "../escape",
      }),
    ).rejects.toThrow(/unsafe audit directory name/u);

    expect(await readdir(root)).toEqual([]);
  });

  it("publishes what it validated, not what it was handed", async () => {
    // A value with a toJSON that lies is still validated after serialisation.
    const liar = {
      schemaVersion: 1,
      trajectory: { sessionId: SESSION },
      toJSON: () => ({ schemaVersion: 1, trajectory: {} }),
    };

    await expect(
      publishAudit({ auditRoot: root, analysis: liar, report: "r" }),
    ).rejects.toBeInstanceOf(AuditPublishError);
  });

  it("reports a publish failure with a stable code", async () => {
    const blocker = join(root, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    await expect(
      publishAudit({
        auditRoot: join(blocker, "audits"),
        analysis: analysis(SESSION),
        report: "report",
      }),
    ).rejects.toMatchObject({
      name: "AuditPublishError",
      errors: [expect.objectContaining({ code: "READ_FAILED" })],
    });
  });
});
