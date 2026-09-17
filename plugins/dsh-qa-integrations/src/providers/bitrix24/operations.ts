import {
  externalUserIdFrom,
  optionalBoolean,
  optionalDate,
  optionalInteger,
  optionalText,
  requiredDate,
  requiredInteger,
  requiredIntegerList,
  requiredStringList,
  requiredText,
} from "../../coerce.js";
import { IntegrationError } from "../../errors.js";

/** `chat1489` and `1489` both name the numeric chat id search methods take. */
function chatIdFromDialog(dialogId: string, field: string): number {
  const numeric = dialogId.replace(/^chat/iu, "");
  if (!/^\d+$/u.test(numeric)) {
    throw new IntegrationError("InvalidRequest", `${field} is invalid`);
  }
  return requiredInteger(Number(numeric), field);
}

export interface OperationContext {
  /** Bitrix user id of the webhook owner, resolved from the stored integration. */
  readonly externalUserId?: string | undefined;
}

export type BitrixOperationHandler = (
  input: Readonly<Record<string, unknown>>,
  context: OperationContext,
) => Record<string, unknown> | readonly unknown[];

/** Deal stages are `DEAL_STAGE`, leads use `STATUS`; callers pass the rest raw. */
const TIMELINE_ENTITY_TYPES: Readonly<Record<number, string>> = Object.freeze({
  1: "lead",
  2: "deal",
  3: "contact",
  4: "company",
});

const DUPLICATE_ENTITY_TYPES: readonly string[] = Object.freeze([
  "LEAD",
  "CONTACT",
  "COMPANY",
]);

const CALENDAR_TYPES: readonly string[] = Object.freeze([
  "user",
  "group",
  "company_calendar",
]);

const DISK_TYPES: readonly string[] = Object.freeze(["file", "folder", "all"]);

const ACTIVITY_SELECT: readonly string[] = Object.freeze([
  "ID",
  "OWNER_TYPE_ID",
  "OWNER_ID",
  "TYPE_ID",
  "PROVIDER_ID",
  "PROVIDER_TYPE_ID",
  "SUBJECT",
  "START_TIME",
  "END_TIME",
  "DEADLINE",
  "COMPLETED",
  "STATUS",
  "PRIORITY",
  "DIRECTION",
  "RESPONSIBLE_ID",
  "CREATED",
  "LAST_UPDATED",
  "AUTHOR_ID",
]);

const TASK_SELECT: readonly string[] = Object.freeze([
  "ID",
  "TITLE",
  "STATUS",
  "REAL_STATUS",
  "PRIORITY",
  "RESPONSIBLE_ID",
  "CREATED_BY",
  "CREATED_DATE",
  "CHANGED_DATE",
  "CLOSED_DATE",
  "DEADLINE",
  "GROUP_ID",
  "UF_CRM_TASK",
]);

/** Only the fields a list view needs; details come from the single-item tool. */
const CRM_SEARCH_SELECT: readonly string[] = Object.freeze([
  "id",
  "title",
  "createdTime",
  "updatedTime",
  "assignedById",
]);

const DEFAULT_START = 0;

function start(input: Readonly<Record<string, unknown>>, max?: number): number {
  return optionalInteger(input["start"], "start", 0, max) ?? DEFAULT_START;
}

/** Fields a search may sort by; anything else is refused before the call. */
const CRM_SEARCH_ORDER_FIELDS: readonly string[] = Object.freeze([
  "id",
  "createdTime",
  "updatedTime",
]);

function crmSearchOrder(input: Readonly<Record<string, unknown>>): string {
  const order = optionalText(input["orderBy"], "orderBy", 2, 20) ?? "id";
  if (!CRM_SEARCH_ORDER_FIELDS.includes(order)) {
    throw new IntegrationError(
      "InvalidRequest",
      `orderBy is invalid: use one of ${CRM_SEARCH_ORDER_FIELDS.join(", ")}`,
    );
  }
  return order;
}

