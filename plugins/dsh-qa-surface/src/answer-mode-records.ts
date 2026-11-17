import {
  appendPluginRecord,
  pluginRecordOf,
  type Session,
  type SessionEvent,
} from "@deepseek-ai/dsh-session";
import type { QaAnswerMode } from "./shared/answer-modes.js";

export interface RequestModes {
  readonly requestId: string;
  readonly by: "rpc" | "message";
  readonly modes: readonly QaAnswerMode[];
}
export interface TurnModes {
  readonly turn: number;
  readonly modes: readonly QaAnswerMode[];
  readonly requests: readonly string[];
  readonly approved: boolean;
  readonly declined: boolean;
}
interface ModeData {
  "qa/answer-modes": RequestModes;
  "qa/answer-mode-turn": TurnModes;
  "qa/answer-mode-command": {
    readonly id: string;
    readonly modes: readonly QaAnswerMode[];
  };
  "qa/answer-mode-command-done": { readonly id: string };
}
type ModeName = keyof ModeData;
export type ModeInput = {
  [K in ModeName]: readonly [K, ModeData[K]];
}[ModeName];

declare module "@deepseek-ai/dsh-session" {
  // Legacy records are read only, after the offline repair marks them ignorable.
  interface SessionEventMap {
    "qa/answer-modes": ModeData["qa/answer-modes"];
    "qa/answer-mode-turn": ModeData["qa/answer-mode-turn"];
    "qa/answer-mode-command": ModeData["qa/answer-mode-command"];
    "qa/answer-mode-command-done": ModeData["qa/answer-mode-command-done"];
  }
  interface PluginRecordMap {
    "plugin:dsh-qa-surface/answer-modes": RequestModes;
    "plugin:dsh-qa-surface/answer-mode-turn": TurnModes;
    "plugin:dsh-qa-surface/answer-mode-command": ModeData["qa/answer-mode-command"];
    "plugin:dsh-qa-surface/answer-mode-command-done": ModeData["qa/answer-mode-command-done"];
  }
}

const names = {
  "qa/answer-modes": "plugin:dsh-qa-surface/answer-modes",
  "qa/answer-mode-turn": "plugin:dsh-qa-surface/answer-mode-turn",
  "qa/answer-mode-command": "plugin:dsh-qa-surface/answer-mode-command",
  "qa/answer-mode-command-done":
    "plugin:dsh-qa-surface/answer-mode-command-done",
} as const;

function validate(name: ModeName, data: unknown): void {
  if (typeof data !== "object" || data === null)
    throw new Error("Invalid saved QA answer modes.");
  const value = data as Record<string, unknown>;
  const modes = () =>
    Array.isArray(value.modes) &&
    value.modes.length > 0 &&
    value.modes.every(
      (mode) => mode === "fast" || mode === "deep" || mode === "rag",
    );
  const id = () => typeof value.id === "string" && value.id.length > 0;
  const valid =
    name === "qa/answer-modes"
      ? typeof value.requestId === "string" &&
        value.requestId.length > 0 &&
        (value.by === "rpc" || value.by === "message") &&
        modes()
      : name === "qa/answer-mode-turn"
        ? Number.isSafeInteger(value.turn) &&
          (value.turn as number) >= 0 &&
          modes() &&
          Array.isArray(value.requests) &&
          value.requests.every((id) => typeof id === "string") &&
          typeof value.approved === "boolean" &&
          typeof value.declined === "boolean" &&
          !(value.approved && value.declined)
        : name === "qa/answer-mode-command"
          ? id() && modes()
          : id();
  if (!valid) throw new Error("Invalid saved QA answer modes.");
}

/** Native opaque records survive replay without entering the model-visible surface. */
export function appendMode(session: Session, ...input: ModeInput): void {
  validate(input[0], input[1]);
  switch (input[0]) {
    case "qa/answer-modes":
      appendPluginRecord(session, names[input[0]], input[1]);
      break;
    case "qa/answer-mode-turn":
      appendPluginRecord(session, names[input[0]], input[1]);
      break;
    case "qa/answer-mode-command":
      appendPluginRecord(session, names[input[0]], input[1]);
      break;
    case "qa/answer-mode-command-done":
      appendPluginRecord(session, names[input[0]], input[1]);
      break;
  }
}

/** Validate the whole group before publishing; a crash prefix is recovered by its command intent. */
export function appendModes(
  session: Session,
  inputs: readonly ModeInput[],
): void {
  for (const input of inputs) validate(input[0], input[1]);
  for (const input of inputs) appendMode(session, ...input);
}

/** Keep the policy's legacy discriminants while preserving each native event envelope. */
export function modeEvents(
  session: Pick<Session, "snapshotEvents">,
): readonly SessionEvent[] {
  return session.snapshotEvents().map((event) => {
    if (String(event.type).startsWith("qa/answer-mode")) {
      if (!(event.type in names))
        throw new Error("Unknown saved QA answer modes.");
      validate(event.type as ModeName, event.data);
      return event;
    }
    const record = pluginRecordOf(event);
    if (record === undefined) return event;
    const name = (Object.keys(names) as ModeName[]).find(
      (name) => names[name] === record.type,
    );
    if (name === undefined) {
      if (record.type.startsWith("plugin:dsh-qa-surface/answer-mode"))
        throw new Error("Unknown saved QA answer modes.");
      return event;
    }
    validate(name, record.data);
    return { ...event, type: name, data: record.data } as SessionEvent;
  });
}
