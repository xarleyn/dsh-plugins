import type { Agent } from "@deepseek-ai/dsh-agent";
import { isModelInvocable, renderSkillContent } from "@deepseek-ai/dsh-skill";
import type { SkillSummary } from "@deepseek-ai/dsh-skill";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { QaEffectiveCapabilityPolicy } from "../types.js";

const SKILL_NOT_AVAILABLE = "SKILL_NOT_AVAILABLE";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderCatalog(skills: readonly SkillSummary[]): string {
  if (skills.length === 0) return "";
  return [
    "<available_skills>",
    ...skills.map(
      (skill) =>
        `  <skill name="${escapeXml(skill.name)}" description="${escapeXml(skill.description)}" />`,
    ),
    "</available_skills>",
    "Use the skill tool to load a listed skill before following it.",
  ].join("\n");
}

/**
 * Agent-local skill consumer. The local `skill` registration shadows the
 * standard loader; both discovery and direct loading enforce the same frozen
 * allow-list.
 */
export function installQaSkillPolicy(
  agent: Agent,
  policy: QaEffectiveCapabilityPolicy,
  discovered: ReadonlyMap<string, SkillSummary>,
): () => void {
  if (!policy.tools.includes("skill")) return () => undefined;
  const allowed = new Set(policy.skills);
  const visible = policy.skills
    .map((name) => discovered.get(name))
    .filter((skill): skill is SkillSummary => skill !== undefined)
    .filter(isModelInvocable);
  const cwd = agent.session.header.cwd;
  const definition = defineTool({
    name: "skill",
    description:
      "Load one available skill's instructions. Only skills listed in <available_skills> can be loaded.",
    parameters: {
      name: {
        type: "string",
        required: true,
        description: "Exact skill name from <available_skills>.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", required: true },
          content: { type: "string", required: true },
        },
      },
      render: (_args, value) => [
        { type: "text", text: String(value.content ?? "") },
      ],
    },
    execute: async (args: { readonly name: string }, exec) => {
      if (!allowed.has(args.name)) {
        throw new Error(`${SKILL_NOT_AVAILABLE}: ${args.name}`);
      }
      const skill = await agent.ctx.skills.get(args.name, {
        scope: agent,
        ...(cwd === undefined ? {} : { cwd }),
        signal: exec.signal,
      });
      if (skill === undefined || !isModelInvocable(skill)) {
        throw new Error(`${SKILL_NOT_AVAILABLE}: ${args.name}`);
      }
      return { name: skill.name, content: renderSkillContent(skill) };
    },
  });
  const disposeTool = agent.ctx.tools.register(definition);
  let disposePrompt: () => void = () => undefined;
  try {
    disposePrompt = agent.ctx.systemPrompt.section({
      name: "qa-surface:available-skills",
      order: 2_750,
      text: renderCatalog(visible),
    });
  } catch (error) {
    disposeTool();
    throw error;
  }
  return () => {
    disposePrompt();
    disposeTool();
  };
}

export { SKILL_NOT_AVAILABLE };
