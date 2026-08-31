import type { SessionEvent, SessionHeader } from "@deepseek-ai/dsh-session";

export function header(id = "session-1", cwd = "C:\\work\\project"): SessionHeader {
  return {
    version: 0,
    id,
    createdAt: 1_700_000_000_000,
    cwd,
  } as SessionHeader;
}

export function userEvent(
  seq: number,
  text: string,
  source: "user" | "plugin" = "user",
): SessionEvent {
  return {
    type: "user/message",
    seq,
    time: 1_700_000_000_000 + seq,
    data: {
      id: `message-${seq}`,
      role: "user",
      content: [{ type: "text", text }],
      source:
        source === "user" ? { kind: "user" } : { kind: "plugin", plugin: "fixture" },
    },
    surfaceOp: "append",
  } as unknown as SessionEvent;
}

export function assistantEvent(seq: number, text: string): SessionEvent {
  return {
    type: "assistant/message",
    seq,
    time: 1_700_000_000_000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `message-${seq}`,
        role: "assistant",
        content: [{ type: "text", text }],
        source: { kind: "model", provider: "fixture", model: "fixture" },
      },
    },
    surfaceOp: "append",
  } as unknown as SessionEvent;
}

export function toolCallEvent(seq: number, name: string, args: string): SessionEvent {
  return {
    type: "tool/call",
    seq,
    time: 1_700_000_000_000 + seq,
    data: { turn: 1, step: 1, callId: `call-${seq}`, name, arguments: args },
  } as unknown as SessionEvent;
}

export function toolResultEvent(seq: number, text: string): SessionEvent {
  return {
    type: "tool/result",
    seq,
    time: 1_700_000_000_000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `message-${seq}`,
        role: "user",
        source: { kind: "tool", callId: `call-${seq - 1}` },
        content: [
          {
            type: "tool-result",
            toolCallId: `call-${seq - 1}`,
            content: [{ type: "text", text }],
          },
        ],
      },
    },
    surfaceOp: "append",
  } as unknown as SessionEvent;
}