function crmSearchDirection(input: Readonly<Record<string, unknown>>): string {
  const direction = optionalText(input["orderDir"], "orderDir", 3, 4) ?? "asc";
  const normalized = direction.toUpperCase();
  if (normalized !== "ASC" && normalized !== "DESC") {
    throw new IntegrationError(
      "InvalidRequest",
      "orderDir is invalid: use asc or desc",
    );
  }
  return normalized;
}

function withFilter(
  filter: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return { ...extra, ...(Object.keys(filter).length === 0 ? {} : { filter }) };
}

export const BITRIX_HANDLERS: Readonly<Record<string, BitrixOperationHandler>> =
  Object.freeze({
    "crm.search": (input, context) => {
      const filter: Record<string, unknown> = {};
      const query = optionalText(input["query"], "query", 1, 200);
      if (query !== undefined) filter["%title"] = query;
      if (optionalBoolean(input["assignedToMe"], "assignedToMe") === true) {
        filter["@assignedById"] = [
          externalUserIdFrom(context.externalUserId, "assignedToMe"),
        ];
      }
      const stageId = optionalText(input["stageId"], "stageId", 1, 64);
      if (stageId !== undefined) filter["stageId"] = stageId;
      const categoryId = optionalInteger(input["categoryId"], "categoryId", 0);
      if (categoryId !== undefined) filter["categoryId"] = categoryId;
      const entityTypeId = requiredInteger(
        input["entityTypeId"],
        "entityTypeId",
      );
      if (optionalBoolean(input["openOnly"], "openOnly") === true) {
        if (entityTypeId !== 2) {
          throw new IntegrationError(
            "InvalidRequest",
            "openOnly is invalid: only deals (entityTypeId 2) can exclude closed items",
          );
        }
        filter["closed"] = "N";
      }
      const createdSince = optionalDate(input["createdSince"], "createdSince");
      if (createdSince !== undefined) filter[">=createdTime"] = createdSince;
      const updatedSince = optionalDate(input["updatedSince"], "updatedSince");
      if (updatedSince !== undefined) filter[">=updatedTime"] = updatedSince;
      return withFilter(filter, {
        entityTypeId,
        // Offset paging over an unspecified order repeats and drops rows, so
        // every search names a deterministic order; `order` narrows it.
        order: {
          [crmSearchOrder(input)]: crmSearchDirection(input),
        },
        select: [...CRM_SEARCH_SELECT],
        start: start(input),
      });
    },

    "crm.timelineCommentAdd": (input) => {
      const entityTypeId = requiredInteger(
        input["entityTypeId"],
        "entityTypeId",
        1,
        4,
      );
      const entityType = TIMELINE_ENTITY_TYPES[entityTypeId];
      if (entityType === undefined) {
        throw new IntegrationError("InvalidRequest", "entityTypeId is invalid");
      }
      return {
        fields: {
          ENTITY_TYPE: entityType,
          ENTITY_ID: requiredInteger(input["entityId"], "entityId"),
          COMMENT: requiredText(input["comment"], "comment", 1, 5000),
        },
      };
    },

    "crm.get": (input) => ({
      entityTypeId: requiredInteger(input["entityTypeId"], "entityTypeId"),
      id: requiredInteger(input["id"], "id"),
    }),

    "crm.fields": (input) => ({
      entityTypeId: requiredInteger(input["entityTypeId"], "entityTypeId"),
      ...(optionalBoolean(input["originalUfNames"], "originalUfNames") === true
        ? { useOriginalUfNames: "Y" }
        : {}),
    }),

    "crm.funnels": (input) => ({
      entityTypeId: requiredInteger(input["entityTypeId"], "entityTypeId"),
    }),

    "crm.statuses": (input) => ({
      filter: { ENTITY_ID: requiredText(input["entityId"], "entityId", 1, 64) },
    }),

    "crm.activities": (input, context) => {
      const filter: Record<string, unknown> = {};
      const entityTypeId = optionalInteger(
        input["entityTypeId"],
        "entityTypeId",
      );
      const entityId = optionalInteger(input["entityId"], "entityId");
      if (entityTypeId !== undefined) filter["OWNER_TYPE_ID"] = entityTypeId;
      if (entityId !== undefined) filter["OWNER_ID"] = entityId;
      if (optionalBoolean(input["assignedToMe"], "assignedToMe") === true) {
        filter["RESPONSIBLE_ID"] = externalUserIdFrom(
          context.externalUserId,
          "assignedToMe",
        );
      }
      if (optionalBoolean(input["openOnly"], "openOnly") === true) {
        filter["COMPLETED"] = "N";
      }
      const deadlineTo = optionalDate(input["deadlineTo"], "deadlineTo");
      if (deadlineTo !== undefined) filter["<=DEADLINE"] = deadlineTo;
      return withFilter(filter, {
        select: [...ACTIVITY_SELECT],
        order: { ID: "DESC" },
        start: start(input),
      });
    },

    "crm.activity": (input) => ({
      id: requiredInteger(input["id"], "id"),
    }),

    "crm.timeline": (input) => {
      const entityTypeId = requiredInteger(
        input["entityTypeId"],
        "entityTypeId",
        1,
        4,
      );
      const entityType = TIMELINE_ENTITY_TYPES[entityTypeId];
      if (entityType === undefined) {
        throw new IntegrationError("InvalidRequest", "entityTypeId is invalid");
      }
      return {
        filter: {
          ENTITY_TYPE: entityType,
          ENTITY_ID: requiredInteger(input["entityId"], "entityId"),
        },
        select: [
          "ID",
          "ENTITY_TYPE",
          "ENTITY_ID",
          "CREATED",
          "COMMENT",
          "AUTHOR_ID",
        ],
        order: { ID: "DESC" },
        start: start(input),
      };
    },

    "crm.stageHistory": (input) => {
      const entityId = optionalInteger(input["entityId"], "entityId");
      return {
        entityTypeId: requiredInteger(input["entityTypeId"], "entityTypeId"),
        ...(entityId === undefined ? {} : { filter: { OWNER_ID: entityId } }),
        start: start(input),
      };
    },

    "crm.productRows": (input) => ({
      filter: {
        "=ownerType": requiredText(input["ownerType"], "ownerType", 1, 8),
        "=ownerId": requiredInteger(input["ownerId"], "ownerId"),
      },
      start: start(input),
    }),

    "crm.duplicates": (input) => {
      const type = requiredText(input["type"], "type", 4, 5).toUpperCase();
      if (type !== "PHONE" && type !== "EMAIL") {
        throw new IntegrationError("InvalidRequest", "type is invalid");
      }
      const entityType = optionalText(
        input["entityType"],
        "entityType",
        4,
        8,
      )?.toUpperCase();
      if (
        entityType !== undefined &&
        !DUPLICATE_ENTITY_TYPES.includes(entityType)
      ) {
        throw new IntegrationError("InvalidRequest", "entityType is invalid");
      }
      return {
        type,
        values: requiredStringList(input["values"], "values", 20, 320),
        ...(entityType === undefined ? {} : { entity_type: entityType }),
      };
    },

    // Requisites belong to contacts and companies; the portal returns all
    // available fields, so no `select` narrows the answer.
    "crm.requisites": (input) => ({
      filter: {
        ENTITY_TYPE_ID: requiredInteger(
          input["entityTypeId"],
          "entityTypeId",
          1,
          128,
        ),
        ENTITY_ID: requiredInteger(input["entityId"], "entityId"),
      },
      order: { ID: "ASC" },
      start: start(input),
    }),

    "crm.callTranscript": (input) => ({
      activityId: requiredInteger(input["activityId"], "activityId"),
    }),

    "user.current": () => ({}),

    "user.list": (input) => {
      const filter: Record<string, unknown> = {};
      const query = optionalText(input["query"], "query", 2, 120);
      const email = optionalText(input["email"], "email", 3, 320);
      const departmentId = optionalInteger(
        input["departmentId"],
        "departmentId",
      );
      if (query !== undefined) filter["NAME_SEARCH"] = query;
      if (email !== undefined) filter["EMAIL"] = email;
      if (departmentId !== undefined) filter["UF_DEPARTMENT"] = departmentId;
      if (Object.keys(filter).length === 0) {
        throw new IntegrationError(
          "InvalidRequest",
          "query, email or departmentId is required",
        );
      }
      if (optionalBoolean(input["activeOnly"], "activeOnly") === true) {
        filter["ACTIVE"] = true;
      }
      return { FILTER: filter, SORT: "ID", ORDER: "ASC", start: start(input) };
    },

    "user.fields": () => ({}),

    "user.departments": (input) => {
      const parentId = optionalInteger(input["parentId"], "parentId");
      return {
        sort: "NAME",
        order: "ASC",
        ...(parentId === undefined ? {} : { PARENT: parentId }),
      };
    },

    "chat.search": (input) => ({
      FIND: requiredText(input["query"], "query", 2, 200),
      OFFSET: start(input),
      LIMIT: optionalInteger(input["limit"], "limit", 1, 50) ?? 10,
    }),

    "chat.messages": (input) => {
      const lastId = optionalInteger(input["lastId"], "lastId");
      return {
        DIALOG_ID: requiredText(input["dialogId"], "dialogId", 1, 80),
        LIMIT: optionalInteger(input["limit"], "limit", 1, 50) ?? 20,
        ...(lastId === undefined ? {} : { LAST_ID: lastId }),
      };
    },

    "chat.messageSearch": (input) => {
      const query = optionalText(input["query"], "query", 2, 200);
      const dateFrom = optionalDate(input["dateFrom"], "dateFrom");
      const dateTo = optionalDate(input["dateTo"], "dateTo");
      const lastId = optionalInteger(input["lastId"], "lastId");
      return {
        CHAT_ID: chatIdFromDialog(
          requiredText(input["dialogId"], "dialogId", 1, 80),
          "dialogId",
        ),
        ...(query === undefined ? {} : { SEARCH_MESSAGE: query }),
        ...(dateFrom === undefined ? {} : { DATE_FROM: dateFrom }),
        ...(dateTo === undefined ? {} : { DATE_TO: dateTo }),
        ORDER: { ID: "DESC" },
        LIMIT: optionalInteger(input["limit"], "limit", 1, 200) ?? 30,
        ...(lastId === undefined ? {} : { LAST_ID: lastId }),
      };
    },

    "chat.recent": (input) => ({
      ...(optionalBoolean(input["skipOpenlines"], "skipOpenlines") === true
        ? { SKIP_OPENLINES: "Y" }
        : {}),
      ...(optionalBoolean(input["onlyOpenlines"], "onlyOpenlines") === true
        ? { ONLY_OPENLINES: "Y" }
        : {}),
    }),

    "chat.users": (input) => ({
      FIND: requiredText(input["query"], "query", 2, 200),
      BUSINESS: "N",
      OFFSET: start(input),
      LIMIT: optionalInteger(input["limit"], "limit", 1, 50) ?? 10,
    }),

    "chat.find": (input) => ({
      ENTITY_TYPE: requiredText(
        input["entityType"],
        "entityType",
        2,
        32,
      ).toUpperCase(),
      ENTITY_ID: requiredText(input["entityId"], "entityId", 1, 200),
    }),

    "chat.participants": (input) => ({
      CHAT_ID: requiredInteger(input["chatId"], "chatId"),
    }),

    "chat.userData": (input) => ({
      ID: requiredIntegerList(input["users"], "users", 50),
      RESULT_TYPE: "array",
    }),

    // imopenlines.dialog.get takes any one of four identifiers, and USER_CODE
    // is the one that finds a dialog from the client side; the report also
    // points at imopenlines.session.open for that lookup, but its documentation
    // never certifies it as read-only while this method is a documented get.
    "openlines.dialog": (input) => {
      const dialogId = optionalText(input["dialogId"], "dialogId", 1, 80);
      const sessionId = optionalInteger(input["sessionId"], "sessionId");
      const userCode = optionalText(input["userCode"], "userCode", 3, 200);
      if (
        dialogId === undefined &&
        sessionId === undefined &&
        userCode === undefined
      ) {
        throw new IntegrationError(
          "InvalidRequest",
          "dialogId, sessionId or userCode is required",
        );
      }
      return {
        ...(dialogId === undefined ? {} : { DIALOG_ID: dialogId }),
        ...(sessionId === undefined ? {} : { SESSION_ID: sessionId }),
        ...(userCode === undefined ? {} : { USER_CODE: userCode }),
      };
    },

    "openlines.history": (input) => {
      const sessionId = optionalInteger(input["sessionId"], "sessionId");
      const chatId = optionalInteger(input["chatId"], "chatId");
      if (sessionId === undefined && chatId === undefined) {
        throw new IntegrationError(
          "InvalidRequest",
          "sessionId or chatId is required",
        );
      }
      return {
        ...(sessionId === undefined ? {} : { SESSION_ID: sessionId }),
        ...(chatId === undefined ? {} : { CHAT_ID: chatId }),
      };
    },

    "tasks.list": (input, context) => {
      const filter: Record<string, unknown> = {};
      const query = optionalText(input["query"], "query", 1, 200);
      if (query !== undefined) filter["%TITLE"] = query;
      if (optionalBoolean(input["assignedToMe"], "assignedToMe") === true) {
        filter["RESPONSIBLE_ID"] = externalUserIdFrom(
          context.externalUserId,
          "assignedToMe",
        );
      }
      if (optionalBoolean(input["createdByMe"], "createdByMe") === true) {
        filter["CREATED_BY"] = externalUserIdFrom(
          context.externalUserId,
          "createdByMe",
        );
      }
      if (optionalBoolean(input["openOnly"], "openOnly") === true) {
        filter["!REAL_STATUS"] = 5;
      }
      const groupId = optionalInteger(input["groupId"], "groupId");
      if (groupId !== undefined) filter["GROUP_ID"] = groupId;
      const deadlineTo = optionalDate(input["deadlineTo"], "deadlineTo");
      if (deadlineTo !== undefined) filter["<=DEADLINE"] = deadlineTo;
      return withFilter(filter, {
        select: [...TASK_SELECT],
        order: { ID: "DESC" },
        start: start(input),
      });
    },

    "tasks.get": (input) => ({
      taskId: requiredInteger(input["taskId"], "taskId"),
      select: ["*", "UF_CRM_TASK"],
    }),

    "tasks.history": (input) => {
      const event = optionalText(input["event"], "event", 2, 40);
      return {
        taskId: requiredInteger(input["taskId"], "taskId"),
        ...(event === undefined
          ? {}
          : { filter: { FIELD: event.toUpperCase() } }),
        order: { createdDate: "ASC" },
        start: start(input),
      };
    },

    "tasks.results": (input) => ({
      taskId: requiredInteger(input["taskId"], "taskId"),
      start: start(input),
    }),

    // Positional body: Bitrix24 rejects these five as named fields.
    "tasks.elapsed": (input) => {
      const loggedBy = optionalInteger(input["loggedBy"], "loggedBy");
      return [
        requiredInteger(input["taskId"], "taskId"),
        { ID: "ASC" },
        loggedBy === undefined ? {} : { USER_ID: loggedBy },
        [
          "ID",
          "TASK_ID",
          "USER_ID",
          "MINUTES",
          "SECONDS",
          "COMMENT_TEXT",
          "CREATED_DATE",
          "DATE_START",
          "DATE_STOP",
        ],
        {
          NAV_PARAMS: {
            nPageSize: 50,
            iNumPage: optionalInteger(input["page"], "page") ?? 1,
          },
        },
      ];
    },

    "calendar.events": (input, context) => {
      const type = optionalText(input["type"], "type", 4, 20) ?? "user";
      if (!CALENDAR_TYPES.includes(type)) {
        throw new IntegrationError("InvalidRequest", "type is invalid");
      }
      const ownerId = optionalInteger(input["ownerId"], "ownerId", 0);
      if (ownerId === undefined && type === "group") {
        throw new IntegrationError(
          "InvalidRequest",
          "ownerId is required for a group calendar",
        );
      }
      const from = optionalDate(input["from"], "from");
      const to = optionalDate(input["to"], "to");
      return {
        type,
        ownerId:
          ownerId ??
          (type === "user"
            ? externalUserIdFrom(context.externalUserId, "ownerId")
            : 0),
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
      };
    },

    "calendar.accessibility": (input) => ({
      from: requiredDate(input["from"], "from"),
      to: requiredDate(input["to"], "to"),
      users: requiredIntegerList(input["users"], "users", 50),
    }),

    "disk.search": (input) => {
      const type = optionalText(input["type"], "type", 4, 6) ?? "file";
      if (!DISK_TYPES.includes(type)) {
        throw new IntegrationError("InvalidRequest", "type is invalid");
      }
      const filter: Record<string, unknown> = {};
      const storageId = optionalInteger(input["storageId"], "storageId");
      const folderId = optionalInteger(input["folderId"], "folderId");
      if (storageId !== undefined) filter["STORAGE_ID"] = storageId;
      if (folderId !== undefined) filter["FOLDER_ID"] = folderId;
      return {
        QUERY: requiredText(input["query"], "query", 3, 255),
        TYPE: type,
        ...(Object.keys(filter).length === 0 ? {} : { FILTER: filter }),
        // Bitrix stops moving past start = 1000 for this method.
        start: start(input, 1_000),
      };
    },

    "disk.file": (input) => ({
      id: requiredInteger(input["id"], "id"),
    }),

    "disk.storages": (input) => ({ start: start(input) }),

    "disk.storageChildren": (input) => ({
      id: requiredInteger(input["storageId"], "storageId"),
      start: start(input),
    }),

    "disk.folderChildren": (input) => ({
      id: requiredInteger(input["folderId"], "folderId"),
      start: start(input),
    }),
  });

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Id-keyed maps are flattened into an ordered array so the model reads a list. */
function idKeyedValues(value: unknown): unknown[] {
  return Object.entries(asRecord(value))
    .map(([key, item]) => ({ key: Number(key), item }))
    .sort((left, right) =>
      Number.isFinite(left.key) && Number.isFinite(right.key)
        ? left.key - right.key
        : 0,
    )
    .map(({ item }) => item);
}

export type BitrixProjection = (result: unknown) => unknown;

/**
 * Methods whose response is not a list of items but a bundle of id-keyed maps.
 * Left raw they cost the model most of its context for very little signal.
 */
export const BITRIX_PROJECTIONS: Readonly<Record<string, BitrixProjection>> =
  Object.freeze({
    "chat.messageSearch": (result) => {
      const source = asRecord(result);
      return {
        messages: Array.isArray(source["messages"]) ? source["messages"] : [],
        users: Array.isArray(source["users"]) ? source["users"] : [],
        files: Array.isArray(source["files"]) ? source["files"] : [],
      };
    },

    "openlines.history": (result) => {
      const source = asRecord(result);
      return {
        sessionId: source["sessionId"] ?? null,
        chatId: source["chatId"] ?? null,
        messages: idKeyedValues(source["message"]),
        users: idKeyedValues(source["users"]),
        files: idKeyedValues(source["files"]),
      };
    },

    "calendar.accessibility": (result) => ({
      availability: Object.entries(asRecord(result)).map(
        ([userId, events]) => ({
          userId,
          events: Array.isArray(events) ? events : [],
        }),
      ),
    }),
  });
