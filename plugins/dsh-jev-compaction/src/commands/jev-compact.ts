/**
 * The `/jev-compact` slash command (SPEC §21).
 *
 * `/jev-compact --dry-run` runs the full pipeline read-only.
 * `/jev-compact` runs the pipeline and queues the mutation for the next
 * `agent/pre-step` (command handlers execute between turns, where the
 * session's open-turn invariant forbids `tool/result` replacements — see
 * docs/compatibility.md §4). The command itself never creates a user model
 * message.
 */

import type {
  AgentLike,
  CommandInvocation,
  CommandResult,
} from "../dsh/types.js";
import type { JevCompactionPlan } from "../planner/plan.js";
import type { JevCompactionService, JevRunReport } from "../service.js";

/** Structural command registry view (host contract). */
export interface CommandRegistryLike {
  register(definition: {
    name: string;
    description: string;
    input?: { hint: string };
    handler(
      invocation: CommandInvocation,
    ): CommandResult | Promise<CommandResult>;
  }): unknown;
}

function formatScores(report: JevRunReport): string {
  if (report.plan === undefined) return "";
  const stubs = [...report.plan.items]
    .filter((item) => item.action === "KEEP_STUB" && item.scores !== undefined)
    .sort(
      (a, b) => (a.scores?.needContents ?? 1) - (b.scores?.needContents ?? 1),
    )
    .slice(0, 3);
  if (stubs.length === 0) return "";
  const lines = stubs.map((item) => {
    const label = item.candidate.toolName ?? "unknown";
    const args =
      item.candidate.toolArgumentsPreview?.replace(/\s+/g, " ").slice(0, 40) ??
      "";
    const score = (item.scores?.needContents ?? 0).toFixed(2);
    return `- ${label}${args.length > 0 ? ` ${args}` : ""}  ${score}`;
  });
  return `\nHighest-confidence stub candidates:\n${lines.join("\n")}`;
}

function formatPlanCounts(plan: JevCompactionPlan): string {
  const keptFull = plan.items.filter(
    (item) => item.action === "KEEP_FULL",
  ).length;
  const truncated = plan.items.filter(
    (item) => item.action === "KEEP_TRUNCATED",
  ).length;
  const stubbed = plan.items.filter(
    (item) => item.action === "KEEP_STUB",
  ).length;
  return `Would keep full: ${keptFull}\nWould truncate: ${truncated}\nWould stub: ${stubbed}`;
}

/**
 * The immediate-shaping layer's own counters for the audit output. The two
 * layers are reported separately on purpose: one combined "saved" number
 * would hide which of them did the work.
 */
function formatShapingStats(
  stats: ReturnType<JevCompactionService["shaping"]["stats"]>,
): string[] {
  const seen = stats.counters["resultShaping.seen"] ?? 0;
  if (seen === 0) return [];
  const shaped = stats.counters["resultShaping.shaped"] ?? 0;
  const saved = stats.counters["resultShaping.savedChars"] ?? 0;
  const lines = [
    "",
    "Immediate result shaping (this process):",
    `  seen ${seen}, eligible ${stats.counters["resultShaping.eligible"] ?? 0}, shaped ${shaped}`,
    `  saved ${saved.toLocaleString("en-US")} chars`,
  ];
  const reasons = Object.entries(stats.skipReasons)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);
  if (reasons.length > 0) {
    lines.push(
      `  skipped: ${reasons
        .map(([reason, count]) => `${reason}=${count}`)
        .join(" ")}`,
    );
  }
  return lines;
}

