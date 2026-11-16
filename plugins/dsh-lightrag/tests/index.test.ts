/** Plugin entry tests: registration surface, switches, re-apply (SPEC §4.3). */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LightRagConfig, LiveLightRagConfig } from "../src/config.js";
import type {
  createLightRagQueryTool,
  LightRagQueryResult,
} from "../src/tools/query.js";
import { createFetchStub, jsonResponse, makeExec } from "./helpers/lightrag.js";

import {
  apply,
  Config,
  createLightRagClient,
  inject,
  LIGHTRAG_TOOL_NAMES,
  LIGHTRAG_WRITE_TOOL_NAMES,
  LightRagConfigSchema,
  name,
} from "../src/index.js";

let logHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  logHome = await mkdtemp(join(tmpdir(), "dsh-lightrag-entry-"));
  previousHome = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = logHome;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (previousHome === undefined) delete process.env["DSH_HOME"];
  else process.env["DSH_HOME"] = previousHome;
  await rm(logHome, { recursive: true, force: true });
});

function makeHost() {
  const registered: { name: string }[] = [];
  return {
    registered,
    tools: {
      register(definition: unknown) {
        registered.push(definition as { name: string });
        return () => {};
      },
    },
  };
}

describe("dsh-lightrag entry", () => {
  it("identifies itself for the host composition", () => {
    expect(name).toBe("dsh-lightrag");
    expect(inject).toEqual(["tools"]);
    expect(Config).toBe(LightRagConfigSchema);
  });

  it("registers the read tools by default", () => {
    const host = makeHost();
    apply(host, {});
    expect(host.registered.map((tool) => tool.name)).toEqual([
      ...LIGHTRAG_TOOL_NAMES,
    ]);
  });

  it("registers nothing when disabled", () => {
    const host = makeHost();
    apply(host, { enabled: false });
    expect(host.registered).toHaveLength(0);
  });

  it("keeps the write tools out unless writes are enabled", () => {
    const off = makeHost();
    apply(off, {});
    expect(off.registered.map((tool) => tool.name)).not.toContain(
      "dsh_lightrag_delete",
    );

    const on = makeHost();
    apply(on, { writes: { enabled: true } });
    expect(on.registered.map((tool) => tool.name)).toEqual([
      ...LIGHTRAG_TOOL_NAMES,
      ...LIGHTRAG_WRITE_TOOL_NAMES,
    ]);
  });

  it("names every registered tool exactly once", () => {
    const host = makeHost();
    apply(host, { writes: { enabled: true } });
    expect(new Set(host.registered.map((tool) => tool.name)).size).toBe(
      host.registered.length,
    );
  });

  it("supports repeated apply cycles", () => {
    const first = makeHost();
    apply(first, {});
    const second = makeHost();
    apply(second, {
      endpoint: "http://lightrag:9621",
      apiKey: "key",
      timeoutMs: 5_000,
    });
    expect(first.registered).toHaveLength(LIGHTRAG_TOOL_NAMES.length);
    expect(second.registered).toHaveLength(LIGHTRAG_TOOL_NAMES.length);
  });

  it("refuses to apply a configuration that is not a bare origin", () => {
    expect(() =>
      apply(makeHost(), { endpoint: "http://lightrag:9621/api" }),
    ).toThrow(TypeError);
  });

  it("exports the client factory deployments can build on", () => {
    expect(typeof createLightRagClient).toBe("function");
  });

  it("replaces clients, limits and tool registrations on a live settings update", async () => {
    let current: LightRagConfig = { endpoint: "http://kb.example.com:9621" };
    const live = Object.fromEntries(
      [
        "enabled",
        "endpoint",
        "apiKey",
        "timeoutMs",
        "query",
        "documents",
        "writes",
      ].map((key) => [
        key,
        { get: () => current[key as keyof LightRagConfig] },
      ]),
    ) as LiveLightRagConfig;
    const active = new Map<
      string,
      ReturnType<typeof createLightRagQueryTool>
    >();
    let update: () => void = () => {
      throw new Error("No update listener");
    };
    const host = {
      tools: {
        register(definition: unknown) {
          const tool = definition as ReturnType<typeof createLightRagQueryTool>;
          active.set(tool.name, tool);
          return () => {
            active.delete(tool.name);
          };
        },
      },
      on(_event: "loader/volatile-update", listener: () => void) {
        update = listener;
        return () => {};
      },
    };
    const stub = createFetchStub(() =>
      jsonResponse({
        response: "a".repeat(2000),
        references: [],
        llm_generated: true,
      }),
    );
    vi.stubGlobal("fetch", stub.fetch);
    apply(host, live);
    const first = active.get("dsh_lightrag_query")!;
    await first.execute(
      { question: "What is in the knowledge base?" },
      makeExec(),
    );
    current = {
      endpoint: "https://kb.example.com",
      apiKey: "synthetic-test-key",
      timeoutMs: 2500,
      query: { topK: 7, mode: "hybrid", maxAnswerBytes: 1024 },
      writes: { enabled: true },
    };
    const timeout = vi.spyOn(globalThis, "setTimeout");
    update();
    expect(active.size).toBe(6);
    expect(active.get("dsh_lightrag_query")).not.toBe(first);
    const result = (await active
      .get("dsh_lightrag_query")!
      .execute(
        { question: "What is in the knowledge base?" },
        makeExec(),
      )) as LightRagQueryResult;
    expect(stub.calls[0]?.url).toBe("http://kb.example.com:9621/query");
    expect(stub.calls[1]?.url).toBe("https://kb.example.com/query");
    expect(stub.calls[1]?.headers["x-api-key"]).toBe("synthetic-test-key");
    expect(stub.calls[1]?.body).toMatchObject({ top_k: 7, mode: "hybrid" });
    expect(result.truncated).toBe(true);
    expect(result.answer).toBe(
      `${"a".repeat(1024)}\n\n[dsh-lightrag: answer truncated at 1024 bytes]`,
    );
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 2500);
    timeout.mockRestore();
    current = { writes: { enabled: false } };
    update();
    expect([...active.keys()]).toEqual(LIGHTRAG_TOOL_NAMES);
    current = { enabled: false };
    update();
    expect(active.size).toBe(0);
    current = { enabled: true };
    update();
    expect([...active.keys()]).toEqual(LIGHTRAG_TOOL_NAMES);
  });
});
