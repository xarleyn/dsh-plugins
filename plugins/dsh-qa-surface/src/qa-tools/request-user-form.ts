import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import type { QaFormGate } from "../forms/gate.js";

/** Build only; the QA activation manager owns registration and role admission. */
export function createRequestUserFormTool(
  gate: QaFormGate,
  project?: (
    submission: import("../forms/types.js").QaFormSubmission,
  ) => Promise<unknown>,
): ToolDefinition {
  return defineTool({
    name: "request_user_form",
    description:
      "Collect required answers and item-bound files through a durable step-by-step QA form. create requires request_key and form; resume requires form_id. Only status=submitted with submission_id is completed input. Pauses and cancellation are not success. Resume existing drafts instead of weakening requirements. Only the main QA agent can use this tool.",
    parameters: {
      action: { type: "string", enum: ["create", "resume"], required: true },
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
                          },
                          min_count: { type: "integer" },
                          max_count: { type: "integer" },
                          accept: { type: "array", items: { type: "string" } },
                          max_file_size_bytes: { type: "integer" },
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
          ? await project(outcome)
          : outcome;
      exec.signal.throwIfAborted();
      return z.json().parse(result);
    },
  });
}