function renderReport(
  report: JevRunReport,
  includeScores: boolean,
  shaping?: ReturnType<JevCompactionService["shaping"]["stats"]>,
): string {
  if (report.skipped !== undefined && report.plan === undefined) {
    const reason = report.skipped.replace(/-/g, " ");
    return `Jev compaction: nothing to do (${reason}).`;
  }
  const header =
    report.mode === "dry-run"
      ? "Jev compaction dry-run"
      : "Jev compaction completed";
  const lines: string[] = [header, ""];

  if (report.plan !== undefined) {
    lines.push(
      `Candidates: ${report.candidates}`,
      formatPlanCounts(report.plan),
      "",
      `Estimated visible text reduction: ${report.plan.savings.charsSaved.toLocaleString("en-US")} chars`,
    );
    if (report.tokensBefore !== undefined && report.tokensAfter !== undefined) {
      const saved = report.tokensBefore - report.tokensAfter;
      const percent =
        report.tokensBefore > 0
          ? ` (${((saved / report.tokensBefore) * 100).toFixed(1)}%)`
          : "";
      lines.push(
        `Estimated token reduction: ${saved.toLocaleString("en-US")}${percent}`,
      );
    }
    if (includeScores) lines.push(formatScores(report));
    if (report.mode === "dry-run") {
      if (shaping !== undefined) lines.push(...formatShapingStats(shaping));
      lines.push("", "No changes were made.");
      return lines.join("\n");
    }
    if (report.queuedForNextStep === true) {
      lines.push(
        "",
        "Queued: the plan will be applied before the next model step, " +
          "when the session can safely accept tool-result replacements. " +
          "The plan is recomputed at that time and dropped if the surface changed.",
      );
    }
    return lines.join("\n");
  }

  if (report.applied.length > 0) {
    const before = report.tokensBefore ?? 0;
    const after = report.tokensAfter ?? before;
    const saved = Math.max(0, before - after);
    const percent =
      before > 0 ? ` (${((saved / before) * 100).toFixed(1)}%)` : "";
    lines.push(
      `Before:       ${before.toLocaleString("en-US")} estimated tokens`,
      `After:        ${after.toLocaleString("en-US")} estimated tokens`,
      `Saved:        ${saved.toLocaleString("en-US")}${percent}`,
      "",
      `Candidates:   ${report.candidates}`,
      `Full kept:    ${report.keptFull}`,
      `Truncated:    ${report.truncated}`,
      `Stubbed:      ${report.stubbed}`,
      "",
      "Applied before this step's model request; the pending queue is now empty.",
    );
    return lines.join("\n");
  }

  return `Jev compaction: nothing to do (${report.skipped?.replace(/-/g, " ") ?? "no eligible candidates"}).`;
}

/** Register `/jev-compact` on the host command registry. */
export function registerJevCompactCommand(
  commands: CommandRegistryLike,
  service: JevCompactionService,
): () => void {
  const disposer = commands.register({
    name: "jev-compact",
    description: "Prune stale tool output with Jev (add --dry-run to preview)",
    input: { hint: "[--dry-run]" },
    handler: (invocation: CommandInvocation): Promise<CommandResult> =>
      (async (): Promise<CommandResult> => {
        const dryRun = /--dry-run/i.test(invocation.rawInput);
        const agent: AgentLike = invocation.agent;
        try {
          const report = await service.runManualDry(agent, invocation.signal);
          // Manual failure behavior (SPEC §29): the operator sees the reason
          // (missing key, transport, validation), not just "nothing to do".
          if (report.error !== undefined) {
            return {
              kind: "error",
              text: `Jev compaction failed: ${report.error}`,
            };
          }
          if (dryRun) {
            return {
              kind: "success",
              text: renderReport(report, true, service.shaping.stats()),
            };
          }
          // Non-dry-run manual pass: compute the plan now (fresh Jev
          // scoring) and queue the application for the next pre-step.
          if (report.plan === undefined || report.plan.mutations.length === 0) {
            return {
              kind: "success",
              text: renderReport(report, true, service.shaping.stats()),
            };
          }
          const queued = service.queueManualRun(agent);
          return {
            kind: "success",
            text: renderReport(
              { ...report, mode: "manual", queuedForNextStep: queued },
              true,
            ),
          };
        } catch (error: unknown) {
          return {
            kind: "error",
            text: `Jev compaction failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      })(),
  });
  return disposer as () => void;
}
