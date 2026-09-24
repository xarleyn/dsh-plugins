import { normalizeCapabilityConfig } from "../../src/access/model.js";
import { parseQaSkillMetadata } from "../../src/access/skill-metadata.js";
import type { QaSkillDescriptor } from "../../src/types.js";

export const ROLES = new Set(["analyst", "developer"]);

export function descriptor(
  name: string,
  raw: Readonly<Record<string, unknown>> | undefined,
): QaSkillDescriptor {
  return parseQaSkillMetadata(
    name,
    raw === undefined ? undefined : { "qa-surface": raw },
    ROLES,
  );
}

export const config = normalizeCapabilityConfig({
  version: 1,
  common: {
    tools: { always: ["search"], skillGrantable: ["browser_open"] },
    skills: ["company"],
  },
  subroles: [
    {
      id: "analyst",
      name: "Analyst",
      enabled: true,
      capabilities: {
        tools: { always: ["analytics", "missing_tool"], skillGrantable: [] },
        skills: ["data-analysis", "missing-skill"],
      },
    },
    {
      id: "developer",
      name: "Developer",
      enabled: true,
      capabilities: {
        tools: { always: ["git"], skillGrantable: ["browser_click"] },
        skills: ["code-review"],
      },
    },
  ],
  skillOverrides: [],
});

export const INSTALLED_TOOLS = new Set([
  "read",
  "search",
  "analytics",
  "git",
  "skill",
  "browser_open",
  "browser_click",
]);
export const INSTALLED_SKILLS = new Set([
  "company",
  "data-analysis",
  "code-review",
  "browser-research",
  "legacy-skill",
]);
