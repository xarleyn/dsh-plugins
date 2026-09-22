import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createFileDeleteTool } from "./file-delete.js";
import { createDocsReadTool, createDocsSearchTool } from "./docs-tools.js";
import type { QaToolDescriptor } from "./types.js";

/**
 * Deterministic catalog identity. The durable activation marker is derived from
 * the session log rather than stored, so this version is not compared against a
 * persisted record; it is reported by `qa_tools_selfcheck` and by the operator
 * log so a catalog change is visible in a running deployment.
 *
 * Bump it whenever the catalog's tool set or their schemas change.
 */
export const QA_TOOL_CATALOG_VERSION = "3";

/** What the catalog's definitions read, beyond the execution record. */
export interface QaToolsSelfcheckDeps {
  readonly catalogVersion: string;
  readonly activationMode: string;
  /** Names the catalog contributes, in catalog order. */
  readonly catalogTools: () => readonly string[];
  /** Names currently registered on the calling agent. */
  readonly activeTools: (agent: Agent) => readonly string[];
  /** Whether the calling agent's session shows the activation skill was loaded. */
  readonly skillLoaded: (agent: Agent) => boolean;
  /**
   * Documentation root the two readers use, or `""` for the `docs/` directory
   * inside each chat's own workspace.
   */
  readonly docsRoot?: string;
  /**
   * Version a search without `version` and without `path` stays inside, or `""`
   * for a search across every edition the corpus carries.
   */
  readonly docsDefaultVersion?: string;
}

function createSelfcheckTool(
  deps: QaToolsSelfcheckDeps,
): QaToolDescriptor["definition"] {
  return defineTool({
    name: "qa_tools_selfcheck",
    description:
      "Report whether the QA tool set is active for this agent and which QA tools are registered. Use it to diagnose a task that seems to be missing a QA capability.",
    parameters: {
      action: {
        type: "string",
        required: true,
        enum: ["status", "catalog"],
        description:
          "`status` reports this agent's activation state; `catalog` describes the shipped QA tool catalog.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          catalogVersion: { type: "string", required: true },
          activationMode: { type: "string", required: true },
          catalogTools: {
            type: "array",
            required: true,
            items: { type: "string" },
          },
          activeTools: {
            type: "array",
            required: true,
            items: { type: "string" },
          },
          active: { type: "boolean", required: true },
          skillLoaded: { type: "boolean", required: true },
        },
      },
      render: (args, value) => {
        const active = value.active === true;
        const tools = Array.isArray(value.activeTools) ? value.activeTools : [];
        const text =
          args.action === "catalog"
            ? `QA tool catalog ${String(value.catalogVersion)} (mode ${String(value.activationMode)}): ${tools.join(", ") || "(empty)"}.`
            : active
              ? `QA tools are active (catalog ${String(value.catalogVersion)}): ${tools.join(", ") || "(empty)"}.`
              : `QA tools are inactive (catalog ${String(value.catalogVersion)}, skill loaded: ${String(value.skillLoaded)}).`;
        return [{ type: "text", text }];
      },
    },
    execute: async (args, exec) => {
      const agent = exec.agent;
      const activeTools = agent === undefined ? [] : deps.activeTools(agent);
      return {
        catalogVersion: deps.catalogVersion,
        activationMode: deps.activationMode,
        catalogTools: [...deps.catalogTools()],
        activeTools: [...activeTools],
        active: activeTools.length > 0,
        skillLoaded: agent === undefined ? false : deps.skillLoaded(agent),
      };
    },
  });
}

/**
 * Build the shipped QA tool catalog.
 *
 * Side-effect free: constructing it registers nothing with `ctx.tools`. The
 * activation manager owns every registration.
 */
export function createQaToolCatalog(
  deps: QaToolsSelfcheckDeps,
): readonly QaToolDescriptor[] {
  return [
    {
      definition: createSelfcheckTool(deps),
      group: "diagnostics",
      tags: ["activation", "diagnostics"],
    },
    {
      definition: createDocsSearchTool({
        root: deps.docsRoot ?? "",
        defaultVersion: deps.docsDefaultVersion ?? "",
      }),
      group: "documentation",
      tags: ["docs", "search"],
    },
    {
      definition: createDocsReadTool({ root: deps.docsRoot ?? "" }),
      group: "documentation",
      tags: ["docs", "read"],
    },
    {
      definition: createFileDeleteTool(),
      group: "workspace",
      tags: ["files", "destructive"],
    },
  ];
}

/** QA tool names, in catalog order; the admission gate treats them as dynamic. */
export function qaToolNames(catalog: readonly QaToolDescriptor[]): string[] {
  return catalog.map((descriptor) => descriptor.definition.name);
}

/**
 * Validate the catalog before it is registered anywhere: names must be unique
 * and non-empty. Called once at activation preflight so a broken catalog fails
 * before the first registration rather than halfway through.
 * @param catalog - descriptors to validate.
 * @throws when two descriptors share a name or a name is empty.
 */
export function assertValidQaToolCatalog(
  catalog: readonly QaToolDescriptor[],
): void {
  const seen = new Set<string>();
  for (const descriptor of catalog) {
    const name = descriptor.definition.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("QA tool catalog contains a tool without a name");
    }
    if (seen.has(name)) {
      throw new Error(`QA tool catalog contains duplicate tool name "${name}"`);
    }
    seen.add(name);
  }
}
