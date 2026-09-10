import z from "@deepseek-ai/schemastery";
import {
  REPAIR_MODES,
  REPAIR_RULE_IDS,
  type UIRepairIgnoreRule,
  type UIRepairPluginConfig,
} from "./shared/config.js";

const ignoreRuleSchema = z.object({
  plugin: z.string(),
  rule: z.union(REPAIR_RULE_IDS),
  selector: z.string(),
}) as z<UIRepairIgnoreRule>;

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.union(REPAIR_MODES).default("observe"),
  autoConfidence: z.number().min(0).max(1).default(0.95),
  dangerousConfidence: z.number().min(0).max(1).default(0.98),
  scanOnStartup: z.boolean().default(true),
  scanAfterMutation: z.boolean().default(true),
  scanAfterResize: z.boolean().default(true),
  ignore: z.array(ignoreRuleSchema).default([]) as z<UIRepairIgnoreRule[]>,
}) as unknown as z<UIRepairPluginConfig>;
