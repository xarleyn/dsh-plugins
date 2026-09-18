/**
 * The scanner, the registry and the service: the SPEC §73 scenarios, plus the
 * §74 security cases that belong to the pipeline rather than to a component.
 */
import { describe, expect, it } from "vitest";
import { AuditRegistry } from "../src/host/audit-registry.js";
import type { AuditRecord, AuditRegistryEvent } from "@yadsh/dsh-audit-core";
import "./host-pipeline.helpers.js";
import { SESSION_ID } from "./helpers/fixtures.js";

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
