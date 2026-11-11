import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import type { QaFormGate } from "../forms/gate.js";

/** Build only; the QA activation manager owns registration and role admission. */
export function createRequestUserFormTool(
  gate: QaFormGate,
  project?: (
    submission: import("../forms/types.js").QaFormSubmission,
    sessionId: string,
  ) => Promise<unknown>,
): ToolDefinition {
  return defineTool({
    name: "request_user_form",
    description:
      'Collect answers and item-bound files through a durable step-by-step QA form. First use action=validate with form to check the schema without creating a form or waiting for input. create requires request_key and form; resume requires form_id. Always include form.title as well as step/item titles. Files accept extensions such as [".pdf", ".txt"], never MIME types. Only status=submitted with submission_id is completed input. A submitted form is immutable: resume returns its original snapshot; use a new request_key for new input. Pauses and cancellation are not success. Resume existing drafts instead of weakening requirements. Only the main QA agent can use this tool.',
    parameters: {
      action: {
        type: "string",
        enum: ["create", "resume", "validate"],
        required: true,
      },
      request_key: {
        type: "string",
        description:
          "Stable creation identity within this chat. Required for create.",
      },
      form_id: {
        type: "string",
        description: "Existing form identity. Required for resume.",
      },
      form: {
        type: "object",
        description:
          "Required for create and validate. Include schema_version=1, a nonempty root title, and steps. validate reports schema issues and current capabilities without collecting answers.",
        additionalProperties: false,
        properties: {
          schema_version: { type: "integer", const: 1, required: true },
          title: { type: "string", required: true },
          description: { type: "string" },
          submit_label: { type: "string" },
          steps: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                title: { type: "string", required: true },
                description: { type: "string" },
                items: {
                  type: "array",
                  required: true,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string", required: true },
                      title: { type: "string", required: true },
                      description: { type: "string" },
                      answer: {
                        type: "object",
                        description:
                          "Optional for a file-only item with files.requirement=optional or required. Required when files.requirement=none.",
                        additionalProperties: false,
                        properties: {
                          type: {
                            type: "string",
                            required: true,
                            enum: [
                              "text",
                              "textarea",
                              "single_select",
                              "multi_select",
                            ],
                          },
                          required: { type: "boolean", required: true },
                          placeholder: { type: "string" },
                          min_length: { type: "integer" },
                          max_length: { type: "integer" },
                          allow_other: { type: "boolean" },
                          min_selected: { type: "integer" },
                          max_selected: { type: "integer" },
                          options: {
                            type: "array",
                            items: {
                              type: "object",
                              additionalProperties: false,
                              properties: {
                                value: { type: "string", required: true },
                                label: { type: "string", required: true },
                                description: { type: "string" },
                                recommended: { type: "boolean" },
                              },
                            },
                          },
                        },
                      },
                      files: {
                        type: "object",
                        required: true,
                        additionalProperties: false,
                        properties: {
                          requirement: {
                            type: "string",
                            required: true,
                            enum: ["none", "required", "optional"],
                            description:
                              "none allows no other file settings. optional requires max_count, accept and max_file_size_bytes; omit min_count. required additionally requires positive min_count.",
                          },
                          min_count: {
                            type: "integer",
                            description:
                              "Positive minimum for required files only; omit for optional and none, including zero.",
                          },
                          max_count: {
                            type: "integer",
                            description:
                              "Positive maximum, required for optional and required files.",
                          },
                          accept: {
                            type: "array",
                            items: { type: "string" },
                            description:
                              'Required for optional/required files. Use lowercase extensions, e.g. [".pdf", ".txt"]. MIME types, wildcards, .md and .log are unsupported. validate returns the deployment allowedExtensions policy.',
                          },
                          max_file_size_bytes: {
                            type: "integer",
                            description:
                              "Positive byte limit, required for optional and required files.",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    execute: async (args, exec) => {
      const outcome = await gate.request(args, exec);
      const result =
        outcome.status === "submitted" && project
          ? await project(outcome, String(exec.agent?.session.id ?? ""))
          : outcome;
      exec.signal.throwIfAborted();
      return z.json().parse(result);
    },
  });
}
