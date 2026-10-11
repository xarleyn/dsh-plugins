import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { scopeOf } from "@deepseek-ai/dsh-scope";
import type { Context } from "@deepseek-ai/cordis";
import {
  requireDocumentScope,
  renderFiles,
  toolFiles,
  toolWarnings,
  workspacePathName,
  type DocumentToolExec,
  type DocumentToolOptions,
} from "../documents/tools/shared.js";
import { calculateCommercial } from "./pricing.js";
import type { DocumentWorkflowService, WorkflowUpdate } from "./service.js";
import type { CommercialLine, DocumentWorkflowView } from "./types.js";
import { WORKFLOW_UPDATE_PROPERTIES } from "./update-schema.js";

export const DOCUMENT_WORKFLOW_TOOL_NAMES = [
  "document_workflow_start",
  "document_workflow_read",
  "document_workflow_update",
  "document_workflow_draft",
  "document_workflow_review",
  "document_workflow_export",
  "document_calculate",
] as const;
type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
function wire(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function readableQuestionData(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function humanContext(exec: DocumentToolExec): string {
  const session = exec.agent?.session as unknown as
    | {
        surface?: { nodes: readonly number[] };
        eventAt?: (seq: number) => { type: string; data: unknown } | undefined;
        snapshotEvents?: () => readonly { type: string; data: unknown }[];
      }
    | undefined;
  const lines: string[] = [];
  const events = session?.snapshotEvents?.() ?? [];
  const summaries = new Map<string, readonly number[]>();
  for (const event of events) {
    if (event.type !== "compaction/summary") continue;
    const data = event.data as {
      compactionId?: unknown;
      shadowedSeqs?: unknown;
    };
    if (
      typeof data.compactionId === "string" &&
      Array.isArray(data.shadowedSeqs)
    )
      summaries.set(
        data.compactionId,
        data.shadowedSeqs.filter(
          (seq): seq is number =>
            typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0,
        ),
      );
  }
  // Expand only checkpoints represented on the current surface. Withdrawn
  // messages are not revived, and model-authored summaries are never human evidence.
  const nodes = new Set(session?.surface?.nodes ?? []);
  const pending = [...nodes];
  for (let index = 0; index < pending.length; index++) {
    const event = session?.eventAt?.(pending[index]!);
    if (event?.type !== "user/message") continue;
    const source = (
      event.data as { source?: { kind?: string; compactionId?: string } }
    ).source;
    if (
      source?.kind !== "compact-checkpoint" ||
      source.compactionId === undefined
    )
      continue;
    for (const seq of summaries.get(source.compactionId) ?? []) {
      if (nodes.has(seq)) continue;
      nodes.add(seq);
      pending.push(seq);
    }
  }
  for (const seq of [...nodes].sort((a, b) => a - b)) {
    const event = session?.eventAt?.(seq);
    if (event?.type !== "user/message") continue;
    const data = event.data as {
      source?: { kind?: string };
      content?: readonly { type: string; text?: string }[];
    };
    if (data.source?.kind !== "user") continue;
    lines.push(
      `Human message ${seq}: ${(data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")}`,
    );
  }
  const questions = new Map<string, string>();
  for (const event of events) {
    const data = event.data as {
      name?: string;
      callId?: string;
      arguments?: string;
      message?: {
        toolCallId?: string;
        isError?: boolean;
        content?: readonly { type: string; text?: string }[];
      };
    };
    if (
      event.type === "tool/call" &&
      data.name === "ask_user_question" &&
      data.callId !== undefined
    )
      questions.set(data.callId, data.arguments ?? "");
    const message = data.message;
    if (
      event.type === "tool/result" &&
      message?.toolCallId !== undefined &&
      message.isError !== true &&
      questions.has(message.toolCallId)
    ) {
      lines.push(
        `Human question form:\n${readableQuestionData(questions.get(message.toolCallId)!)}\nRecorded human answer:\n${readableQuestionData(
          (message.content ?? [])
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("\n"),
        )}`,
      );
    }
  }
  const complete = lines.join("\n\n");
  return complete.length > 60_000
    ? `[Earlier human messages omitted; any decision depending on them must be treated as unverified]\n${complete.slice(-60_000)}`
    : complete;
}

function primaryTools(exec: DocumentToolExec): readonly string[] | undefined {
  const agent = exec.agent as unknown as
    | {
        ctx?: {
          tools?: { schemas(scope: unknown): readonly { name: string }[] };
        };
      }
    | undefined;
  const registry = agent?.ctx?.tools;
  return registry === undefined
    ? undefined
    : [
        ...new Set(
          registry
            .schemas(
              agent?.ctx === undefined
                ? exec.agent
                : (scopeOf(agent.ctx as unknown as Context) ?? exec.agent),
            )
            .map((schema) => schema.name),
        ),
      ].sort();
}

function renderView(value: unknown): { type: "text"; text: string }[] {
  const view = value as DocumentWorkflowView;
  const bounded = {
    ...view,
    markdown: view.markdown?.slice(0, 12_000),
    templateContent: view.templateContent?.slice(0, 12_000),
  };
  return [
    {
      type: "text",
      text: [
        `workflow: ${view.id}`,
        `revision: ${view.revision}`,
        `status: ${view.status}`,
        ...(view.draft?.review === undefined
          ? []
          : [
              `review-verdict: ${view.draft.review.verdict}`,
              ...(view.draft.review.verdict === "revise"
                ? [
                    "REVIEW DID NOT PASS. Human approval and final export are unavailable. A positive summary does not override this verdict. Resolve or explicitly disclose every review issue in the full draft, save a new revision and review it again. Do not tell the user this revision is ready for approval.",
                    ...view.draft.review.issues.map(
                      (issue) => `blocking-review-issue: ${issue}`,
                    ),
                  ]
                : [
                    "Review passed for this revision. The human must still approve this exact draft through QA before final export.",
                  ]),
            ]),
        `For the next write, copy revision ${view.revision} exactly. Do not increment it yourself; each successful write returns the new current revision.`,
        ...(view.draft === undefined
          ? []
          : [
              `markdown: ${view.draft.path}`,
              `draft-sha256: ${view.draft.sha256}`,
            ]),
        JSON.stringify(bounded, null, 2),
        "Update facts with their exact keys. For proposals, pricingDecision.value must be exactly priced or unpriced; put the customer's explanation in evidence.quote. unresolved contains blocking questions only: use [] when they have been resolved or explicitly accepted as documented limitations. Capability evidence needs productVersion equal to this workflow's version.",
        "facts and requirements are arrays of objects, never keyed dictionaries. For specifications and unpriced proposals, omit commercial; never send commercial:{value:unpriced}. A specification does not require a pricingDecision fact.",
        "To revise a saved draft, pass the complete new Markdown to document_workflow_draft. Do not edit or overwrite its saved file directly: that invalidates its recorded hash.",
        ...(view.markdown !== undefined && view.markdown.length > 12_000
          ? [
              "Draft preview is incomplete. Read the saved Markdown file to inspect the rest; review uses the full draft.",
            ]
          : []),
        "A reviewed draft needs the user's approval action in QA before final export. Do not claim approval from a tool argument or your own interpretation of prose.",
      ].join("\n"),
    },
  ];
}

export function createWorkflowTools(
  options: DocumentToolOptions,
  workflows: DocumentWorkflowService,
): ToolDefinition[] {
  const common = {
    workflowId: {
      type: "string" as const,
      required: true as const,
      description:
        "Workflow id returned by document_workflow_start; valid only in this session.",
    },
    revision: {
      type: "number" as const,
      required: true as const,
      description:
        "Copy the current revision returned by the most recent successful operation exactly. Do not add 1. The service increments it after a successful write; stale writes and approvals are refused.",
    },
  };
  const output = {
    schema: { type: "object" as const, additionalProperties: true as const },
    render: (_args: unknown, value: unknown) => renderView(value),
  };
  return [
    defineTool({
      name: "document_workflow_start",
      description:
        "Start a grounded customer-specific proposal or specification. Load grounded-documents for the workflow instructions. Use this workflow for ТКП/ТЗ instead of going directly to document_create. It returns the registered content template and missing required facts. Product capabilities, prices and user approval must never be invented.",
      parameters: {
        kind: {
          type: "string",
          required: true,
          enum: ["proposal", "specification"] as const,
        },
        template: {
          type: "string",
          required: true,
          description: "Registered template name, never a DOCX path.",
        },
        productVersion: { type: "string", required: true },
        request: {
          type: "string",
          required: true,
          description:
            "Accumulated original customer requirements and desired document.",
        },
      },
      output,
      execute: async (args, exec) =>
        workflows
          .start(
            requireDocumentScope(exec, options),
            args as unknown as Parameters<DocumentWorkflowService["start"]>[1],
          )
          .then(wire),
    }),
    defineTool({
      name: "document_workflow_read",
      description:
        "Recover the persisted requirements, facts, open questions and current draft after an interruption; continue the same workflow instead of asking answered questions again.",
      parameters: { workflowId: common.workflowId },
      output,
      execute: async (args, exec) =>
        workflows
          .read(requireDocumentScope(exec, options), String(args["workflowId"]))
          .then(wire),
    }),
    defineTool({
      name: "document_workflow_update",
      description:
        "Save accumulated confirmed facts, requirement coverage, excluded modules and unresolved questions. This invalidates the old draft/review/approval. Each fact needs source and quote; each capability needs versioned product evidence. Customer requests do not prove product functionality. Use unresolved items for missing commercial decisions; screenshot insertion notes are allowed.",
      parameters: {
        ...common,
        data: {
          type: "object",
          required: true,
          additionalProperties: false,
          properties: WORKFLOW_UPDATE_PROPERTIES,
          description:
            "Complete replacement: facts[{key,value,evidence:{source,quote,productVersion?}}], requirements[{id,text,coverage:full|partial|none|unclear,modules:[],evidence:[],limitationDecision?}], excludedModules:[], scopeDepth:minimal|extended, unresolved:[], optional commercial:{currency,lines:[{sku,title,quantity,unitPrice,quantitySource,priceSource}]}. Required fact keys come from the template. pricingDecision.value is exactly priced or unpriced. Each capability evidence item needs productVersion equal to the workflow version. limitationDecision uses {source,quote}; partial/none coverage needs explicit human acceptance. unclear coverage still blocks final review. unresolved lists blocking questions only; use [] when resolved/accepted, never an empty string item. Decimal values are strings. Never invent missing prices.",
        },
      },
      output,
      execute: async (args, exec) =>
        workflows
          .update(
            requireDocumentScope(exec, options),
            String(args["workflowId"]),
            {
              ...(args["data"] as unknown as Omit<WorkflowUpdate, "revision">),
              revision: Number(args["revision"]),
            },
          )
          .then(wire),
    }),
    defineTool({
      name: "document_workflow_draft",
      description:
        "Save the complete customer-specific Markdown as a new revision for review. Follow the registered template, include only necessary supported capabilities and explain limitations. Incomplete drafts may be saved, but cannot be reviewed/approved/exported as final. Use plain screenshot insertion notes, not invented screenshots.",
      parameters: { ...common, markdown: { type: "string", required: true } },
      output,
      execute: async (args, exec) =>
        workflows
          .draft(
            requireDocumentScope(exec, options),
            String(args["workflowId"]),
            Number(args["revision"]),
            String(args["markdown"]),
          )
          .then(wire),
    }),
    defineTool({
      name: "document_workflow_review",
      description:
        "Independently review the full draft, accumulated requirements, sources, module exclusions, prices and actual human messages. Only a PASS for this exact revision permits user approval. Missing sources or a failed reviewer cannot approve a document.",
      parameters: common,
      output,
      timeoutMs: 600_000,
      execute: async (args, exec) =>
        workflows
          .review(
            requireDocumentScope(exec, options),
            String(args["workflowId"]),
            Number(args["revision"]),
            humanContext(exec),
            primaryTools(exec),
          )
          .then(wire),
    }),
    defineTool({
      name: "document_workflow_export",
      description:
        "Export the exact reviewed and human-approved revision as DOCX/PDF. Required facts, product evidence and commercial decisions must be complete. User approval is a trusted QA action; this tool cannot grant it. Never substitute document_create to bypass refused proposal/specification finalisation.",
      parameters: {
        ...common,
        formats: {
          type: "array",
          required: true,
          items: { type: "string", enum: ["docx", "pdf"] as const },
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => {
          const result = value as unknown as {
            files: Parameters<typeof renderFiles>[0];
            source?: { path: string };
            manifestPath: string;
          };
          return [
            {
              type: "text" as const,
              text: [
                ...renderFiles(result.files),
                ...(result.source === undefined
                  ? []
                  : [`source: ${result.source.path}`]),
                `manifest: ${result.manifestPath}`,
              ].join("\n"),
            },
          ];
        },
      },
      timeoutMs: 300_000,
      execute: async (args, exec) => {
        const scope = requireDocumentScope(exec, options);
        const result = await workflows.export(
          scope,
          String(args["workflowId"]),
          Number(args["revision"]),
          args["formats"] as ("docx" | "pdf")[],
        );
        return wire({
          ...result,
          warnings: toolWarnings(result.warnings),
          files: await toolFiles(result.files, scope.workspaceRoot),
          ...(result.source === undefined
            ? {}
            : {
                source: {
                  ...result.source,
                  path: await workspacePathName(
                    scope.workspaceRoot,
                    result.source.path,
                  ),
                },
              }),
          manifestPath: await workspacePathName(
            scope.workspaceRoot,
            result.manifestPath,
          ),
        });
      },
    }),
    defineTool({
      name: "document_calculate",
      description:
        "Calculate exact proposal line totals from already verified quantities and unit prices. Decimal strings, half-up per line to two decimals; no prices or tax rules are discovered or inferred. Record priceSource and quantitySource for every SKU.",
      parameters: {
        currency: { type: "string", required: true },
        lines: {
          type: "array",
          required: true,
          items: { type: "object", additionalProperties: true },
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [
          { type: "text" as const, text: JSON.stringify(value, null, 2) },
        ],
      },
      execute: async (args) =>
        wire(
          calculateCommercial(
            args["lines"] as unknown as CommercialLine[],
            String(args["currency"]),
          ),
        ),
    }),
  ];
}
