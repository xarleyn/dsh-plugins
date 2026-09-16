import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { isModelInvocable, renderSkillContent } from "@deepseek-ai/dsh-skill";
import type { SkillSummary } from "@deepseek-ai/dsh-skill";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type {
  QaEffectiveCapabilityPolicy,
  QaSkillActivationOrigin,
} from "../types.js";
import type { QaAgentToolGrants } from "./tool-grants.js";

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

/** The skill one injected message belongs to, or `undefined` for other messages. */
function invokedSkill(message: UserMessage): string | undefined {
  const source = message.source;
  return source.kind === "skill-invocation" ? source.name : undefined;
}

function availabilityReason(skillName: string, subroleId: string): string {
  return `Skill "${skillName}" is not available for QA subrole "${subroleId}".`;
}

export interface QaSkillPolicyOptions {
  readonly agent: Agent;
  readonly policy: QaEffectiveCapabilityPolicy;
  readonly discovered: ReadonlyMap<string, SkillSummary>;
  /** The agent's live tool policy; loading a skill may widen it. */
  readonly grants: QaAgentToolGrants;
  readonly logger: PluginLogger;
  /** Preview sessions exercise the real policy and label their own records. */
  readonly preview?: boolean;
}

/**
 * Agent-local skill consumer. The local `skill` registration shadows the
 * standard loader; discovery, direct loading and a `/name` gesture all enforce
 * the same frozen allow-list, and every successful load activates the tool
 * grant the skill declares — still capped by the subrole's ceiling.
 *
 * Loading the instructions and widening the toolset is one operation: a skill
 * that cannot be granted what it requires is refused instead of being handed
 * instructions it has no tools to follow.
 */
export function installQaSkillPolicy(
  options: QaSkillPolicyOptions,
): () => void {
  const { agent, policy, discovered, grants } = options;
  if (!policy.tools.includes("skill")) return () => undefined;
  const modelAllowed = new Set(policy.skills);
  const userAllowed = new Set(
    policy.userSkills.length === 0 ? policy.skills : policy.userSkills,
  );
  const visible = policy.skills
    .map((name) => discovered.get(name))
    .filter((skill): skill is SkillSummary => skill !== undefined)
    .filter(isModelInvocable);
  const cwd = agent.session.header.cwd;
  const origin: QaSkillActivationOrigin =
    options.preview === true ? "preview" : "model";
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
      if (!modelAllowed.has(args.name)) {
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
      const outcome = grants.activate(args.name, origin);
      if (outcome.status === "rejected") {
        options.logger.warn("skill-policy.activation-rejected", {
          skill: args.name,
          reason: outcome.reason,
        });
        throw new Error(outcome.reason);
      }
      const content = [renderSkillContent(skill), outcome.warning]
        .filter((part): part is string => part !== undefined && part !== "")
        .join("\n\n");
      return { name: skill.name, content };
    },
  });
  const disposeTool = agent.ctx.tools.register(definition);
  let disposePrompt: () => void = () => undefined;
  let disposeGesture: () => void = () => undefined;
  try {
    disposePrompt = agent.ctx.systemPrompt.section({
      name: "qa-surface:available-skills",
      order: 2_750,
      text: renderCatalog(visible),
    });
    // The command menu and a typed `/name` are handled by the standard skill
    // consumer, which appends the rendered body to this step's messages. This
    // listener is registered ahead of it so it can still withdraw the
    // injection, and an allowed skill has its grant in place before the same
    // step is assembled.
    disposeGesture = agent.ctx.on(
      "agent/pre-step",
      // The payload's `messages` are the pre-injection batch; what matters here
      // is what the rest of the chain produced, read after `next()`.
      async (
        _payload: { readonly messages: UserMessage[] },
        next: () => Promise<PreStepDecision>,
      ): Promise<PreStepDecision> => {
        const decision = await next();
        if (decision.kind === "reject") return decision;
        if (
          !decision.messages.some(
            (message) => invokedSkill(message) !== undefined,
          )
        ) {
          return decision;
        }
        let changed = false;
        const nextMessages = decision.messages.flatMap((message) => {
          const name = invokedSkill(message);
          if (name === undefined) return [message];
          if (!userAllowed.has(name)) {
            changed = true;
            grants.deny(
              name,
              "user",
              availabilityReason(name, policy.subroleId),
            );
            options.logger.warn("skill-policy.invocation-denied", {
              skill: name,
              subroleId: policy.subroleId,
            });
            return [];
          }
          const outcome = grants.activate(name, "user");
          if (outcome.status === "activated") return [message];
          changed = true;
          options.logger.warn("skill-policy.activation-rejected", {
            skill: name,
            reason: outcome.reason,
          });
          // The step still runs: the model is told why the skill it was asked
          // to follow is not in force, instead of silently acting on it.
          return [
            createUserMessage({
              source: message.source,
              content: [{ type: "text", text: outcome.reason }],
            }),
          ];
        });
        return changed ? { ...decision, messages: nextMessages } : decision;
      },
      { prepend: true },
    );
  } catch (error) {
    disposeGesture();
    disposePrompt();
    disposeTool();
    throw error;
  }
  return () => {
    disposeGesture();
    disposePrompt();
    disposeTool();
  };
}

export { SKILL_NOT_AVAILABLE };
