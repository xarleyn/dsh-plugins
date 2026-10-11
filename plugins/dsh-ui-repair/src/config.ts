import z from "@deepseek-ai/schemastery";
import {
  REPAIR_MODES,
  REPAIR_RULE_IDS,
  type UIRepairIgnoreRule,
} from "./shared/config.js";

const ignoreRuleSchema = z.object({
  plugin: z.string(),
  rule: z.union(REPAIR_RULE_IDS),
  selector: z.string(),
}) as z<UIRepairIgnoreRule>;

/**
 * Every node is `.volatile()`: in `0.1.7` a volatile node is what makes a field a
 * live form field, and the Host publishes the namespace only once one of them
 * stands. `ignore` marks the ARRAY — volatility inside array items is rejected at
 * resolve time.
 */
export const ConfigSchema = z.object({
  enabled: z.boolean().default(true).volatile(),
  mode: z.union(REPAIR_MODES).default("observe").volatile(),
  autoConfidence: z.number().min(0).max(1).default(0.95).volatile(),
  dangerousConfidence: z.number().min(0).max(1).default(0.98).volatile(),
  scanOnStartup: z.boolean().default(true).volatile(),
  scanAfterMutation: z.boolean().default(true).volatile(),
  scanAfterResize: z.boolean().default(true).volatile(),
  ignore: z.array(ignoreRuleSchema).default([]).volatile(),
});
