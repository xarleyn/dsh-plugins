import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";

type ToolsSlice = ResolvedQaSurfaceConfig["tools"];

/**
 * The public skill-name grammar (`@deepseek-ai/dsh-skill`): lowercase
 * kebab-case. Validating here keeps a typo in `activationSkill` from silently
 * disabling activation for the whole deployment.
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Resolve the QA tool delivery domain: activation trigger, policy, and scope. */
export function resolveTools(input: QaSurfaceConfig): ToolsSlice {
  const activationSkill =
    input.tools?.activationSkill ??
    DEFAULT_QA_SURFACE_CONFIG.tools.activationSkill;
  if (!SKILL_NAME.test(activationSkill)) {
    throw new Error(
      `tools.activationSkill must be a kebab-case skill name, got "${activationSkill}"`,
    );
  }
  const activationMode =
    input.tools?.activationMode ??
    DEFAULT_QA_SURFACE_CONFIG.tools.activationMode;
  if (activationMode !== "all") {
    throw new Error(
      `tools.activationMode must be "all"; got "${String(activationMode)}"`,
    );
  }
  const activationPresets = [
    ...(input.tools?.activationPresets ??
      DEFAULT_QA_SURFACE_CONFIG.tools.activationPresets),
  ];
  for (const preset of activationPresets) {
    if (preset.length === 0) {
      throw new Error("tools.activationPresets must not contain empty names");
    }
  }
  return Object.freeze({
    activationSkill,
    activationMode,
    activationPresets: Object.freeze(activationPresets),
    dynamicActivation:
      input.tools?.dynamicActivation ??
      DEFAULT_QA_SURFACE_CONFIG.tools.dynamicActivation,
    docsRoot: input.tools?.docsRoot ?? DEFAULT_QA_SURFACE_CONFIG.tools.docsRoot,
  });
}
