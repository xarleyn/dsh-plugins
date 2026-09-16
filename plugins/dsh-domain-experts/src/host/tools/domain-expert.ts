import { defineTool } from "@deepseek-ai/dsh-tools";
import { DomainExpertsError } from "../errors.js";
import {
  EXPERT_MODE_VALUES,
  callerSessionIdOf,
  requestOf,
  requireAgent,
  statusLine,
  toToolError,
  toolFailureDetail,
  type ToolDependencies,
} from "./shared.js";

const FINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    claim: {
      type: "string",
      required: true,
      description: "One asserted fact.",
    },
    evidence: {
      type: "array",
      required: true,
      description: "Paths, documents or memory keys behind the claim.",
      items: { type: "string" },
    },
    confidence: {
      type: "string",
      required: true,
      description: "high, medium or low.",
    },
  },
} as const;

/**
 * Run a domain expert (design §10) and delegate across domains (design §17).
 *
 * There is one tool for both: when the caller is itself an expert child, the
 * same call is a delegation, and the caller's cross-domain policy decides
 * whether it is allowed. Keeping one entry point means the policy cannot be
 * bypassed by reaching for a second tool name.
 */
export function createDomainExpertTool(dependencies: ToolDependencies) {
  return defineTool({
    name: "domain_expert",
    description:
      "Ask the expert for one domain to investigate, answer or review something inside its own domain. Pass the domain id from domain_experts_list, state the task, and include any context the expert cannot discover itself. When you are an expert and the work belongs to another domain, call this same tool for that domain instead of guessing.",
    parameters: {
      domain: {
        type: "string",
        required: true,
        description: "Domain id, as returned by domain_experts_list.",
      },
      task: {
        type: "string",
        required: true,
        description: "What to investigate, answer or review.",
      },
      context: {
        type: "string",
        description:
          "Facts the expert cannot discover on its own, such as the calling issue or prior findings.",
      },
      output: {
        type: "string",
        description:
          "What the answer should contain, for example 'root cause and evidence'.",
      },
      mode: {
        type: "string",
        enum: [...EXPERT_MODE_VALUES],
        description: "investigate (default), answer or review.",
      },
      background: {
        type: "boolean",
        description:
          "Start a durable background child and return immediately with its session id instead of waiting for the answer.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          domain: {
            type: "string",
            required: true,
            description: "Domain that answered.",
          },
          expert: {
            type: "string",
            required: true,
            description: "Display name of the domain.",
          },
          status: {
            type: "string",
            required: true,
            description:
              "completed, aborted, error, max-tokens, refusal or delegated.",
          },
          summary: {
            type: "string",
            required: true,
            description: "One-paragraph answer.",
          },
          findings: {
            type: "array",
            required: true,
            description: "Claims with evidence and confidence.",
            items: FINDING_SCHEMA,
          },
          conflicts: {
            type: "array",
            required: true,
            description: "Sources that disagree with each other.",
            items: { type: "string" },
          },
          assumptions: {
            type: "array",
            required: true,
            description: "What the expert had to assume.",
            items: { type: "string" },
          },
          followUps: {
            type: "array",
            required: true,
            description: "Suggested next questions.",
            items: { type: "string" },
          },
          diagnostic: {
            type: "string",
            required: true,
            description: "Failure detail, when any.",
          },
          childSessionId: {
            type: "string",
            required: true,
            description:
              "Session of the expert child that produced this answer.",
          },
          durationMs: {
            type: "integer",
            required: true,
            description: "Wall-clock duration.",
          },
          structured: {
            type: "boolean",
            required: true,
            description:
              "Whether the child returned the structured answer block.",
          },
        },
      },
      render: (_args, value) => {
        const lines = [
          `${statusLine(value.domain, value.status, value.durationMs)} expert=${value.expert}`,
          "",
          value.summary === "" ? "(no summary returned)" : value.summary,
        ];
        if (value.findings.length > 0) {
          lines.push("", "Findings:");
          for (const finding of value.findings)
            lines.push(formatFinding(finding));
        }
        if (value.conflicts.length > 0) {
          lines.push(
            "",
            "Conflicts:",
            ...value.conflicts.map((item) => `- ${item}`),
          );
        }
        if (value.assumptions.length > 0) {
          lines.push(
            "",
            "Assumptions:",
            ...value.assumptions.map((item) => `- ${item}`),
          );
        }
        if (value.followUps.length > 0) {
          lines.push(
            "",
            "Follow-ups:",
            ...value.followUps.map((item) => `- ${item}`),
          );
        }
        if (value.diagnostic !== "")
          lines.push("", `Diagnostic: ${value.diagnostic}`);
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    async execute(args, exec) {
      const agent = requireAgent(exec.agent, "domain_expert");
      const sessionId = callerSessionIdOf(agent);
      const caller = dependencies.activeRun(sessionId);
      const callerDomain = caller?.domainId ?? null;

      try {
        const definition = dependencies.requireDefinition(args.domain);
        if (callerDomain !== null) {
          if (callerDomain === definition.id) {
            throw new DomainExpertsError(
              "DELEGATION_DENIED",
              `"${definition.id}" is your own domain; answer from your own evidence instead of delegating to yourself.`,
              { refs: [definition.id] },
            );
          }
          const verdict = dependencies.delegationVerdict(
            callerDomain,
            definition.id,
          );
          if (!verdict.allowed) {
            throw new DomainExpertsError("DELEGATION_DENIED", verdict.message, {
              refs: [callerDomain, definition.id],
            });
          }
        }
        const budget = dependencies.parallelBudget(sessionId);
        if (budget.exceeded) {
          throw new DomainExpertsError(
            "PARALLELISM_EXCEEDED",
            `This caller allows ${String(budget.limit)} parallel expert call${budget.limit === 1 ? "" : "s"} and ${String(budget.active)} are already running; wait for one to finish.`,
            { refs: [definition.id] },
          );
        }

        const result = await dependencies.run({
          parent: agent,
          definition,
          request: requestOf(args),
          signal: exec.signal,
          callerDomain,
        });
        return {
          domain: result.domainId,
          expert: result.expert,
          status: result.status,
          summary: result.summary,
          findings: result.findings.map((finding) => ({
            claim: finding.claim,
            evidence: [...finding.evidence],
            confidence: finding.confidence,
          })),
          conflicts: [...result.conflicts],
          assumptions: [...result.assumptions],
          followUps: [...result.followUps],
          diagnostic: result.diagnostic,
          childSessionId: result.childSessionId,
          durationMs: Math.round(result.durationMs),
          structured: result.structured,
        };
      } catch (error) {
        const detail = toolFailureDetail(error);
        dependencies.logger.warn("domain-expert/refused", {
          domain: args.domain,
          callerDomain,
          code: detail.code,
        });
        throw toToolError(error);
      }
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Domain expert: ${args.domain}`,
      kind: "other",
      rawInput: args.task,
    }),
  });
}

function formatFinding(finding: {
  readonly claim: string;
  readonly evidence: readonly string[];
  readonly confidence: string;
}): string {
  const evidence =
    finding.evidence.length > 0 ? ` (${finding.evidence.join("; ")})` : "";
  return `- [${finding.confidence}] ${finding.claim}${evidence}`;
}
