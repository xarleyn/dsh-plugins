export const SUBAGENT_MODEL_CATALOG = "qa_list_subagent_models";
export const TOOL_LOOP_ACTIONS = ["warn", "block", "finish"] as const;

export const TOOL_LOOP_LIMITS = {
  rules: 64,
  thresholds: 12,
  calls: 1000,
  toolName: 128,
  message: 4000,
  comparableCharacters: 4096,
} as const;

export const TOOL_LOOP_TOOL_NAME = /^[A-Za-z0-9_-]+$/u;

export interface ToolLoopThreshold {
  readonly calls: number;
  readonly action: (typeof TOOL_LOOP_ACTIONS)[number];
  readonly message: string;
}

export interface ToolLoopRuleInput {
  readonly tool: string;
  readonly maxDifferencePercent?: number;
  readonly thresholds: readonly ToolLoopThreshold[];
}

export interface ToolLoopRule extends ToolLoopRuleInput {
  readonly maxDifferencePercent: number;
}

const CATALOG_REPEAT =
  "The subagent model catalog has returned the same result twice. Use the earlier result. Choose a different action or answer with the evidence already collected.";

const ISSUE_MESSAGES = {
  rules: `Use at most ${TOOL_LOOP_LIMITS.rules} tool rules.`,
  tool: "Enter an exact tool name using letters, digits, underscores or hyphens.",
  duplicateTool: "Use one rule per tool.",
  difference: "Enter a whole percentage from 0 to 100.",
  thresholds: `Use 1 to ${TOOL_LOOP_LIMITS.thresholds} thresholds per tool.`,
  calls: `Use a whole call number from 2 to ${TOOL_LOOP_LIMITS.calls}. A block or finish requires at least two prior results.`,
  duplicateCalls: "Use a different call number for each threshold.",
  actions:
    "Put warnings before blocks and use at most one finish, at the last threshold.",
  message: `Enter a message of 1 to ${TOOL_LOOP_LIMITS.message} characters.`,
} as const;

export interface ToolLoopRuleIssue {
  readonly code: keyof typeof ISSUE_MESSAGES;
  readonly ruleIndex?: number;
}

export function toolLoopRuleIssue(
  rules: readonly ToolLoopRuleInput[],
): ToolLoopRuleIssue | undefined {
  if (rules.length > TOOL_LOOP_LIMITS.rules) return { code: "rules" };
  const seenTools = new Set<string>();
  for (const [ruleIndex, rule] of rules.entries()) {
    const tool = rule.tool.trim();
    if (
      tool.length > TOOL_LOOP_LIMITS.toolName ||
      !TOOL_LOOP_TOOL_NAME.test(tool)
    )
      return { code: "tool", ruleIndex };
    if (seenTools.has(tool)) return { code: "duplicateTool", ruleIndex };
    seenTools.add(tool);

    const difference = rule.maxDifferencePercent ?? 0;
    if (!Number.isInteger(difference) || difference < 0 || difference > 100)
      return { code: "difference", ruleIndex };
    if (
      rule.thresholds.length === 0 ||
      rule.thresholds.length > TOOL_LOOP_LIMITS.thresholds
    )
      return { code: "thresholds", ruleIndex };

    let previousCalls = 0;
    let previousAction = 0;
    for (const threshold of [...rule.thresholds].sort(byCalls)) {
      const action = TOOL_LOOP_ACTIONS.indexOf(threshold.action);
      if (action < previousAction || previousAction === 2)
        return { code: "actions", ruleIndex };
      if (
        !Number.isInteger(threshold.calls) ||
        threshold.calls < (action === 0 ? 2 : 3) ||
        threshold.calls > TOOL_LOOP_LIMITS.calls
      )
        return { code: "calls", ruleIndex };
      if (threshold.calls === previousCalls)
        return { code: "duplicateCalls", ruleIndex };
      if (
        threshold.message.trim() === "" ||
        threshold.message.length > TOOL_LOOP_LIMITS.message
      )
        return { code: "message", ruleIndex };
      previousCalls = threshold.calls;
      previousAction = action;
    }
  }
}

function byCalls(left: ToolLoopThreshold, right: ToolLoopThreshold): number {
  return left.calls - right.calls;
}

export function resolveToolLoopRules(
  input?: readonly ToolLoopRuleInput[],
): readonly ToolLoopRule[] {
  if (input === undefined) return DEFAULT_TOOL_LOOP_RULES;
  const issue = toolLoopRuleIssue(input);
  if (issue !== undefined) {
    const rule = issue.ruleIndex === undefined ? "" : `[${issue.ruleIndex}]`;
    throw new Error(`tools.loopRules${rule}: ${ISSUE_MESSAGES[issue.code]}`);
  }
  return Object.freeze(
    input.map((rule) =>
      Object.freeze({
        tool: rule.tool.trim(),
        maxDifferencePercent: rule.maxDifferencePercent ?? 0,
        thresholds: Object.freeze(
          [...rule.thresholds].sort(byCalls).map((threshold) =>
            Object.freeze({
              calls: threshold.calls,
              action: threshold.action,
              message: threshold.message.trim(),
            }),
          ),
        ),
      }),
    ),
  );
}

export const DEFAULT_TOOL_LOOP_RULES = resolveToolLoopRules([
  {
    tool: SUBAGENT_MODEL_CATALOG,
    thresholds: [
      { calls: 2, action: "warn", message: CATALOG_REPEAT },
      { calls: 3, action: "block", message: CATALOG_REPEAT },
      {
        calls: 4,
        action: "finish",
        message:
          "The subagent model catalog call was retried after QA blocked it.",
      },
    ],
  },
]);
