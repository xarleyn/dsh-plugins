import type { CorrectionMinerEngine } from "../mining/engine.js";
import type { ScanReport } from "../types.js";

interface Invocation {
  readonly rawInput: string;
  readonly agent: {
    readonly session: {
      readonly header?: { readonly cwd?: string };
    };
  };
}

type CommandResult = { readonly kind: "success" | "error"; readonly text: string };

function reportText(report: ScanReport): string {
  return [
    `Scanned ${report.sessionsScanned}/${report.sessionsConsidered} session(s).`,
    `Inspected ${report.eventsScanned} new event(s).`,
    `Found ${report.correctionsFound} correction message(s); added ${report.correctionsAdded}.`,
    report.sessionsFailed === 0 ? undefined : `${report.sessionsFailed} session(s) failed; see plugin logs.`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function createCorrectionsCommand(engine: CorrectionMinerEngine) {
  return {
    name: "corrections",
    description: "Scan and inspect user-correction evidence.",
    input: { hint: "[scan [N]|review]" },
    async handler(invocation: Invocation): Promise<CommandResult> {
      const cwd = invocation.agent.session.header?.cwd;
      if (cwd === undefined || cwd.length === 0) {
        return { kind: "error", text: "This session has no workspace directory." };
      }
      const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean);
      const subcommand = parts[0] ?? "status";
      if (subcommand === "status") {
        const count = engine.count(cwd);
        return {
          kind: "success",
          text: `${count} correction evidence record(s) are stored for this workspace.`,
        };
      }
      if (subcommand === "scan") {
        const rawLimit = parts[1];
        const limit = rawLimit === undefined ? undefined : Number(rawLimit);
        if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
          return { kind: "error", text: "Session limit must be a positive integer." };
        }
        try {
          return {
            kind: "success",
            text: reportText(
              await engine.scan({
                cwd,
                ...(limit === undefined ? {} : { lastSessions: limit }),
                incremental: true,
              }),
            ),
          };
        } catch (error) {
          return {
            kind: "error",
            text: `Correction scan failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      if (subcommand === "review") {
        const records = engine.list(cwd, 10);
        if (records.length === 0) {
          return { kind: "success", text: "No correction evidence is stored for this workspace." };
        }
        return {
          kind: "success",
          text: records
            .map(
              (record) =>
                `- ${record.sessionId}#${record.eventSeq}: ${record.text.replace(/\s+/gu, " ")}`,
            )
            .join("\n"),
        };
      }
      return { kind: "error", text: "Usage: /corrections [scan [N]|review]" };
    },
  };
}
