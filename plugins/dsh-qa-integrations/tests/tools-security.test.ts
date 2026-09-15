import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { createIntegrationTools } from "../src/tools.js";

describe("model-visible integration tools", () => {
  const broker = {
    call: async () => ({
      provider: "bitrix24",
      operation: "crm.get",
      data: {},
    }),
  };
  const tools = createIntegrationTools({
    broker: broker as never,
    principalForSession: (sessionId) =>
      sessionId === "owned" ? { userId: "alice" } : undefined,
  }) as readonly ToolDefinition[];

  it("contains no principal or secret selector fields", () => {
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

  it("fails closed for an unowned or delegated session", async () => {
    const crm = tools.find((tool) => tool.name === "bitrix_get_crm_item");
    expect(crm).toBeDefined();
    const unowned = {
      agent: { session: { header: { id: "child-unowned" } } },
    } as unknown as ToolRunContext;
    await expect(
      crm?.execute({ entityTypeId: 2, id: 1 }, unowned),
    ).rejects.toMatchObject({ code: "PrincipalNotResolved" });
  });
});
