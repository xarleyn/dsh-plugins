import { describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import {
  applySessionModelPolicy,
  reconcileSessionModelPolicy,
  sessionModelSelection,
} from "../../src/session-model.js";
import { resolveModelPolicy } from "../../src/access/model-policy.js";
import type { Agent } from "@deepseek-ai/dsh-agent";

/**
 * The moment a chat is put on the pair its policy names — before the Host has
 * anything to fail on.
 */
function stand(pair: { provider: string; model: string }) {
  const selected: Record<string, unknown>[] = [];
  const logged: Record<string, unknown>[] = [];
  const ctx = {
    sessionController: {
      modelCatalog: async () => ({
        groups: [
          {
            id: pair.provider,
            name: pair.provider,
            models: [{ id: pair.model, name: pair.model }],
          },
        ],
      }),
      selectModel: async (request: Record<string, unknown>) => {
        selected.push(request);
      },
    },
  } as unknown as Context;
  const logger = {
    info: (event: string, fields: Record<string, unknown>) =>
      logged.push({ event, ...fields }),
    debug() {},
    warn() {},
    error() {},
    close() {},
  } as unknown as PluginLogger;
  return { ctx, logger, selected, logged };
}

describe("opening a chat on its policy's pair", () => {
  it("reads the Host's pending selection ahead of immutable creation options and last-used state", () => {
    const old = { provider: "local", model: "old-model" };
    const next = { provider: "local", model: "new-model" };
    let pending: typeof next | null = next;
    const ctx = {
      get: () => ({ stateOf: () => ({ pending, lastUsed: old }) }),
    } as unknown as Context;
    const agent = { session: {}, options: old } as unknown as Agent;
    expect(sessionModelSelection(ctx, agent)).toEqual(next);
    pending = null;
    expect(sessionModelSelection(ctx, agent)).toEqual(old);
    expect(agent.options).toBe(old);
  });
  it("repairs an idle session only through the operator's exact redirect", async () => {
    const old = { provider: "local", model: "old-model" };
    const next = { provider: "local", model: "new-model" };
    const rules = [{ from: old, to: next }];
    const fake = stand(next);
    const policy = resolveModelPolicy({ account: old }, rules);
    expect(
      await reconcileSessionModelPolicy(
        fake.ctx,
        "session-1" as never,
        policy,
        {
          status: "idle",
          options: old,
          runMaintenance: (task) => task(new AbortController().signal),
        },
        rules,
        fake.logger,
      ),
    ).toBe(true);
    expect(fake.selected).toEqual([{ sessionId: "session-1", ...next }]);
  });
  it("leaves running sessions and unrelated model choices unchanged", async () => {
    const old = { provider: "local", model: "old-model" };
    const next = { provider: "local", model: "new-model" };
    const rules = [{ from: old, to: next }];
    const fake = stand(next);
    const policy = resolveModelPolicy({ deployment: next }, rules);
    for (const current of [
      { status: "running", options: old },
      {
        status: "idle",
        options: { provider: "other", model: "private-model" },
      },
    ])
      expect(
        await reconcileSessionModelPolicy(
          fake.ctx,
          "session-1" as never,
          policy,
          {
            ...current,
            runMaintenance: (task) => task(new AbortController().signal),
          },
          rules,
          fake.logger,
        ),
      ).toBe(false);
    expect(fake.selected).toEqual([]);
  });
  it("selects the pair the role named, effort included", async () => {
    const fake = stand({ provider: "deepseek", model: "chat" });
    const applied = await applySessionModelPolicy(
      fake.ctx,
      "session-1" as never,
      resolveModelPolicy({
        subrole: {
          provider: "deepseek",
          model: "chat",
          reasoningEffort: "low",
        },
      }),
      fake.logger,
    );
    expect(applied).toEqual({
      provider: "deepseek",
      model: "chat",
      reasoningEffort: "low",
    });
    expect(fake.selected).toEqual([
      {
        sessionId: "session-1",
        provider: "deepseek",
        model: "chat",
        reasoningEffort: "low",
      },
    ]);
    // The journal says which layer decided, so a stand's first question can be
    // traced to the role or the account that fixed its model.
    expect(fake.logged[0]).toMatchObject({
      event: "session.model-selected",
      layer: "subrole",
      model: "chat",
    });
  });

  it("leaves the session alone where no layer named a pair", async () => {
    const fake = stand({ provider: "deepseek", model: "chat" });
    const applied = await applySessionModelPolicy(
      fake.ctx,
      "session-1" as never,
      resolveModelPolicy({}),
      fake.logger,
    );
    expect(applied).toBeUndefined();
    expect(fake.selected).toEqual([]);
  });

  it("refuses the chat rather than letting it fail on its first question", async () => {
    const fake = stand({ provider: "deepseek", model: "chat" });
    await expect(
      applySessionModelPolicy(
        fake.ctx,
        "session-1" as never,
        resolveModelPolicy({ subrole: { provider: "local", model: "small" } }),
        fake.logger,
      ),
    ).rejects.toThrow(/does not offer/u);
    expect(fake.selected).toEqual([]);
  });
});
