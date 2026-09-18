/**
 * The scanner, the registry and the service: the SPEC §73 scenarios, plus the
 * §74 security cases that belong to the pipeline rather than to a component.
 */
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanAuditRoot } from "../src/host/audit-scanner.js";
import { computeFingerprint } from "../src/host/audit-fingerprint.js";
import { root } from "./host-pipeline.helpers.js";
import {
  AUDIT_DIRECTORY,
  REPORT,
  analysis,
  writeAudit,
} from "./helpers/fixtures.js";

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
