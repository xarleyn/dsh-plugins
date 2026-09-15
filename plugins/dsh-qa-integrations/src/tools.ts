import {
  defineTool,
  type ParameterSchemaSpec,
  type ToolDefinition,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  optionalBoolean,
  optionalDate,
  optionalInteger,
  requiredDate,
  requiredInteger,
  requiredIntegerList,
  requiredStringList,
  requiredText,
} from "./coerce.js";
import { IntegrationError } from "./errors.js";
import type { IntegrationBroker } from "./broker.js";
import type { IntegrationPrincipal } from "./types.js";

type ToolExecution = Pick<ToolRunContext, "agent">;

export const INTEGRATION_TOOL_NAMES = [
  "bitrix_search_crm",
  "bitrix_get_crm_item",
  "bitrix_get_crm_fields",
  "bitrix_get_crm_funnels",
  "bitrix_get_crm_statuses",
  "bitrix_get_crm_activities",
  "bitrix_get_crm_activity",
  "bitrix_get_crm_timeline",
  "bitrix_get_crm_stage_history",
  "bitrix_get_crm_product_rows",
  "bitrix_find_crm_duplicates",
  "bitrix_get_current_user",
  "bitrix_search_users",
  "bitrix_get_departments",
  "bitrix_search_chats",
  "bitrix_get_chat_messages",
  "bitrix_search_chat_messages",
  "bitrix_get_recent_chats",
  "bitrix_search_chat_users",
  "bitrix_get_openline_dialog",
  "bitrix_get_openline_history",
  "bitrix_search_tasks",
  "bitrix_get_task",
  "bitrix_get_calendar_events",
  "bitrix_get_calendar_accessibility",
  "bitrix_search_files",
  "bitrix_get_file",
] as const;

const ENTITY_TYPE_HINT =
  "Bitrix CRM entity type: 1 lead, 2 deal, 3 contact, 4 company, 31 invoice, or a smart-process type id.";

const DIALOG_ID_HINT =
  'Bitrix dialog id such as "chat1489"; some methods also accept a bare numeric chat id.';

const DATE_HINT = "Date in YYYY-MM-DD form.";

const START_HINT =
  "Pagination offset; Bitrix returns at most 50 items per page and the answer carries the next offset.";

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

