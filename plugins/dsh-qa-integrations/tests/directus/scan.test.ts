import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import { createDirectusScanTools } from "../../src/providers/directus/scan.js";

const query = {
  instance: "demo",
  collection: "demo_records",
  filters: [{ field: "project_id", op: "eq", value: 42 }],
};

function setup() {
  const call = vi.fn(async (_context, _operation, input) => ({
    provider: "directus:demo",
    operation: "items.list",
    data:
      input.offset === 0
        ? { items: [{ id: 1 }], nextOffset: 1 }
        : { items: [{ id: 2 }], nextOffset: null },
  }));
  const [start, next] = createDirectusScanTools(
    {
      principalForSession: (id) =>
        id === "unbound" ? undefined : { userId: "reader" },
    },
    call,
  );
  type Meta = ReturnType<NonNullable<typeof next.output.presentationMeta>>;
  const journal: {
    type: "tool/result";
    surfaceOp: "append" | { op: "replace" };
    data: { message: { isError: boolean }; meta?: Meta };
  }[] = [];
  const context = (id: string) =>
    ({
      agent: {
        session: {
          header: { id },
          snapshotEvents: () => journal,
          surface: { nodes: [] },
        },
      },
      signal: AbortSignal.timeout(5_000),
    }) as unknown as ToolRunContext;
  const execute = async (args: unknown, id = "demo-chat") => {
    const tool =
      typeof args === "object" && args !== null && "query" in args
        ? start
        : next;
    const input = tool === start ? (args as { query: unknown }).query : args;
    const value = (await tool.execute(input, context(id))) as Meta;
    const meta = tool.output.presentationMeta?.(input, value);
    journal.push({
      type: "tool/result",
      surfaceOp: "append",
      data: { message: { isError: false }, meta },
    });
    const [block] = tool.output.render(input, value);
    return block?.type === "text" ? JSON.parse(block.text) : undefined;
  };
  return { execute, journal, call };
}

describe("Directus scan cursor", () => {
  it("resolves the next page from successful journal receipts outside the compacted surface", async () => {
    const { execute, journal, call } = setup();
    expect(await execute({ query })).toMatchObject({
      pageOffset: 0,
      nextOffset: 1,
      rowsRead: 1,
    });
    journal.push({
      type: "tool/result",
      surfaceOp: "append",
      data: { message: { isError: true }, meta: journal[0]?.data.meta },
    });
    call.mockRejectedValueOnce(Error("unavailable"));
    await expect(execute({})).rejects.toThrow("unavailable");
    expect(await execute({})).toMatchObject({
      pageOffset: 1,
      nextOffset: null,
      rowsRead: 2,
    });
    journal.push({
      type: "tool/result",
      surfaceOp: { op: "replace" },
      data: { message: { isError: false }, meta: journal[0]?.data.meta },
    });
    expect(await execute({})).toMatchObject({
      pageOffset: null,
      nextOffset: null,
      rowsRead: 2,
      items: [],
    });
    expect(
      call.mock.calls.map(([, operation, input]) => [operation, input]),
    ).toEqual([
      ["items.list", { ...query, offset: 0 }],
      ["items.list", { ...query, offset: 1 }],
      ["items.list", { ...query, offset: 1 }],
    ]);
  });

  it("requires an explicit scoped start, including in a fork or another chat", async () => {
    const { execute, call } = setup();
    await expect(execute({})).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      execute({ query: { ...query, filters: [] } }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await execute({ query });
    await expect(execute({ query })).rejects.toMatchObject({
      code: "InvalidRequest",
    });
    await expect(execute({}, "fork")).rejects.toMatchObject({
      code: "InvalidRequest",
    });
    await expect(execute({}, "unbound")).rejects.toMatchObject({
      code: "PrincipalNotResolved",
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
