import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolDependencies } from "./shared.js";
import { toToolError } from "./shared.js";

/**
 * Lightweight domain metadata for routing decisions (design §28).
 *
 * Deliberately narrow: paths, memory namespaces and policy stay out of the
 * model's view — a caller that needs them asks the expert, not the catalog.
 */
export function createListDomainsTool(dependencies: ToolDependencies) {
  return defineTool({
    name: "domain_experts_list",
    description:
      "List the domain experts available in this deployment. Use it to pick the right domain id before calling domain_expert. Returns identifiers, names and one-line descriptions only.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          count: {
            type: "integer",
            required: true,
            description: "Number of enabled domains.",
          },
          domains: {
            type: "array",
            required: true,
            description: "Enabled domains, ordered by name.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: {
                  type: "string",
                  required: true,
                  description: "Domain id for domain_expert.",
                },
                name: {
                  type: "string",
                  required: true,
                  description: "Display name.",
                },
                description: {
                  type: "string",
                  required: true,
                  description: "One-line purpose.",
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text:
            value.count === 0
              ? "No domain experts are enabled in this deployment."
              : `${String(value.count)} domain expert${value.count === 1 ? "" : "s"} available:\n${value.domains
                  .map(
                    (domain) =>
                      `- ${domain.id}: ${domain.name}${domain.description === "" ? "" : ` — ${domain.description}`}`,
                  )
                  .join("\n")}`,
        },
      ],
    },
    execute() {
      try {
        const domains = dependencies.list();
        return Promise.resolve({
          count: domains.length,
          domains: [...domains],
        });
      } catch (error) {
        throw toToolError(error);
      }
    },
    presentCall: () => ({ card: "generic", title: "List domain experts" }),
  });
}
