import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import {
  QA_REPORT_SOURCES_TOOL,
  QaProvenanceHost,
} from "../src/provenance/host-store.js";
import { resolveConfig } from "../src/resolve-config.js";

type Listener = (...args: never[]) => unknown;

function event(type: string, data: unknown, seq: number) {
  return { type, data, seq, time: seq };
}

function readEvents(path: string) {
  return [
    event("turn/start", { turn: 1 }, 0),
    event(
      "tool/call",
      {
        turn: 1,
        step: 1,
        callId: "call-1",
        name: "read",
        arguments: JSON.stringify({ file_path: path }),
      },
      1,
    ),
    event(
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: {
          content: [
            {
              type: "tool_result",
              callId: "call-1",
              isError: false,
              content: [{ type: "text", text: "# Guide" }],
            },
          ],
        },
        meta: {
          card: "read",
          path,
          lines: [{ number: 7, text: "# Guide" }],
          totalLines: 20,
          lang: "md",
        },
      },
      2,
    ),
  ];
}

function fakeSession(
  id: string,
  events: ReturnType<typeof event>[],
  parentSession?: string,
) {
  const appended: { type: string; data: unknown }[] = [];
  const session = {
    id,
    header: {
      id,
      createdAt: 1,
      cwd: "D:/repo",
      ...(parentSession === undefined
        ? {}
        : { parentSession, origin: "subagent" as const }),
    },
    snapshotEvents: () => events,
    append: (type: string, data: unknown) => {
      appended.push({ type, data });
      return event(type, data, events.length + appended.length);
    },
  } as unknown as Session;
  return { session, appended };
}

function harness(sessions: Session[], initiatorId = "root") {
  const listeners = new Map<string, Listener[]>();
  let tool: ToolDefinition | undefined;
  const byId = new Map(
    sessions.map((session) => [String(session.id), session]),
  );
  const agents = new Map(
    sessions.map((session) => [
      String(session.id),
      { id: session.id, session },
    ]),
  );
  const ctx = {
    sessions: {
      list: () => sessions,
      get: (id: string) => byId.get(String(id)),
    },
    agents: {
      get: (id: string) => agents.get(String(id)),
      currentInitiator: () => agents.get(initiatorId),
    },
    tools: {
      register: (definition: ToolDefinition) => {
        tool = definition;
        return () => undefined;
      },
    },
    on: (name: string, listener: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return () => undefined;
    },
  } as unknown as Context;
  const emit = (name: string, ...args: unknown[]) => {
    for (const listener of listeners.get(name) ?? [])
      listener(...(args as never[]));
  };
  return { ctx, emit, getTool: () => tool };
}

describe("Host provenance lifecycle", () => {
  it("replays a previously materialized qa/sources snapshot", () => {
    const bundle = {
      version: 1 as const,
      sessionId: "root",
      turn: 1,
      complete: true,
      sources: [
        {
          id: "web:https://example.com/guide",
          kind: "web" as const,
          title: "Guide",
          uri: "https://example.com/guide",
          locations: [],
          evidence: "fetched" as const,
          origins: [
            {
              sessionId: "root",
              turn: 1,
              role: "parent" as const,
            },
          ],
          score: 100,
        },
      ],
    };
    const root = fakeSession("root", [event("qa/sources", bundle, 0)]);
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    expect(host.bundles("root")).toEqual([bundle]);
    host.dispose();
  });

  it("replays durable tool metadata and materializes qa/sources", () => {
    const root = fakeSession("root", readEvents("D:/repo/docs/guide.md"));
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    expect(host.bundles("root")).toMatchObject([
      {
        sessionId: "root",
        turn: 1,
        sources: [
          {
            id: "file:docs/guide.md",
            locations: [{ path: "docs/guide.md", lineStart: 7, lineEnd: 7 }],
          },
        ],
      },
    ]);

    world.emit("agent/turn-stopping", {
      agent: { id: "root", session: root.session },
      turn: 1,
    });
    expect(root.appended).toEqual([
      expect.objectContaining({
        type: "qa/sources",
        data: expect.objectContaining({ turn: 1 }),
      }),
    ]);
    host.dispose();
  });

  it("bubbles nested observable child sources to the root turn", () => {
    const root = fakeSession("root", [event("turn/start", { turn: 4 }, 0)]);
    const childA = fakeSession(
      "child-a",
      [event("turn/start", { turn: 1 }, 0)],
      "root",
    );
    const childB = fakeSession(
      "child-b",
      readEvents("D:/repo/docs/nested.md"),
      "child-a",
    );
    const world = harness([root.session, childA.session, childB.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    world.emit("subagent/start", {
      runId: "run-a",
      provider: "local",
      id: "child-a",
      local: true,
    });
    world.emit("subagent/start", {
      runId: "run-b",
      provider: "local",
      id: "child-b",
      local: true,
    });
    world.emit("subagent/end", {
      runId: "run-b",
      provider: "local",
      id: "child-b",
      local: true,
    });

    expect(host.bundles("root")[0]).toMatchObject({
      turn: 4,
      sources: [
        {
          id: "file:docs/nested.md",
          evidence: "inherited",
          origins: [
            {
              role: "subagent",
              subagentRunId: "run-b",
              subagentSessionId: "child-b",
            },
          ],
        },
      ],
    });
    host.dispose();
  });

  it("accepts opaque reports and marks missing reports incomplete", async () => {
    const root = fakeSession("root", [event("turn/start", { turn: 2 }, 0)]);
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    world.emit("subagent/start", {
      runId: "run-reported",
      provider: "remote",
      id: "opaque-1",
      local: false,
    });
    const tool = world.getTool();
    expect(tool?.name).toBe(QA_REPORT_SOURCES_TOOL);
    await tool?.execute(
      {
        sources: [
          {
            kind: "web",
            title: "Remote docs",
            uri: "https://example.com/docs?utm_source=agent",
          },
        ],
      },
      { agent: { id: "opaque-1" }, callId: "report-1" } as never,
    );
    world.emit("subagent/end", {
      runId: "run-reported",
      provider: "remote",
      id: "opaque-1",
      local: false,
    });
    expect(host.bundles("root")[0]).toMatchObject({
      complete: true,
      sources: [{ id: "web:https://example.com/docs", evidence: "reported" }],
    });

    world.emit("subagent/start", {
      runId: "run-missing",
      provider: "remote",
      id: "opaque-2",
      local: false,
    });
    world.emit("subagent/end", {
      runId: "run-missing",
      provider: "remote",
      id: "opaque-2",
      local: false,
    });
    expect(host.bundles("root")[0]).toMatchObject({
      complete: false,
      incompleteOrigins: [{ subagentRunId: "run-missing", provider: "remote" }],
    });
    host.dispose();
  });
});
