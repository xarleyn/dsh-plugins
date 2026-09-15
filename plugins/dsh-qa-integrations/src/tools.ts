import { defineTool, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import { IntegrationError } from "./errors.js";
import type { IntegrationBroker } from "./broker.js";
import type { IntegrationPrincipal } from "./types.js";

type ToolExecution = Pick<ToolRunContext, "agent">;

export const INTEGRATION_TOOL_NAMES = [
  "bitrix_search_crm",
  "bitrix_get_crm_item",
  "bitrix_search_chats",
  "bitrix_get_chat_messages",
] as const;

function requireSession(exec: ToolExecution): string {
  const id = exec.agent?.session?.header?.id;
  if (id === undefined || String(id).trim() === "") {
    throw new IntegrationError(
      "PrincipalNotResolved",
      "QA principal is required",
    );
  }
  return String(id);
}

function integer(
  value: unknown,
  field: string,
  min = 1,
  max = 2_147_483_647,
): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new IntegrationError("InvalidRequest", `${field} is invalid`);
  }
  return Number(value);
}

function text(value: unknown, field: string, min: number, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length < min || normalized.length > max) {
    throw new IntegrationError("InvalidRequest", `${field} is invalid`);
  }
  return normalized;
}

const OUTPUT = {
  schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      provider: { type: "string" as const, required: true },
      operation: { type: "string" as const, required: true },
      data: {
        type: "object" as const,
        required: true,
        additionalProperties: true,
      },
    },
  },
  render: (
    _args: unknown,
    value: { provider: string; operation: string; data: object },
  ) => [{ type: "text" as const, text: JSON.stringify(value.data) }],
} as const;

export function createIntegrationTools(options: {
  readonly broker: IntegrationBroker;
  readonly principalForSession: (
    sessionId: string,
  ) => IntegrationPrincipal | undefined;
}) {
  const execute = async (
    exec: ToolExecution,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ) => {
    const sessionId = requireSession(exec);
    const principal = options.principalForSession(sessionId);
    if (principal === undefined) {
      throw new IntegrationError(
        "PrincipalNotResolved",
        "Session is not bound to a QA user",
      );
    }
    return options.broker.call(principal, {
      provider: "bitrix24",
      operation,
      input,
      sourceSessionId: sessionId,
    });
  };
  return [
    defineTool({
      name: "bitrix_search_crm",
      description:
        "Search CRM items visible to the current QA user's connected Bitrix24 account. Read-only.",
      parameters: {
        entityTypeId: {
          type: "number",
          required: true,
          description: "Bitrix CRM entity type id.",
        },
        query: {
          type: "string",
          description: "Optional title search text, up to 200 characters.",
        },
      },
      output: OUTPUT,
      execute: (args, exec) =>
        execute(exec, "crm.search", {
          entityTypeId: integer(args["entityTypeId"], "entityTypeId"),
          query:
            args["query"] === undefined
              ? ""
              : text(args["query"], "query", 1, 200),
        }),
    }),
    defineTool({
      name: "bitrix_get_crm_item",
      description:
        "Read one CRM item visible to the current QA user's connected Bitrix24 account. Read-only.",
      parameters: {
        entityTypeId: { type: "number", required: true },
        id: { type: "number", required: true },
      },
      output: OUTPUT,
      execute: (args, exec) =>
        execute(exec, "crm.get", {
          entityTypeId: integer(args["entityTypeId"], "entityTypeId"),
          id: integer(args["id"], "id"),
        }),
    }),
    defineTool({
      name: "bitrix_search_chats",
      description:
        "Search chats visible to the current QA user's connected Bitrix24 account. Read-only.",
      parameters: {
        query: {
          type: "string",
          required: true,
          description: "At least two characters.",
        },
        limit: { type: "number", description: "1-50; defaults to 10." },
      },
      output: OUTPUT,
      execute: (args, exec) =>
        execute(exec, "chat.search", {
          query: text(args["query"], "query", 2, 200),
          limit:
            args["limit"] === undefined
              ? 10
              : integer(args["limit"], "limit", 1, 50),
        }),
    }),
    defineTool({
      name: "bitrix_get_chat_messages",
      description:
        "Read recent messages from a chat visible to the current QA user's connected Bitrix24 account. Read-only.",
      parameters: {
        dialogId: {
          type: "string",
          required: true,
          description: "Bitrix dialog id such as chat1489.",
        },
        limit: { type: "number", description: "1-50; defaults to 20." },
        lastId: {
          type: "number",
          description: "Load messages older than this id.",
        },
      },
      output: OUTPUT,
      execute: (args, exec) =>
        execute(exec, "chat.messages", {
          dialogId: text(args["dialogId"], "dialogId", 1, 80),
          limit:
            args["limit"] === undefined
              ? 20
              : integer(args["limit"], "limit", 1, 50),
          ...(args["lastId"] === undefined
            ? {}
            : { lastId: integer(args["lastId"], "lastId") }),
        }),
    }),
  ];
}
