import type {
  ToolExecution,
  ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import { QA_MODEL_SELECTION_REFUSED } from "./access/model-choices.js";
import {
  SUBAGENT_MODEL_CATALOG,
  type ToolLoopRule,
  type ToolLoopThreshold,
} from "./shared/tool-loop-rules.js";
import {
  sameToolLoopResult,
  toolLoopResult,
  type ToolLoopResult,
} from "./tool-loop-results.js";

interface ToolState {
  readonly rule: ToolLoopRule;
  readonly pending: Map<ToolExecution["token"], ToolLoopResult | undefined>;
  anchor?: ToolLoopResult;
  calls: number;
  blocked?: {
    readonly calls: number;
    readonly step: number;
    readonly message: string;
  };
}

interface ToolLoopDenial {
  readonly message: string | undefined;
  readonly finishMessage?: string;
}

/** Repeat counters and a snapshot of the operator rules for one agent turn. */
export class ToolLoopTurn {
  private readonly tools = new Map<string, ToolState>();
  private catalogStep: number | undefined;
  private refreshedCatalog = false;

  constructor(rules: readonly ToolLoopRule[]) {
    for (const rule of rules) {
      this.tools.set(rule.tool, { rule, pending: new Map(), calls: 0 });
    }
  }

  /** Work in request order, allowing every call in a parallel batch to settle. */
  takeReminders(): string[] {
    const reminders: string[] = [];
    for (const tool of this.tools.values()) {
      const messages: string[] = [];
      for (const result of tool.pending.values()) {
        if (result === undefined) continue;
        if (
          tool.anchor !== undefined &&
          sameToolLoopResult(
            tool.anchor,
            result,
            tool.rule.maxDifferencePercent,
          )
        ) {
          tool.calls++;
        } else {
          tool.anchor = result;
          tool.calls = 1;
          messages.length = 0;
        }
        const warning = tool.rule.thresholds.find(
          (threshold) =>
            threshold.action === "warn" && threshold.calls === tool.calls,
        );
        if (warning !== undefined) messages.push(warning.message);
      }
      tool.pending.clear();
      reminders.push(...messages);
    }
    return reminders;
  }

  beforeCall(
    exec: Readonly<ToolExecution>,
    step: number,
  ): ToolLoopDenial | undefined {
    const catalog = exec.name === SUBAGENT_MODEL_CATALOG;
    if (!catalog) this.resetCatalogResults();
    const tool = this.tools.get(exec.name);
    if (tool === undefined) return;

    // One attempted retry per model step. A parallel batch cannot escalate its own denial.
    if (tool.blocked?.step === step) return { message: tool.blocked.message };
    const calls = (tool.blocked?.calls ?? tool.calls) + 1;
    let stage: ToolLoopThreshold | undefined;
    for (const threshold of tool.rule.thresholds) {
      if (threshold.calls > calls) break;
      if (threshold.action !== "warn") stage = threshold;
    }
    if (stage?.action === "finish")
      return { message: tool.blocked?.message, finishMessage: stage.message };
    if (stage !== undefined) {
      tool.blocked = { calls, step, message: stage.message };
      return { message: stage.message };
    }

    // The parameterless catalog has never run twice in a model step.
    if (catalog) {
      if (this.catalogStep === step)
        return {
          message:
            "Use the result of the catalog call already requested in this step.",
        };
      this.catalogStep = step;
    }
    tool.pending.set(exec.token, undefined);
  }

  onResult(exec: Readonly<ToolExecution>, result: ToolExecutionResult): void {
    if (
      exec.name === "qa_subagent" &&
      result.isError &&
      result.error.info?.code === QA_MODEL_SELECTION_REFUSED &&
      !this.refreshedCatalog
    ) {
      this.refreshedCatalog = true;
      const catalog = this.resetCatalogResults();
      if (catalog !== undefined) delete catalog.blocked;
    }
    const tool = this.tools.get(exec.name);
    if (tool?.pending.has(exec.token) === true) {
      tool.pending.set(
        exec.token,
        toolLoopResult(result, tool.rule.maxDifferencePercent),
      );
    }
  }

  /** The catalog keeps its existing consecutive-call and stale-selection semantics. */
  private resetCatalogResults(): ToolState | undefined {
    const catalog = this.tools.get(SUBAGENT_MODEL_CATALOG);
    if (catalog === undefined) return;
    delete catalog.anchor;
    catalog.calls = 0;
    for (const [token, result] of catalog.pending) {
      if (result !== undefined) catalog.pending.delete(token);
    }
    return catalog;
  }
}
