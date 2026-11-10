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
    scoped?: boolean;
  } = {},
) {
  const ctx = new Context();
  const restrictions = new Map<string, ExpertToolFilter>();
  const guards = new Map<
    string,
    (execution: { name: string }) => string | undefined
  >();
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
              get: (name: string) =>
                options.scoped &&
                ["research_code", "file_delete", "run_code"].includes(name)
                  ? { name }
                  : undefined,
              guard: (
                guard: (execution: { name: string }) => string | undefined,
              ) => {
                guards.set(id, guard);
                return () => guards.delete(id);
              },
              restrict: (filter: ExpertToolFilter) => {
                if (
                  options.unknown ||
                  (options.scoped &&
                    [...(filter.allow ?? []), ...(filter.deny ?? [])].some(
                      (name) =>
                        ![
                          "read",
                          "docs_read",
                          "write",
                          "inherited_read",
                        ].includes(name),
                    ))
                )
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
  return { ctx, restrictions, guards, firstPrompts, dispose, subagents, spec };
}

describe("expert tool restrictions at the Host lifecycle boundary", () => {
  it("does not reclassify the reserved execution transport as an allowed local tool", async () => {
    const h = harness({ scoped: true });
    await expect(
      startRestrictedExpert(h.ctx, h.subagents, h.spec, {
        allow: ["run_code"],
        deny: [],
      }),
    ).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
    expect(h.firstPrompts).toEqual([]);
  });

  it("keeps local research tools and inherited masks while guarding local or future denied tools", async () => {
    const h = harness({ scoped: true });
    const child = await startRestrictedExpert(h.ctx, h.subagents, h.spec, {
      allow: ["read", "inherited_read", "research_code"],
      deny: ["write", "file_delete", "future_delete"],
    });
    expect(h.restrictions.get(child.childId)).toEqual({
      allow: ["read", "inherited_read"],
      deny: ["write"],
    });
    const guard = h.guards.get(child.childId)!;
    expect(guard({ name: "research_code" })).toBeUndefined();
    expect(guard({ name: "file_delete" })).toContain("denied");
    expect(guard({ name: "future_delete" })).toContain("denied");
    expect(h.firstPrompts).toContain(child.childId);
  });

  it("does not hide unknown allowed names during local-tool reconciliation", async () => {
    const h = harness({ scoped: true });
    await expect(
      startRestrictedExpert(h.ctx, h.subagents, h.spec, {
        allow: ["research_code", "missing_tool"],
        deny: [],
      }),
    ).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
    expect(h.firstPrompts).toEqual([]);
  });

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
