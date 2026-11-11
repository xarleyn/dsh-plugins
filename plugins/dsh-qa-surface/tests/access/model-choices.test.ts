import { describe, expect, it, vi } from "vitest";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { harness } from "./access-service.helpers.js";
import {
  userModelOptions,
  assertUserModelSelection,
  selectUserModel,
} from "../../src/access/model-choices.js";
import {
  modelPolicySatisfied,
  normalizeAllowedModels,
} from "../../src/access/model-policy.js";

const deepseek = { provider: "deepseek", model: "chat" };
const local = { provider: "local", model: "small" };
const premium = { provider: "premium", model: "top" };

async function fixture() {
  const f = harness({ session: deepseek });
  const general = f.service.roles.snapshot().subroles[0]!;
  await f.service.updateSubrole(f.admin.token, general.id, {
    ...general,
    allowedModels: [local],
  });
  f.service.reserveSession(f.user.token, "session-user", null, false);
  return f;
}

describe("user model grants", () => {
  it("keeps the native Host default available when QA has not configured a default pair", async () => {
    const f = harness();
    const get = f.ctx.get.bind(f.ctx);
    vi.spyOn(f.ctx, "get").mockImplementation(((name: string) =>
      name === "agentDefaultModel"
        ? { currentSelection: () => deepseek }
        : get(name as never)) as typeof f.ctx.get);
    const general = f.service.roles.snapshot().subroles[0]!;
    await f.service.updateSubrole(f.admin.token, general.id, {
      ...general,
      allowedModels: [local],
    });
    const policy = f.service.draftModelPolicy(f.user.token, null, false);
    expect(policy.pair).toEqual(deepseek);
    expect(modelPolicySatisfied(policy, deepseek)).toBe(true);
    expect(modelPolicySatisfied(policy, local)).toBe(true);
    expect(modelPolicySatisfied(policy, premium)).toBe(false);
  });
  it("commits through the Host's session-local primitive without saving an operator default", async () => {
    const f = await fixture();
    const agent = { status: "idle" } as Agent;
    vi.spyOn(f.ctx.agents, "get").mockReturnValue(agent);
    const commit = vi.fn();
    const nativeSelect = vi.fn();
    const saveDefault = vi.fn();
    const resolveCallConfig = vi.fn(async () => local);
    Object.assign(f.ctx.sessionController, {
      selectModel: nativeSelect,
      agents: {
        serializeImageAdmission: async (
          _agent: Agent,
          run: () => Promise<unknown>,
        ) => run(),
        selectForNextRequest: commit,
      },
    });
    Object.assign(f.ctx, {
      llm: { resolveCallConfig },
      agentDefaultModel: { saveSelection: saveDefault },
    });
    const request = { sessionId: SessionId("session-user"), ...local };
    await expect(
      selectUserModel(f.ctx, f.service, f.user.token, request),
    ).resolves.toEqual({ selected: local });
    expect(commit).toHaveBeenCalledExactlyOnceWith(agent, local);
    expect(nativeSelect).not.toHaveBeenCalled();
    expect(saveDefault).not.toHaveBeenCalled();
    commit.mockClear();
    Object.assign(agent, { status: "running" });
    await expect(
      selectUserModel(f.ctx, f.service, f.user.token, request),
    ).rejects.toThrow(/current response/u);
    expect(commit).not.toHaveBeenCalled();
    Object.assign(agent, { status: "idle" });
    resolveCallConfig.mockImplementationOnce(async () => {
      await f.service.updateAssignment(f.admin.token, f.user.user.id, {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
        allowedModels: [],
      });
      return local;
    });
    await expect(
      selectUserModel(f.ctx, f.service, f.user.token, request),
    ).rejects.toThrow(/not allowed/u);
    expect(commit).not.toHaveBeenCalled();
  });
  it("exposes only the default and role grants, with account overrides narrowing the list", async () => {
    const f = await fixture();
    const draft = await userModelOptions(
      f.ctx,
      f.service,
      f.user.token,
      null,
      null,
      false,
    );
    expect(draft.models.map(({ provider }) => provider)).toEqual([
      "local",
      "deepseek",
    ]);
    expect(draft.defaultModel).toEqual(deepseek);
    expect(draft.selected).toEqual(deepseek);
    expect(
      modelPolicySatisfied(f.service.modelPolicyFor("session-user"), local),
    ).toBe(true);
    expect(
      modelPolicySatisfied(f.service.modelPolicyFor("session-user"), premium),
    ).toBe(false);

    await f.service.updateAssignment(f.admin.token, f.user.user.id, {
      allowedSubroles: ["general"],
      defaultSubrole: "general",
      allowedModels: [],
    });
    const narrowed = await userModelOptions(
      f.ctx,
      f.service,
      f.user.token,
      "session-user",
      null,
      false,
    );
    expect(narrowed.models.map(({ provider }) => provider)).toEqual([
      "deepseek",
    ]);
    expect(
      modelPolicySatisfied(f.service.modelPolicyFor("session-user"), local),
    ).toBe(false);
    expect(f.accounts.accessOf(f.user.user.id)?.allowedModels).toEqual([]);
  });

  it("resolves exact redirects for grants and rejects unknown or malformed alternatives before saving", async () => {
    const old = { provider: "local", model: "retired" };
    const f = harness({
      session: { ...deepseek, modelReplacements: [{ from: old, to: local }] },
    });
    await f.service.updateAssignment(f.admin.token, f.user.user.id, {
      allowedSubroles: ["general"],
      defaultSubrole: "general",
      allowedModels: [old],
    });
    f.service.reserveSession(f.user.token, "session-user", null, false);
    expect(f.service.modelPolicyFor("session-user").allowedModels).toEqual([
      local,
    ]);
    await expect(
      f.service.updateAssignment(f.admin.token, f.user.user.id, {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
        allowedModels: [{ provider: "local", model: "missing" }],
      }),
    ).rejects.toThrow(/does not offer/u);
    expect(f.accounts.accessOf(f.user.user.id)?.allowedModels).toEqual([old]);
    expect(() =>
      normalizeAllowedModels([{ provider: "", model: "" }], "allowedModels"),
    ).toThrow(/complete pairs/u);
  });

  it("uses the native durable selection instead of immutable creation options", async () => {
    const f = await fixture();
    vi.spyOn(f.ctx.agents, "get").mockReturnValue({
      session: { id: "session-user" },
      options: deepseek,
    } as Agent);
    const get = f.ctx.get.bind(f.ctx);
    vi.spyOn(f.ctx, "get").mockImplementation(((name: string) =>
      name === "sessionProjections"
        ? { stateOf: () => ({ pending: local, lastUsed: deepseek }) }
        : get(name as never)) as typeof f.ctx.get);
    const options = await userModelOptions(
      f.ctx,
      f.service,
      f.user.token,
      "session-user",
      null,
      false,
    );
    expect(options.selected).toEqual(local);
    expect(options.defaultModel).toEqual(deepseek);
    expect(
      modelPolicySatisfied(
        f.service.modelPolicyFor("session-user"),
        options.selected!,
      ),
    ).toBe(true);
    expect(f.ctx.agents.get(SessionId("session-user"))?.options).toEqual(
      deepseek,
    );
  });

  it("authenticates and checks ownership and preview roles before reading the catalog", async () => {
    const f = await fixture();
    const read = vi.spyOn(f.ctx.sessionController, "modelCatalog");
    await expect(
      userModelOptions(f.ctx, f.service, "invalid", null, null, false),
    ).rejects.toThrow();
    await expect(
      userModelOptions(
        f.ctx,
        f.service,
        f.admin.token,
        "session-user",
        null,
        false,
      ),
    ).rejects.toThrow();
    await expect(
      userModelOptions(f.ctx, f.service, f.user.token, null, "general", true),
    ).rejects.toThrow();
    await expect(
      userModelOptions(f.ctx, f.service, f.user.token, null, "missing", false),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects forged pairs, effort overrides, empty catalogs and grants revoked during the catalog read", async () => {
    const f = await fixture();
    const policy = () => f.service.modelPolicyFor("session-user");
    await expect(
      assertUserModelSelection(f.ctx, policy, local),
    ).resolves.toBeUndefined();
    await expect(
      assertUserModelSelection(f.ctx, policy, premium),
    ).rejects.toThrow(/not allowed/u);
    await expect(
      assertUserModelSelection(f.ctx, policy, {
        ...local,
        reasoningEffort: "high",
      }),
    ).rejects.toThrow(/effort/u);
    await expect(assertUserModelSelection(f.ctx, policy, {})).rejects.toThrow(
      /complete/u,
    );
    const read = f.ctx.sessionController.modelCatalog.bind(
      f.ctx.sessionController,
    );
    vi.spyOn(f.ctx.sessionController, "modelCatalog").mockImplementationOnce(
      async () => {
        await f.service.updateAssignment(f.admin.token, f.user.user.id, {
          allowedSubroles: ["general"],
          defaultSubrole: "general",
          allowedModels: [],
        });
        return read();
      },
    );
    await expect(
      assertUserModelSelection(f.ctx, policy, local),
    ).rejects.toThrow(/not allowed/u);
    vi.spyOn(f.ctx.sessionController, "modelCatalog").mockResolvedValueOnce({
      groups: [],
      default: undefined,
      routableProviders: [],
      failures: [],
    } as never);
    await expect(
      assertUserModelSelection(f.ctx, policy, deepseek),
    ).rejects.toThrow(/unavailable/u);
  });
});
