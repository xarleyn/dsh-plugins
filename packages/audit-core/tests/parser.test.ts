import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getAuditSessionId, parseAuditAnalysis } from "../src/index.js";

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );

describe("parseAuditAnalysis", () => {
  it("parses a full v1 artefact", () => {
    const result = parseAuditAnalysis(fixture("analysis-v1.json"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.kind).toBe("v1");
    expect(result.errors).toEqual([]);
    if (result.analysis.kind !== "v1") return;
    expect(result.analysis.verdict).toBe("mixed");
    expect(result.analysis.trajectory.sessionId).toBe(
      "session-41b4e63f-9e35-4406-927b-25a60b7be2c2",
    );
    expect(result.analysis.findings).toHaveLength(5);
    expect(result.analysis.findings[0]?.evidence).toEqual(["seq:24", "seq:52"]);
    expect(result.analysis.scores.grounding?.score).toBe(1);
    expect(result.analysis.scores.stopping?.score).toBe("N/A");
    // The opaque producer-owned shape survives verbatim.
    expect(result.analysis.userCorrections[0]?.skillCandidate).toBe(
      "Confirm the target tracker before reporting a change.",
    );
  });

  it("accepts the semantic minimum and fills the rest", () => {
    const result = parseAuditAnalysis(fixture("analysis-v1-minimal.json"));

    expect(result.ok).toBe(true);
    if (!result.ok || result.analysis.kind !== "v1") return;
    expect(result.analysis.verdict).toBe("");
    expect(result.analysis.findings).toEqual([]);
    expect(result.analysis.scores).toEqual({});
    expect(result.analysis.taskOutcome).toBeUndefined();
    expect(result.analysis.evidenceSufficiency).toBeUndefined();
  });

  it("keeps an unknown schema viewable instead of failing it", () => {
    const result = parseAuditAnalysis(
      JSON.stringify({
        schemaVersion: 2,
        audit: { id: "audit-f3e452", createdAt: "2026-09-17T18:31:54Z" },
        trajectory: { sessionId: "session-41b4e63f" },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis).toEqual({ kind: "unknown", schemaVersion: 2 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("UNSUPPORTED_SCHEMA");
    expect(result.errors[0]?.severity).toBe("warning");
    // An unknown schema has no readable binding, so it can never attach a session.
    expect(getAuditSessionId(result.analysis)).toBeNull();
  });

  it("reports malformed JSON with the parser's own reason", () => {
    const result = parseAuditAnalysis('{"schemaVersion": 1,');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("INVALID_JSON");
    expect(result.errors[0]?.message).toContain("not valid JSON");
  });

  it("reports an empty document", () => {
    const result = parseAuditAnalysis("   \n");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("INVALID_JSON");
  });

  it("tolerates a byte-order mark", () => {
    const result = parseAuditAnalysis(
      `\uFEFF${fixture("analysis-v1-minimal.json")}`,
    );

    expect(result.ok).toBe(true);
  });

  it("rejects a top-level array", () => {
    const result = parseAuditAnalysis("[1, 2, 3]");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("INVALID_SCHEMA");
  });

  it("rejects a missing schemaVersion", () => {
    const result = parseAuditAnalysis('{"trajectory": {"sessionId": "s"}}');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("schemaVersion");
  });

  it("rejects a missing trajectory.sessionId", () => {
    const result = parseAuditAnalysis('{"schemaVersion": 1, "trajectory": {}}');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("INVALID_SCHEMA");
    expect(result.errors[0]?.message).toContain("trajectory.sessionId");
  });

  it("rejects a blank sessionId rather than binding an empty id", () => {
    const result = parseAuditAnalysis(
      '{"schemaVersion": 1, "trajectory": {"sessionId": "   "}}',
    );

    expect(result.ok).toBe(false);
  });

  it("drops malformed entries inside otherwise valid collections", () => {
    const result = parseAuditAnalysis(
      JSON.stringify({
        schemaVersion: 1,
        trajectory: { sessionId: "session-1" },
        findings: [null, 42, { id: "F1", severity: "major" }, "text"],
        betterTrajectory: ["keep", 7, null, ""],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.analysis.kind !== "v1") return;
    expect(result.analysis.findings).toHaveLength(1);
    expect(result.analysis.findings[0]?.id).toBe("F1");
    expect(result.analysis.betterTrajectory).toEqual(["keep"]);
  });

  it("reads the optional execution totals when a producer supplies them", () => {
    const result = parseAuditAnalysis(
      JSON.stringify({
        schemaVersion: 1,
        trajectory: { sessionId: "session-1", toolCalls: 42, toolErrors: 3 },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.analysis.kind !== "v1") return;
    expect(result.analysis.trajectory.toolCalls).toBe(42);
    expect(result.analysis.trajectory.toolErrors).toBe(3);
  });
});

describe("getAuditSessionId", () => {
  it("reads the authoritative id from a v1 trajectory", () => {
    const result = parseAuditAnalysis(fixture("analysis-v1.json"));
    if (!result.ok) throw new Error("fixture must parse");
    expect(getAuditSessionId(result.analysis)).toBe(
      "session-41b4e63f-9e35-4406-927b-25a60b7be2c2",
    );
  });
});
