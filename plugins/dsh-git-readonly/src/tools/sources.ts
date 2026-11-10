import { defineTool } from "@deepseek-ai/dsh-tools";
import { sourceCatalog } from "./source-selection.js";
import type { GitToolDeps } from "./shared.js";

export function createGitSourcesTool(deps: GitToolDeps) {
  return defineTool({
    name: "dsh_git_sources",
    description:
      "List configured source ids, labels, paths and default selection used by dsh_git_* tools. These are operator labels; use dsh_git_context for actual branch and HEAD. repositoryRoots still controls access. QA deployments share the code_sources catalogue unless this Git mount overrides it.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          defaultSource: { type: "string", required: true },
          entries: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                label: { type: "string", required: true },
                path: { type: "string", required: true },
                docsVersion: { type: "string" },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(_args, exec) {
      const catalog = sourceCatalog(deps, exec);
      return {
        defaultSource: catalog.defaultSource,
        entries: [...catalog.entries],
      };
    },
  });
}
