import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  DEFAULT_MAX_ANALYSIS_BYTES,
  DEFAULT_RESCAN_INTERVAL_MS,
  DEFAULT_SETTLE_MS,
  resolveAuditRoot,
  resolveConfig,
} from "../src/config.js";

const HOME = resolve("/home/demo");

describe("resolveAuditRoot", () => {
  it("uses $DSH_HOME/audits by default", () => {
    expect(resolveAuditRoot({}, { DSH_HOME: HOME })).toBe(join(HOME, "audits"));
  });

  it("prefers $DSH_AUDIT_ROOT over $DSH_HOME", () => {
    expect(
      resolveAuditRoot(
        {},
        { DSH_HOME: HOME, DSH_AUDIT_ROOT: "/data/dsh-audits" },
      ),
    ).toBe(resolve("/data/dsh-audits"));
  });

  it("lets explicit configuration win over both", () => {
    expect(
      resolveAuditRoot(
        { auditRoot: "/srv/audits" },
        { DSH_HOME: HOME, DSH_AUDIT_ROOT: "/data/dsh-audits" },
      ),
    ).toBe(resolve("/srv/audits"));
  });

  it("ignores blank configuration and blank environment values", () => {
    expect(
      resolveAuditRoot(
        { auditRoot: "   " },
        { DSH_HOME: HOME, DSH_AUDIT_ROOT: " " },
      ),
    ).toBe(join(HOME, "audits"));
  });

  it("falls back to the OS home when nothing says otherwise", () => {
    const root = resolveAuditRoot({}, {});
    expect(root.endsWith("audits")).toBe(true);
    expect(root).not.toContain("qa-surface");
  });
});

describe("resolveConfig", () => {
  it("applies every documented default", () => {
    const config = resolveConfig({}, { DSH_HOME: HOME });

    expect(config).toEqual({
      enabled: true,
      auditRoot: join(HOME, "audits"),
      watch: true,
      watchMode: "auto",
      settleMs: DEFAULT_SETTLE_MS,
      rescanIntervalMs: DEFAULT_RESCAN_INTERVAL_MS,
      allowDirectoryPrefixMatch: true,
      maxAnalysisBytes: DEFAULT_MAX_ANALYSIS_BYTES,
      maxReportBytes: 5 * 1024 * 1024,
      exposeHeaderBadge: true,
    });
  });

  it("keeps an explicit value for every field", () => {
    const config = resolveConfig(
      {
        enabled: false,
        auditRoot: "/srv/audits",
        watch: false,
        watchMode: "poll",
        settleMs: 250,
        rescanIntervalMs: 0,
        allowDirectoryPrefixMatch: false,
        maxAnalysisBytes: 1024,
        maxReportBytes: 512,
        exposeHeaderBadge: false,
      },
      {},
    );

    expect(config).toEqual({
      enabled: false,
      auditRoot: resolve("/srv/audits"),
      watch: false,
      watchMode: "poll",
      settleMs: 250,
      rescanIntervalMs: 0,
      allowDirectoryPrefixMatch: false,
      maxAnalysisBytes: 1024,
      maxReportBytes: 512,
      exposeHeaderBadge: false,
    });
  });
});
