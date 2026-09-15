import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { BITRIX_OPERATIONS } from "../src/catalog.js";
import { createIntegrationTools } from "../src/tools.js";

/** Minimal valid arguments per tool, so the sweep reaches the executor. */
const MINIMAL_ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  bitrix_search_crm: { entityTypeId: 2 },
  bitrix_get_crm_item: { entityTypeId: 2, id: 1 },
  bitrix_get_crm_fields: { entityTypeId: 2 },
  bitrix_get_crm_funnels: { entityTypeId: 2 },
  bitrix_get_crm_statuses: { entityId: "DEAL_STAGE" },
  bitrix_get_crm_activities: {},
  bitrix_get_crm_activity: { id: 1 },
  bitrix_get_crm_timeline: { entityTypeId: 2, entityId: 1 },
  bitrix_get_crm_stage_history: { entityTypeId: 2 },
  bitrix_get_crm_product_rows: { ownerType: "D", ownerId: 1 },
  bitrix_find_crm_duplicates: { type: "PHONE", values: ["+79161234567"] },
  bitrix_get_crm_requisites: { entityTypeId: 3, entityId: 1 },
  bitrix_get_call_transcript: { activityId: 1 },
  bitrix_get_current_user: {},
  bitrix_search_users: { query: "Иван" },
  bitrix_get_departments: {},
  bitrix_get_user_fields: {},
  bitrix_search_chats: { query: "договор" },
  bitrix_get_chat_messages: { dialogId: "chat1" },
  bitrix_search_chat_messages: { dialogId: "chat1" },
  bitrix_get_recent_chats: {},
  bitrix_search_chat_users: { query: "Иван" },
  bitrix_find_chat: { entityType: "CRM", entityId: "DEAL|1663" },
  bitrix_get_chat_participants: { chatId: 1 },
  bitrix_get_chat_user_data: { users: [1] },
  bitrix_get_openline_dialog: { dialogId: "chat1" },
  bitrix_get_openline_history: { sessionId: 1 },
  bitrix_search_tasks: {},
  bitrix_get_task: { taskId: 1 },
  bitrix_get_task_history: { taskId: 1 },
  bitrix_get_task_results: { taskId: 1 },
  bitrix_get_task_elapsed_time: { taskId: 1 },
  bitrix_get_calendar_events: {},
  bitrix_get_calendar_accessibility: {
    users: [1],
    from: "2026-09-01",
    to: "2026-09-02",
  },
  bitrix_search_files: { query: "презентация" },
  bitrix_get_file: { id: 1 },
  bitrix_get_drives: {},
  bitrix_get_storage_items: { storageId: 1 },
  bitrix_get_folder_items: { folderId: 1 },
};

function buildTools(options: { readonly owned: boolean }) {
  const operations: string[] = [];
  const broker = {
    call: async (
      principal: { readonly userId: string },
      request: { readonly operation: string },
    ) => {
      operations.push(`${principal.userId}:${request.operation}`);
      return { provider: "bitrix24", operation: request.operation, data: {} };
    },
  };
  const tools = createIntegrationTools({
    broker: broker as never,
    principalForSession: (sessionId) =>
      options.owned && sessionId === "owned" ? { userId: "alice" } : undefined,
  }) as readonly ToolDefinition[];
  return { operations, tools };
}

function context(sessionId: string): ToolRunContext {
  return {
    agent: { session: { header: { id: sessionId } } },
  } as unknown as ToolRunContext;
}

describe("model-visible integration tools", () => {
  it("contains no principal or secret selector fields", () => {
    const { tools } = buildTools({ owned: true });
    const schema = JSON.stringify(tools);
    for (const forbidden of [
      "userId",
      "ownerUserId",
      "credentialId",
      "accessToken",
      "refreshToken",
      "secretId",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("fails closed for an unowned or delegated session, on every tool", async () => {
    const { tools, operations } = buildTools({ owned: false });
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const args = MINIMAL_ARGS[tool.name];
      expect(args, `${tool.name} has no minimal arguments`).toBeDefined();
      await expect(
        tool.execute(args as never, context("child-unowned")),
      ).rejects.toMatchObject({ code: "PrincipalNotResolved" });
    }
    expect(operations).toEqual([]);
  });

  it("routes every tool to a catalog operation under the session's principal", async () => {
    const { tools, operations } = buildTools({ owned: true });
    for (const tool of tools) {
      const args = MINIMAL_ARGS[tool.name];
      await expect(
        tool.execute(args as never, context("owned")),
      ).resolves.toBeDefined();
    }
    const called = operations.map((entry) => entry.split(":")[1] as string);
    expect(called).toHaveLength(tools.length);
    for (const operation of called) {
      expect(BITRIX_OPERATIONS[operation], operation).toBeDefined();
    }
    expect(operations.every((entry) => entry.startsWith("alice:"))).toBe(true);
  });
});
