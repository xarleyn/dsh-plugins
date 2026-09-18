/**
 * Fixtures for the host pipeline tests: one audible audit, written to a
 * temporary root, with the session corpus under the test's control.
 *
 * All identities here are synthetic. Nothing in this package may name a real
 * project, host or person — fixtures ship in public history.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveConfig,
  type ResolvedSessionAuditConfig,
  type SessionAuditConfig,
} from "../../src/config.js";
import { AuditService } from "../../src/host/audit-service.js";
import { createRecordingLogger } from "../../src/host/logging.js";

/** The session every fixture audit is written for. */
export const SESSION_ID = "session-41b4e63f-9e35-4406-927b-25a60b7be2c2";

/** Another session, for the negative cases. */
export const OTHER_SESSION_ID = "session-0ad608a8-1111-2222-3333-444455556666";

/** The directory name the first session's audit publishes under. */
export const AUDIT_DIRECTORY = "session-41b4e63f";

/** A minimal but complete v1 analysis. */
export function analysis(
  sessionId: string = SESSION_ID,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    trajectory: {
      source: "deepseek-harness",
      sessionId,
      format: "session.v3.jsonl",
      model: "demo-model-v1",
      agentPreset: "demo-research",
    },
    evidenceSufficiency: {
      level: "rich",
      present: ["user_task", "tool_calls"],
      missing: ["user_corrections"],
    },
    verdict: "mixed",
    taskOutcome: { status: "completed_with_gaps", summary: "Mostly there." },
    scores: {
      task_success: {
        score: 3,
        confidence: "high",
        summary: "Delivered.",
        evidence: ["seq:12"],
      },
    },
    findings: [
      {
        id: "F1",
        severity: "major",
        category: "grounding",
        title: "Asserted without a lookup",
        status: "observed",
        rootCause: "AGENT",
        description: "The answer states a ticket state with no tool call.",
        evidence: ["seq:24"],
        recommendationTarget: "agent_instruction",
      },
      {
        id: "F2",
        severity: "observation",
        category: "final_answer",
        title: "Omitted the limitation",
        status: "possible",
        rootCause: "MODEL_LIMITATION",
        description: "Found mid-run, dropped from the answer.",
        evidence: ["seq:96"],
        recommendationTarget: "none",
      },
    ],
    missedOpportunities: [
      {
        capability: "knowledge-base search",
        confidence: "high",
        why: "A knowledge base was mounted and never queried.",
        evidence: ["seq:10"],
      },
    ],
    userCorrections: [],
    betterTrajectory: ["Read the module documentation first."],
    recommendations: [
      {
        target: "agent_instruction",
        priority: "high",
        action: "Require a lookup before stating a tracker's state.",
        evidence: ["F1"],
      },
    ],
    limitations: ["A negative claim cannot be re-checked from this export."],
    ...extra,
  };
}

/** The report that accompanies the fixture analysis. */
export const REPORT = [
  "# Trajectory Review",
  "",
  "## Verdict",
  "",
  "Mixed: the change landed, the second half was never verified.",
  "",
  "## Scorecard",
  "",
  "| Dimension | Score | Confidence |",
  "| --- | --- | --- |",
  "| task_success | 3 | high |",
  "",
  "## Material issues",
  "",
  "- **F1** — asserted without a lookup.",
  "",
].join("\n");

/** A temporary directory that cleans itself up. */
export async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "session-audit-test-"));
}

/** Remove a root created by {@link temporaryRoot}. */
export async function removeRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

/** Write both artefacts of an audit under `root/<name>`. */
export async function writeAudit(
  root: string,
  name: string,
  contents: { readonly analysis: unknown; readonly report?: string },
): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "analysis.json"),
    `${JSON.stringify(contents.analysis, null, 2)}\n`,
    "utf8",
  );
  if (contents.report !== undefined) {
    await writeFile(join(directory, "REPORT.md"), contents.report, "utf8");
  }
  return directory;
}

/** A config rooted at `root`, with the watcher off so tests drive the passes. */
export function testConfig(
  root: string,
  overrides: SessionAuditConfig = {},
): ResolvedSessionAuditConfig {
  return resolveConfig({
    auditRoot: root,
    watch: false,
    rescanIntervalMs: 0,
    settleMs: 0,
    ...overrides,
  });
}

/** A service over `root`, with a fixed session corpus and a recording logger. */
export function testService(
  root: string,
  options: {
    readonly sessions?: readonly string[];
    readonly config?: SessionAuditConfig;
  } = {},
): {
  readonly service: AuditService;
  readonly logger: ReturnType<typeof createRecordingLogger>;
} {
  const logger = createRecordingLogger();
  const sessions = options.sessions ?? [SESSION_ID, OTHER_SESSION_ID];
  const service = new AuditService({
    config: testConfig(root, options.config ?? {}),
    listSessionIds: async () => sessions,
    logger,
  });
  return { service, logger };
}