export function createIntegrationTools(options: {
  readonly broker: IntegrationBroker;
  readonly principalForSession: (
    sessionId: string,
  ) => IntegrationPrincipal | undefined;
}): readonly ToolDefinition[] {
  const run = async (
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

  /**
   * Every Bitrix24 tool is one catalog operation with a validated, read-only
   * argument set. No tool accepts a user, credential, integration or tenant
   * selector: the broker resolves the principal from the DSH session.
   */
  const tool = <const S extends ParameterSchemaSpec>(definition: {
    readonly name: string;
    readonly description: string;
    readonly parameters: S;
    readonly operation: string;
    readonly input: (args: Record<string, unknown>) => Record<string, unknown>;
  }): ToolDefinition =>
    defineTool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      output: OUTPUT,
      execute: (args, exec) =>
        run(
          exec,
          definition.operation,
          definition.input(args as Record<string, unknown>),
        ),
    });

  return [
    tool({
      name: "bitrix_search_crm",
      description:
        "Search CRM items (leads, deals, contacts, companies, invoices, smart processes) visible to the connected Bitrix24 account. Read-only; returns id, title and assignment, use bitrix_get_crm_item for full fields.",
      parameters: {
        entityTypeId: {
          type: "number",
          required: true,
          description: ENTITY_TYPE_HINT,
        },
        query: {
          type: "string",
          description:
            "Optional case-insensitive substring of the item title, up to 200 characters.",
        },
        assignedToMe: {
          type: "boolean",
          description:
            "Only items assigned to the connected Bitrix24 user. Useful for 'my deals'.",
        },
        start: { type: "number", description: START_HINT },
      },
      operation: "crm.search",
      input: (args) => ({
        entityTypeId: requiredInteger(args["entityTypeId"], "entityTypeId"),
        ...(args["query"] === undefined
          ? {}
          : { query: requiredText(args["query"], "query", 1, 200) }),
        ...(args["assignedToMe"] === undefined
          ? {}
          : {
              assignedToMe: optionalBoolean(
                args["assignedToMe"],
                "assignedToMe",
              ),
            }),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_get_crm_item",
      description:
        "Read one CRM item by id, including its custom fields and communication data (phone, e-mail, IM). Read-only.",
      parameters: {
        entityTypeId: {
          type: "number",
          required: true,
          description: ENTITY_TYPE_HINT,
        },
        id: {
          type: "number",
          required: true,
          description: "CRM item id.",
        },
      },
      operation: "crm.get",
      input: (args) => ({
        entityTypeId: requiredInteger(args["entityTypeId"], "entityTypeId"),
        id: requiredInteger(args["id"], "id"),
      }),
    }),

    tool({
      name: "bitrix_get_crm_fields",
      description:
        "Describe the fields of a CRM entity type, including the portal's custom UF_CRM_* fields. Call this before answering questions about fields you have not seen. Read-only.",
      parameters: {
        entityTypeId: {
          type: "number",
          required: true,
          description: ENTITY_TYPE_HINT,
        },
        originalUfNames: {
          type: "boolean",
          description:
            "Return custom field names as stored (UF_CRM_2_1639...) instead of camelCase.",
        },
      },
      operation: "crm.fields",
      input: (args) => ({
        entityTypeId: requiredInteger(args["entityTypeId"], "entityTypeId"),
        ...(args["originalUfNames"] === undefined
          ? {}
          : {
              originalUfNames: optionalBoolean(
                args["originalUfNames"],
                "originalUfNames",
              ),
            }),
      }),
    }),

    tool({
      name: "bitrix_get_crm_funnels",
      description:
        "List the sales funnels (categories) of a CRM entity type. Read-only.",
      parameters: {
        entityTypeId: {
          type: "number",
          required: true,
          description: ENTITY_TYPE_HINT,
        },
      },
      operation: "crm.funnels",
      input: (args) => ({
        entityTypeId: requiredInteger(args["entityTypeId"], "entityTypeId"),
      }),
    }),

    tool({
      name: "bitrix_get_crm_statuses",
      description:
        'Decode CRM stage and dictionary ids into names. Read-only. entityId is a Bitrix status dictionary: "STATUS" for lead stages, "DEAL_STAGE" for the default deal funnel, "DEAL_STAGE_<categoryId>" for another funnel (see bitrix_get_crm_funnels), plus dictionaries such as SOURCE, INDUSTRY, DEAL_TYPE.',
      parameters: {
        entityId: {
          type: "string",
          required: true,
          description:
            "Status dictionary id, for example STATUS or DEAL_STAGE_1.",
        },
      },
      operation: "crm.statuses",
      input: (args) => ({
        entityId: requiredText(args["entityId"], "entityId", 1, 64),
      }),
    }),

    tool({
      name: "bitrix_get_crm_activities",
      description:
        "List CRM activities (calls, meetings, e-mails, tasks) with deadline and completion state. Read-only; use bitrix_get_crm_activity for one activity's full description or call transcript. Dates are served by Bitrix without a timezone guarantee.",
      parameters: {
        entityTypeId: {
          type: "number",
          description: `Optional owner filter. ${ENTITY_TYPE_HINT}`,
        },
        entityId: {
          type: "number",
          description:
            "Optional owner id; combine with entityTypeId to read one deal's or lead's activities.",
        },
        assignedToMe: {
          type: "boolean",
          description: "Only activities of the connected Bitrix24 user.",
        },
        openOnly: {
          type: "boolean",
          description: "Only unfinished activities.",
        },
        deadlineTo: {
          type: "string",
          description: `Only activities due on or before this date. ${DATE_HINT}`,
        },
        start: { type: "number", description: START_HINT },
      },
      operation: "crm.activities",
      input: (args) => ({
        ...(args["entityTypeId"] === undefined
          ? {}
          : {
              entityTypeId: optionalInteger(
                args["entityTypeId"],
                "entityTypeId",
              ),
            }),
        ...(args["entityId"] === undefined
          ? {}
          : { entityId: optionalInteger(args["entityId"], "entityId") }),
        ...(args["assignedToMe"] === undefined
          ? {}
          : {
              assignedToMe: optionalBoolean(
                args["assignedToMe"],
                "assignedToMe",
              ),
            }),
        ...(args["openOnly"] === undefined
          ? {}
          : { openOnly: optionalBoolean(args["openOnly"], "openOnly") }),
        ...(args["deadlineTo"] === undefined
          ? {}
          : { deadlineTo: optionalDate(args["deadlineTo"], "deadlineTo") }),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_get_crm_activity",
      description:
        "Read one CRM activity in full, including its description and provider data. Read-only.",
      parameters: {
        id: {
          type: "number",
          required: true,
          description: "Activity id from bitrix_get_crm_activities.",
        },
      },
      operation: "crm.activity",
      input: (args) => ({ id: requiredInteger(args["id"], "id") }),
    }),

    tool({
      name: "bitrix_get_crm_timeline",
      description:
        "Read the timeline comments (manager notes) of a lead, deal, contact or company. Read-only.",
      parameters: {
        entityTypeId: {
          type: "number",
          required: true,
          description:
            "Timeline entity type: 1 lead, 2 deal, 3 contact, 4 company.",
        },
        entityId: {
          type: "number",
          required: true,
          description: "CRM item id.",
        },
        start: { type: "number", description: START_HINT },
      },
      operation: "crm.timeline",
      input: (args) => ({
        entityTypeId: requiredInteger(args["entityTypeId"], "entityTypeId"),
        entityId: requiredInteger(args["entityId"], "entityId"),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_get_crm_stage_history",
      description:
        "Read how a CRM item moved through the funnel: stage changes with timestamps. Read-only. Answers 'how long has it been on this stage' and 'where was it returned from'.",
      parameters: {
        entityTypeId: {
          type: "number",
          required: true,
          description: ENTITY_TYPE_HINT,
        },
        entityId: {
          type: "number",
          description:
            "Optional CRM item id; without it the portal returns its own paged slice.",
        },
        start: { type: "number", description: START_HINT },
      },
      operation: "crm.stageHistory",
      input: (args) => ({
        entityTypeId: requiredInteger(args["entityTypeId"], "entityTypeId"),
        ...(args["entityId"] === undefined
          ? {}
          : { entityId: optionalInteger(args["entityId"], "entityId") }),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_get_crm_product_rows",
      description:
        "List the product rows of a CRM item: what is being sold, quantity, price and discounts. Read-only.",
      parameters: {
        ownerType: {
          type: "string",
          required: true,
          description:
            'Owner type code from the CRM object types reference, for example "D" for a deal.',
        },
        ownerId: {
          type: "number",
          required: true,
          description: "CRM item id.",
        },
        start: { type: "number", description: START_HINT },
      },
      operation: "crm.productRows",
      input: (args) => ({
        ownerType: requiredText(args["ownerType"], "ownerType", 1, 8),
        ownerId: requiredInteger(args["ownerId"], "ownerId"),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_find_crm_duplicates",
      description:
        "Find CRM leads, contacts and companies that share a phone number or e-mail. Read-only; at most 20 values per call.",
      parameters: {
        type: {
          type: "string",
          enum: ["PHONE", "EMAIL"],
          required: true,
          description: "What the values are.",
        },
        values: {
          type: "array",
          items: { type: "string" },
          required: true,
          description: "Up to 20 phone numbers or e-mail addresses.",
        },
        entityType: {
          type: "string",
          enum: ["LEAD", "CONTACT", "COMPANY"],
          description: "Restrict the search to one entity type.",
        },
      },
      operation: "crm.duplicates",
      input: (args) => ({
        type: requiredText(args["type"], "type", 4, 5),
        values: requiredStringList(args["values"], "values", 20, 320),
        ...(args["entityType"] === undefined
          ? {}
          : {
              entityType: requiredText(args["entityType"], "entityType", 4, 8),
            }),
      }),
    }),

    tool({
      name: "bitrix_get_current_user",
      description:
        "Identify the Bitrix24 user this connection belongs to. Read-only.",
      parameters: {},
      operation: "user.current",
      input: () => ({}),
    }),

    tool({
      name: "bitrix_search_users",
      description:
        "Find Bitrix24 employees by name, e-mail or department. Read-only. Use it to turn an assignedById from a CRM item into a person. Returned fields depend on the webhook's user scope.",
      parameters: {
        query: {
          type: "string",
          description: "Name search phrase, at least 2 characters.",
        },
        email: {
          type: "string",
          description: "Exact e-mail address.",
        },
        departmentId: {
          type: "number",
          description: "Only employees of this department.",
        },
        activeOnly: {
          type: "boolean",
          description: "Skip dismissed employees.",
        },
        start: { type: "number", description: START_HINT },
      },
      operation: "user.list",
      input: (args) => ({
        ...(args["query"] === undefined
          ? {}
          : { query: requiredText(args["query"], "query", 2, 120) }),
        ...(args["email"] === undefined
          ? {}
          : { email: requiredText(args["email"], "email", 3, 320) }),
        ...(args["departmentId"] === undefined
          ? {}
          : {
              departmentId: optionalInteger(
                args["departmentId"],
                "departmentId",
              ),
            }),
        ...(args["activeOnly"] === undefined
          ? {}
          : { activeOnly: optionalBoolean(args["activeOnly"], "activeOnly") }),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_get_departments",
      description:
        "List company departments with their parent department and head. Read-only; the first page covers up to 50 departments.",
      parameters: {
        parentId: {
          type: "number",
          description: "Only direct children of this department.",
        },
      },
      operation: "user.departments",
      input: (args) =>
        args["parentId"] === undefined
          ? {}
          : { parentId: optionalInteger(args["parentId"], "parentId") },
    }),

    tool({
      name: "bitrix_search_chats",
      description:
        "Search group chats and open-line dialogs by title and participant names. Read-only; returns chat objects whose entity_id may point at a CRM item.",
      parameters: {
        query: {
          type: "string",
          required: true,
          description: "At least two characters.",
        },
        limit: { type: "number", description: "1-50; defaults to 10." },
        start: {
          type: "number",
          description: "Offset of the first chat to return; defaults to 0.",
        },
      },
      operation: "chat.search",
      input: (args) => ({
        query: requiredText(args["query"], "query", 2, 200),
        ...(args["limit"] === undefined
          ? {}
          : { limit: optionalInteger(args["limit"], "limit", 1, 50) }),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_get_chat_messages",
      description:
        "Read recent messages of a chat by dialog id. Read-only. Page backwards by passing the id of the oldest message you already have as lastId.",
      parameters: {
        dialogId: {
          type: "string",
          required: true,
          description: DIALOG_ID_HINT,
        },
        limit: { type: "number", description: "1-50; defaults to 20." },
        lastId: {
          type: "number",
          description: "Return messages older than this message id.",
        },
      },
      operation: "chat.messages",
      input: (args) => ({
        dialogId: requiredText(args["dialogId"], "dialogId", 1, 80),
        ...(args["limit"] === undefined
          ? {}
          : { limit: optionalInteger(args["limit"], "limit", 1, 50) }),
        ...(args["lastId"] === undefined
          ? {}
          : { lastId: optionalInteger(args["lastId"], "lastId") }),
      }),
    }),

    tool({
      name: "bitrix_search_chat_messages",
      description:
        "Search inside one chat by text and date range. Read-only; answers 'what did the client write about X'.",
      parameters: {
        dialogId: {
          type: "string",
          required: true,
          description: DIALOG_ID_HINT,
        },
        query: {
          type: "string",
          description: "Text to look for, longer than two characters.",
        },
        dateFrom: { type: "string", description: DATE_HINT },
        dateTo: { type: "string", description: DATE_HINT },
        limit: { type: "number", description: "1-200; defaults to 30." },
        lastId: {
          type: "number",
          description: "Return messages older than this message id.",
        },
      },
      operation: "chat.messageSearch",
      input: (args) => ({
        dialogId: requiredText(args["dialogId"], "dialogId", 1, 80),
        ...(args["query"] === undefined
          ? {}
          : { query: requiredText(args["query"], "query", 2, 200) }),
        ...(args["dateFrom"] === undefined
          ? {}
          : { dateFrom: optionalDate(args["dateFrom"], "dateFrom") }),
        ...(args["dateTo"] === undefined
          ? {}
          : { dateTo: optionalDate(args["dateTo"], "dateTo") }),
        ...(args["limit"] === undefined
          ? {}
          : { limit: optionalInteger(args["limit"], "limit", 1, 200) }),
        ...(args["lastId"] === undefined
          ? {}
          : { lastId: optionalInteger(args["lastId"], "lastId") }),
      }),
    }),

    tool({
      name: "bitrix_get_recent_chats",
      description:
        "List the connected user's most recent dialogs with their last message and unread counter. Read-only; answers 'what is waiting for me in chats'.",
      parameters: {
        skipOpenlines: {
          type: "boolean",
          description: "Leave out open-line dialogs.",
        },
        onlyOpenlines: {
          type: "boolean",
          description: "Only open-line dialogs.",
        },
      },
      operation: "chat.recent",
      input: (args) => ({
        ...(args["skipOpenlines"] === undefined
          ? {}
          : {
              skipOpenlines: optionalBoolean(
                args["skipOpenlines"],
                "skipOpenlines",
              ),
            }),
        ...(args["onlyOpenlines"] === undefined
          ? {}
          : {
              onlyOpenlines: optionalBoolean(
                args["onlyOpenlines"],
                "onlyOpenlines",
              ),
            }),
      }),
    }),

    tool({
      name: "bitrix_search_chat_users",
      description:
        "Find employees as chat contacts, including their presence status and phone numbers. Read-only; the alternative to bitrix_search_users when contact details matter.",
      parameters: {
        query: {
          type: "string",
          required: true,
          description: "At least two characters.",
        },
        limit: { type: "number", description: "1-50; defaults to 10." },
        start: {
          type: "number",
          description: "Offset of the first contact to return; defaults to 0.",
        },
      },
      operation: "chat.users",
      input: (args) => ({
        query: requiredText(args["query"], "query", 2, 200),
        ...(args["limit"] === undefined
          ? {}
          : { limit: optionalInteger(args["limit"], "limit", 1, 50) }),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_get_openline_dialog",
      description:
        "Read one open-line (customer) dialog: participants, connector entity link, counters and permissions. Read-only. Pass a dialogId or a sessionId, at least one.",
      parameters: {
        dialogId: {
          type: "string",
          description: 'Open-line dialog id such as "chat29".',
        },
        sessionId: {
          type: "number",
          description:
            "Session id from bitrix_get_openline_history or bitrix_get_recent_chats.",
        },
      },
      operation: "openlines.dialog",
      input: (args) => ({
        ...(args["dialogId"] === undefined
          ? {}
          : { dialogId: requiredText(args["dialogId"], "dialogId", 1, 80) }),
        ...(args["sessionId"] === undefined
          ? {}
          : { sessionId: optionalInteger(args["sessionId"], "sessionId") }),
      }),
    }),

    tool({
      name: "bitrix_get_openline_history",
      description:
        "Read the whole message history of one open-line session with the customer, plus its participants and files. Read-only; pass a sessionId or a numeric chatId, at least one.",
      parameters: {
        sessionId: {
          type: "number",
          description: "Session id; more precise than chatId.",
        },
        chatId: {
          type: "number",
          description:
            "Numeric chat id without the chat prefix; the last session of that chat is used.",
        },
      },
      operation: "openlines.history",
      input: (args) => ({
        ...(args["sessionId"] === undefined
          ? {}
          : { sessionId: optionalInteger(args["sessionId"], "sessionId") }),
        ...(args["chatId"] === undefined
          ? {}
          : { chatId: optionalInteger(args["chatId"], "chatId") }),
      }),
    }),

    tool({
      name: "bitrix_search_tasks",
      description:
        "Search Bitrix24 tasks by title, responsible person, group and deadline. Read-only. Answers 'what is on me' and 'what is overdue'. Bitrix real status 5 means completed.",
      parameters: {
        query: {
          type: "string",
          description: "Substring of the task title.",
        },
        assignedToMe: {
          type: "boolean",
          description:
            "Only tasks whose responsible person is the connected user.",
        },
        createdByMe: {
          type: "boolean",
          description: "Only tasks created by the connected user.",
        },
        openOnly: {
          type: "boolean",
          description: "Skip completed tasks.",
        },
        groupId: {
          type: "number",
          description: "Only tasks of this workgroup or project.",
        },
        deadlineTo: {
          type: "string",
          description: `Only tasks due on or before this date. ${DATE_HINT}`,
        },
        start: { type: "number", description: START_HINT },
      },
      operation: "tasks.list",
      input: (args) => ({
        ...(args["query"] === undefined
          ? {}
          : { query: requiredText(args["query"], "query", 1, 200) }),
        ...(args["assignedToMe"] === undefined
          ? {}
          : {
              assignedToMe: optionalBoolean(
                args["assignedToMe"],
                "assignedToMe",
              ),
            }),
        ...(args["createdByMe"] === undefined
          ? {}
          : {
              createdByMe: optionalBoolean(args["createdByMe"], "createdByMe"),
            }),
        ...(args["openOnly"] === undefined
          ? {}
          : { openOnly: optionalBoolean(args["openOnly"], "openOnly") }),
        ...(args["groupId"] === undefined
          ? {}
          : { groupId: optionalInteger(args["groupId"], "groupId") }),
        ...(args["deadlineTo"] === undefined
          ? {}
          : { deadlineTo: optionalDate(args["deadlineTo"], "deadlineTo") }),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0) }),
      }),
    }),

    tool({
      name: "bitrix_get_task",
      description:
        "Read one task in full: description, creator, responsible person, dates, checklist and linked CRM items (ufCrmTask). Read-only.",
      parameters: {
        taskId: {
          type: "number",
          required: true,
          description: "Task id from bitrix_search_tasks.",
        },
      },
      operation: "tasks.get",
      input: (args) => ({ taskId: requiredInteger(args["taskId"], "taskId") }),
    }),

    tool({
      name: "bitrix_get_calendar_events",
      description:
        "List calendar events of a user, a workgroup or the company calendar for a date range, including attendees and CRM links. Read-only. Omit ownerId to read the connected user's own calendar.",
      parameters: {
        type: {
          type: "string",
          enum: ["user", "group", "company_calendar"],
          description: 'Calendar kind; defaults to "user".',
        },
        ownerId: {
          type: "number",
          description:
            "Calendar owner: a user id, a group id (required for type group) or 0 for the company calendar.",
        },
        from: {
          type: "string",
          description: `Range start; defaults to one month ago. ${DATE_HINT}`,
        },
        to: {
          type: "string",
          description: `Range end; defaults to three months ahead. ${DATE_HINT}`,
        },
      },
      operation: "calendar.events",
      input: (args) => ({
        ...(args["type"] === undefined
          ? {}
          : { type: requiredText(args["type"], "type", 4, 20) }),
        ...(args["ownerId"] === undefined
          ? {}
          : { ownerId: optionalInteger(args["ownerId"], "ownerId", 0) }),
        ...(args["from"] === undefined
          ? {}
          : { from: optionalDate(args["from"], "from") }),
        ...(args["to"] === undefined
          ? {}
          : { to: optionalDate(args["to"], "to") }),
      }),
    }),

    tool({
      name: "bitrix_get_calendar_accessibility",
      description:
        "Read when the given employees are busy or free, so a meeting can be proposed before creating it. Read-only.",
      parameters: {
        users: {
          type: "array",
          items: { type: "number" },
          required: true,
          description: "Bitrix user ids, up to 50.",
        },
        from: {
          type: "string",
          required: true,
          description: `Range start. ${DATE_HINT}`,
        },
        to: {
          type: "string",
          required: true,
          description: `Range end. ${DATE_HINT}`,
        },
      },
      operation: "calendar.accessibility",
      input: (args) => ({
        users: requiredIntegerList(args["users"], "users", 50),
        from: requiredDate(args["from"], "from"),
        to: requiredDate(args["to"], "to"),
      }),
    }),

    tool({
      name: "bitrix_search_files",
      description:
        "Search Bitrix24 Drive files and folders the connected user can read. Read-only; for documents the index also covers text inside the file, so this is full-text enterprise search.",
      parameters: {
        query: {
          type: "string",
          required: true,
          description: "Search phrase, 3 to 255 characters.",
        },
        type: {
          type: "string",
          enum: ["file", "folder", "all"],
          description: 'Object kind; defaults to "file".',
        },
        storageId: {
          type: "number",
          description: "Only inside this drive.",
        },
        folderId: {
          type: "number",
          description: "Only inside this folder and its subfolders.",
        },
        start: {
          type: "number",
          description:
            "Pagination offset; Bitrix returns 50 objects per page and stops moving past 1000.",
        },
      },
      operation: "disk.search",
      input: (args) => ({
        query: requiredText(args["query"], "query", 3, 255),
        ...(args["type"] === undefined
          ? {}
          : { type: requiredText(args["type"], "type", 4, 6) }),
        ...(args["storageId"] === undefined
          ? {}
          : { storageId: optionalInteger(args["storageId"], "storageId") }),
        ...(args["folderId"] === undefined
          ? {}
          : { folderId: optionalInteger(args["folderId"], "folderId") }),
        ...(args["start"] === undefined
          ? {}
          : { start: optionalInteger(args["start"], "start", 0, 1_000) }),
      }),
    }),

    tool({
      name: "bitrix_get_file",
      description:
        "Read the metadata and download link of one Bitrix24 Drive file. Read-only.",
      parameters: {
        id: {
          type: "number",
          required: true,
          description: "File id from bitrix_search_files.",
        },
      },
      operation: "disk.file",
      input: (args) => ({ id: requiredInteger(args["id"], "id") }),
    }),
  ];
}
