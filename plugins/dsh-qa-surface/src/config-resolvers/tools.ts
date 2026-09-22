import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { isDocumentationVersion } from "../shared/docs-version.js";
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
  const defaultVersion = (
    input.tools?.docsDefaultVersion ??
    DEFAULT_QA_SURFACE_CONFIG.tools.docsDefaultVersion
  ).trim();
  // A default the corpus can never match would answer every search with "no
  // documentation matches", which reads as a missing document rather than a
  // misconfigured stand. The grammar is the one the facets are parsed with.
  if (defaultVersion !== "" && !isDocumentationVersion(defaultVersion)) {
    throw new Error(
      `tools.docsDefaultVersion must be a documentation version such as "3.8", got "${defaultVersion}"`,
    );
  }
  return Object.freeze({
    activationSkill,
    activationMode,
    activationPresets: Object.freeze(activationPresets),
    dynamicActivation:
      input.tools?.dynamicActivation ??
      DEFAULT_QA_SURFACE_CONFIG.tools.dynamicActivation,
    docsRoot: input.tools?.docsRoot ?? DEFAULT_QA_SURFACE_CONFIG.tools.docsRoot,
    // The switch decides whether the version is in force; the version itself is
    // reported either way, so a card can show a value whose switch is off.
    docsDefaultVersion: defaultVersion,
    docsDefaultVersionEnabled:
      input.tools?.docsDefaultVersionEnabled ??
      DEFAULT_QA_SURFACE_CONFIG.tools.docsDefaultVersionEnabled,
  });
}

/**
 * The version one search runs under, or `""` when the deployment's default is
 * off, unset, or not what the call is about.
 *
 * The readers take a single fallback, and a switch that is off must not fall
 * back at all — the value stays configured for the day it is turned on, and an
 * enabled-but-empty pair is simply no default.
 */
export function docsDefaultVersionOf(
  tools: ResolvedQaSurfaceConfig["tools"],
): string {
  return tools.docsDefaultVersionEnabled ? tools.docsDefaultVersion : "";
}
