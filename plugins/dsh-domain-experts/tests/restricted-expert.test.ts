import { Context } from "@deepseek-ai/cordis";
import type {
  SubagentActivation,
  SubagentActivationSpec,
} from "@deepseek-ai/dsh-subagent";
import { describe, expect, it, vi } from "vitest";
import type { SubagentsFace } from "../src/host/execution.js";
import {
  startRestrictedExpert,
  type ExpertToolFilter,
} from "../src/host/tool-policy.js";
import { agentOf, FULL_CAPABILITIES } from "./helpers/fakes.js";

function harness(
  options: {
    unknown?: boolean;
    skipLifecycle?: boolean;
    external?: boolean;
  } = {},
) {
  const ctx = new Context();
  const restrictions = new Map<string, ExpertToolFilter>();
  const firstPrompts: string[] = [];
  const dispose = vi.fn(async () => {});
  const subagents: SubagentsFace = {
    getProvider: () => ({
      name: "spawn",
      capabilities: FULL_CAPABILITIES,
      inheritsParentContext: false,
      ...(options.external ? {} : { prepareContinuable: async () => ({}) }),
    }),
    startActivation: vi.fn(async (spec) => {
      const id = spec.childId ?? "unreserved";
      if (!options.skipLifecycle) {
        const child = {
          ...agentOf({ id }),
          ctx: {
            tools: {
              restrict: (filter: ExpertToolFilter) => {
                if (options.unknown)
                  throw new Error(
                    'tools.restrict() names unknown global tool "missing_tool"',
                  );
                restrictions.set(id, filter);
                return () => restrictions.delete(id);
              },
            },
          },
        };
        await ctx.serial("agent/created", {
          agent: child as never,
          source: "create" as never,
        });
      }
      firstPrompts.push(id);
      return {
        childId: id,
        result: Promise.resolve({}),
        dispose,
      } as unknown as SubagentActivation;
    }),
  };
  const spec: SubagentActivationSpec = {
    provider: "spawn",
    label: "domain-expert:demo",
    request: {
      parent: agentOf({ id: "parent" }),
      prompt: [{ type: "text", text: "Check the fixture." }],
    },
    signal: new AbortController().signal,
    delivery: "caller",
  };
  return { ctx, restrictions, firstPrompts, dispose, subagents, spec };
}

describe("expert tool restrictions at the Host lifecycle boundary", () => {
  it("constrains each reserved child before its first prompt without touching siblings", async () => {
    const h = harness();
    const filters = [
      { allow: ["read"], deny: [] },
      { allow: ["docs_read"], deny: ["write"] },
    ];
    const children = await Promise.all(
      filters.map((filter) =>
        startRestrictedExpert(h.ctx, h.subagents, h.spec, filter),
      ),
    );
    expect(new Set(children.map((child) => child.childId)).size).toBe(2);
    for (const [index, child] of children.entries()) {
      expect(h.restrictions.get(child.childId)).toEqual({
        allow: filters[index]!.allow,
        ...(index === 0 ? {} : { deny: ["write"] }),
      });
      expect(h.firstPrompts).toContain(child.childId);
    }
    const unrelated = {
      ...agentOf({ id: "unrelated" }),
      ctx: { tools: { restrict: vi.fn() } },
    };
    await h.ctx.serial("agent/created", {
      agent: unrelated as never,
      source: "create" as never,
    });
    expect(unrelated.ctx.tools.restrict).not.toHaveBeenCalled();
  });

  it("refuses unknown tools before any prompt and removes the temporary listener", async () => {
    const h = harness({ unknown: true });
    await expect(
      startRestrictedExpert(h.ctx, h.subagents, h.spec, {
        allow: ["missing_tool"],
        deny: [],
      }),
    ).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
    expect(h.firstPrompts).toEqual([]);
    expect(h.restrictions.size).toBe(0);
    // A failed creation must not leave a listener that can reject later agents.
    await expect(
      h.ctx.serial("agent/created", {
        agent: agentOf({ id: "later" }),
        source: "create" as never,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a backend that cannot create a local reserved child", async () => {
    const h = harness({ external: true });
    await expect(
      startRestrictedExpert(h.ctx, h.subagents, h.spec, {
        allow: ["read"],
        deny: [],
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_SUBAGENT_CAPABILITY" });
    expect(h.subagents.startActivation).not.toHaveBeenCalled();
  });

  it("disposes an activation that bypassed the awaited lifecycle boundary", async () => {
    const h = harness({ skipLifecycle: true });
    await expect(
      startRestrictedExpert(h.ctx, h.subagents, h.spec, {
        allow: ["read"],
        deny: [],
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_SUBAGENT_CAPABILITY" });
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("leaves an unconfigured policy to the provider's ordinary composition", async () => {
    const h = harness();
    await startRestrictedExpert(h.ctx, h.subagents, h.spec);
    expect(h.subagents.startActivation).toHaveBeenCalledWith(h.spec);
    expect(h.restrictions.size).toBe(0);
  });
});
