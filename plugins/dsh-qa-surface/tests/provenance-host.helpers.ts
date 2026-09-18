import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
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
      list: () => [...byId.values()],
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
  /** Remove a session from the registry, then announce the disposal. */
  const forgetSession = (id: string): void => {
    const session = byId.get(id);
    byId.delete(id);
    agents.delete(id);
    emit("session/disposed", session ?? { id });
  };
  return { ctx, emit, forgetSession, getTool: () => tool };
}

export { event, fakeSession, harness, readEvents };
