import type {
  AssistantMessageNode,
  ConversationSnapshot,
  RunningToolCall,
  ToolResultNode,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { QaMessage, QaWorkItem } from "../types.js";

interface OrderedWorkItem {
  readonly order: number;
  readonly item: QaWorkItem;
}

interface QaMessageStats {
  readonly durationMs: number;
  readonly ttftMs: number | null;
  readonly tokensPerSecond: number | null;
}

interface TextMessage {
  readonly id: string;
  readonly order: number;
  readonly text: string;
  readonly status: "streaming" | "committed";
  readonly timestamp?: number;
  readonly stats?: QaMessageStats;
}

interface TurnBuffer {
  readonly turn: number;
  readonly text: TextMessage[];
  readonly work: OrderedWorkItem[];
}

interface ToolHead {
  readonly turn: number;
  readonly order: number;
  readonly name: string;
  readonly argsRaw: string;
  readonly time: number;
}

interface OrderedMessage {
  readonly order: number;
  readonly message: QaMessage;
}

function visibleContentText(content: readonly unknown[]): string {
  return content
    .flatMap((block) => {
      if (typeof block !== "object" || block === null) return [];
      return Reflect.get(block, "type") === "text" &&
        typeof Reflect.get(block, "text") === "string"
        ? [Reflect.get(block, "text") as string]
        : [];
    })
    .join("");
}

function visibleAssistantText(
  blocks: readonly { readonly kind: string; readonly text?: string }[],
): string {
  return blocks
    .filter(
      (block): block is { readonly kind: "text"; readonly text: string } =>
        block.kind === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

function flattenToolOutput(node: ToolResultNode): string | null {
  const parts = node.content.map((block) =>
    block.type === "text" ? block.text : JSON.stringify(block, null, 2),
  );
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`);
  }
  return parts.join("\n") || null;
}

function formatToolInput(argsRaw: string): string | null {
  if (argsRaw === "") return null;
  try {
    return JSON.stringify(JSON.parse(argsRaw), null, 2);
  } catch {
    return argsRaw;
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u, 1)[0]?.trim() ?? "";
}

function truncate(value: string, length = 140): string {
  return value.length <= length ? value : `${value.slice(0, length - 3)}...`;
}

function toolSummary(name: string, argsRaw: string): string {
  try {
    const parsed = JSON.parse(argsRaw) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const values = parsed as Record<string, unknown>;
      for (const key of [
        "description",
        "path",
        "file_path",
        "query",
        "pattern",
        "url",
        "command",
      ]) {
        const value = values[key];
        if (typeof value === "string" && value.trim() !== "") {
          return truncate(firstLine(value));
        }
      }
      const fallback = Object.values(values).find(
        (value): value is string =>
          typeof value === "string" && value.trim() !== "",
      );
      if (fallback !== undefined) return truncate(firstLine(fallback));
    }
  } catch {
    const raw = firstLine(argsRaw);
    if (raw !== "") return truncate(raw);
  }
  return name;
}

const TOOL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  bash: "Bash",
  pwsh: "PowerShell",
  read: "Чтение",
  web_fetch: "Загрузка",
  web_search: "Поиск",
  grep: "Поиск",
  glob: "Поиск",
  write: "Запись",
  edit: "Правка",
  str_replace_editor: "Правка",
  run_code: "Код",
});

function toolLabel(name: string): string {
  return (TOOL_LABELS[name] ?? name.replaceAll("_", " ")) || "Инструмент";
}

function toolStatus(node: ToolResultNode): "ok" | "error" | "stopped" {
  if (node.error?.code === "interrupted") return "stopped";
  return node.isError ? "error" : "ok";
}

/**
 * Response timing for the message row, straight from the host-recorded step
 * boundaries. Tokens per second is an estimate — the client never sees a
 * token-count contract, so visible text is measured at the usual ≈4
 * characters per token over the generation window (first token → completed).
 */
function messageStats(
  text: string,
  timing: AssistantMessageNode["timing"],
): QaMessageStats | undefined {
  if (timing === undefined) return undefined;
  const start = timing.stepStartTime;
  const first = timing.firstTokenTime;
  const end = timing.completedTime;
  if (start === null && first === null) return undefined;
  const durationMs =
    start === null
      ? Math.max(0, end - (first ?? end))
      : Math.max(0, end - start);
  const ttftMs =
    start === null || first === null ? null : Math.max(0, first - start);
  let tokensPerSecond: number | null = null;
  if (first !== null && end > first && text.length > 0) {
    tokensPerSecond = Math.round(text.length / 4 / ((end - first) / 1_000));
  }
  return { durationMs, ttftMs, tokensPerSecond };
}

function workTool(
  callId: string,
  name: string,
  argsRaw: string,
  status: "running" | "ok" | "error" | "stopped",
  startedAt: number | undefined,
  endedAt: number | undefined,
  output: string | null,
): QaWorkItem {
  return {
    id: `tool:${callId}`,
    kind: "tool",
    name,
    label: toolLabel(name),
    summary: toolSummary(name, argsRaw),
    input: formatToolInput(argsRaw),
    output,
    status,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
  };
}

function getTurn(turns: Map<number, TurnBuffer>, turn: number): TurnBuffer {
  let buffer = turns.get(turn);
  if (buffer === undefined) {
    buffer = { turn, text: [], work: [] };
    turns.set(turn, buffer);
  }
  return buffer;
}

function collectAssistant(
  node: AssistantMessageNode,
  turns: Map<number, TurnBuffer>,
  toolHeads: Map<string, ToolHead>,
  showReasoning: boolean,
): void {
  const turn = getTurn(turns, node.turn);
  const text = visibleAssistantText(node.blocks);
  if (text !== "") {
    turn.text.push({
      id: `assistant:${node.messageId ?? node.seq}`,
      order: node.seq,
      text,
      status: "committed",
      timestamp: node.time,
      stats: messageStats(text, node.timing),
    });
  }
  node.blocks.forEach((block, index) => {
    const order = node.seq + index / 1_000;
    if (block.kind === "reasoning" && showReasoning && block.text.trim()) {
      turn.work.push({
        order,
        item: {
          id: `reasoning:${node.messageId ?? node.seq}:${index}`,
          kind: "reasoning",
          text: block.text,
          status: "complete",
        },
      });
    } else if (block.kind === "tool-call" && block.callId !== "") {
      toolHeads.set(block.callId, {
        turn: node.turn,
        order,
        name: block.name,
        argsRaw: block.argsRaw,
        time: node.time,
      });
    }
  });
}

function collectSettledTools(
  snapshot: ConversationSnapshot,
  turns: Map<number, TurnBuffer>,
  toolHeads: Map<string, ToolHead>,
): Set<string> {
  const settled = new Set<string>();
  let nearestTurn: number | undefined;
  for (const node of snapshot.nodes) {
    if (node.kind === "assistant") nearestTurn = node.turn;
    if (node.kind !== "tool-result") continue;
    const head = toolHeads.get(node.callId);
    const turnNumber = head?.turn ?? nearestTurn;
    if (turnNumber === undefined) continue;
    const name = head?.name ?? node.call?.name ?? node.callId;
    const argsRaw = head?.argsRaw ?? node.call?.argsRaw ?? "";
    getTurn(turns, turnNumber).work.push({
      order: head?.order ?? node.seq,
      item: workTool(
        node.callId,
        name,
        argsRaw,
        toolStatus(node),
        node.callTime ?? head?.time,
        node.time,
        flattenToolOutput(node),
      ),
    });
    settled.add(node.callId);
  }
  return settled;
}

function collectRunningTool(
  call: RunningToolCall,
  turns: Map<number, TurnBuffer>,
  toolHeads: Map<string, ToolHead>,
): void {
  const head = toolHeads.get(call.callId);
  getTurn(turns, call.turn).work.push({
    order: head?.order ?? Number.MAX_SAFE_INTEGER - call.time,
    item: workTool(
      call.callId,
      call.name,
      call.argsRaw,
      "running",
      call.time,
      undefined,
      null,
    ),
  });
}

function emitTurn(
  snapshot: ConversationSnapshot,
  turn: TurnBuffer,
  output: OrderedMessage[],
): void {
  const timing = snapshot.turnTimings.get(turn.turn);
  const completed =
    timing?.endTime !== undefined || snapshot.turnEnds.has(turn.turn);
  const sortedText = [...turn.text].sort(
    (left, right) => left.order - right.order,
  );
  const partial = sortedText.find((message) => message.status === "streaming");
  const committed = sortedText.filter(
    (message) => message.status === "committed",
  );
  const hasVisibleActiveWork =
    snapshot.running &&
    !completed &&
    turn.work.some(({ item }) => item.status === "running");
  const finalText =
    partial ?? (hasVisibleActiveWork ? undefined : committed.at(-1));
  const progress =
    finalText === undefined
      ? committed
      : committed.filter((message) => message !== finalText);
  for (const message of progress) {
    turn.work.push({
      order: message.order,
      item: {
        id: `progress:${message.id}`,
        kind: "progress",
        text: message.text,
        status: "complete",
      },
    });
  }

  if (turn.work.length > 0) {
    const items = [...turn.work]
      .sort((left, right) => left.order - right.order)
      .map(({ item }) => item);
    const workOrder = Math.min(
      ...turn.work.map(({ order }) => order),
      (finalText?.order ?? Number.MAX_SAFE_INTEGER) - 0.001,
    );
    output.push({
      order: workOrder,
      message: {
        id: `work:${turn.turn}`,
        role: "work",
        turn: turn.turn,
        status: completed || !snapshot.running ? "complete" : "running",
        ...(timing?.startTime === undefined
          ? {}
          : { startedAt: timing.startTime }),
        ...(timing?.endTime === undefined ? {} : { endedAt: timing.endTime }),
        items,
      },
    });
  } else {
    for (const message of progress) {
      output.push({
        order: message.order,
        message: {
          id: message.id,
          role: "assistant",
          text: message.text,
          status: message.status,
          ...(message.timestamp === undefined
            ? {}
            : { timestamp: message.timestamp }),
          ...(message.stats === undefined ? {} : { stats: message.stats }),
        },
      });
    }
  }

  if (finalText !== undefined) {
    output.push({
      order: finalText.order,
      message: {
        id: finalText.id,
        role: "assistant",
        text: finalText.text,
        status: finalText.status,
        ...(finalText.timestamp === undefined
          ? {}
          : { timestamp: finalText.timestamp }),
        ...(finalText.stats === undefined ? {} : { stats: finalText.stats }),
      },
    });
  }
}

/** Project end-user messages plus optional operator-approved work detail. */
export function projectTranscript(
  snapshot: ConversationSnapshot,
  options: {
    readonly showToolActivity?: boolean;
    readonly showReasoning?: boolean;
  } = {},
): readonly QaMessage[] {
  const output: OrderedMessage[] = [];
  const turns = new Map<number, TurnBuffer>();
  const toolHeads = new Map<string, ToolHead>();

  for (const node of snapshot.nodes) {
    if (node.kind === "user" || node.kind === "steering") {
      const text = visibleContentText(node.content);
      if (text !== "") {
        output.push({
          order: node.seq,
          message: {
            id: `${node.kind}:${node.seq}`,
            role: "user",
            text,
            status: "committed",
            timestamp: node.time,
          },
        });
      }
    } else if (node.kind === "assistant") {
      collectAssistant(node, turns, toolHeads, options.showReasoning === true);
    } else if (node.kind === "turn-error") {
      output.push({
        order: node.seq,
        message: {
          id: `turn-error:${node.seq}`,
          role: "system",
          text: "Помощнику не удалось завершить ответ.",
          status: "error",
          timestamp: node.time,
        },
      });
    } else if (node.kind === "turn-max-tokens") {
      output.push({
        order: node.seq,
        message: {
          id: `turn-max-tokens:${node.seq}`,
          role: "system",
          text: "Ответ достиг предельной длины.",
          status: "info",
          timestamp: node.time,
        },
      });
    }
  }

  if (options.showToolActivity === true) {
    const settled = collectSettledTools(snapshot, turns, toolHeads);
    for (const call of snapshot.runningCalls) {
      if (!settled.has(call.callId)) {
        collectRunningTool(call, turns, toolHeads);
      }
    }
  }

  if (snapshot.partial !== null) {
    const partialTurn = getTurn(turns, snapshot.partial.turn);
    const text = visibleAssistantText(snapshot.partial.blocks);
    if (text !== "") {
      partialTurn.text.push({
        id: `assistant:partial:${snapshot.partial.turn}:${snapshot.partial.step}`,
        order: Number.MAX_SAFE_INTEGER - 1,
        text,
        status: "streaming",
      });
    }
    snapshot.partial.blocks.forEach((block, index) => {
      if (
        block.kind === "reasoning" &&
        options.showReasoning === true &&
        block.text.trim()
      ) {
        partialTurn.work.push({
          order: Number.MAX_SAFE_INTEGER - 10 + index / 1_000,
          item: {
            id: `reasoning:partial:${snapshot.partial?.turn}:${snapshot.partial?.step}:${index}`,
            kind: "reasoning",
            text: block.text,
            status: "running",
          },
        });
      } else if (
        block.kind === "tool-call" &&
        options.showToolActivity === true &&
        block.callId !== "" &&
        !snapshot.runningCalls.some((call) => call.callId === block.callId)
      ) {
        partialTurn.work.push({
          order: Number.MAX_SAFE_INTEGER - 9 + index / 1_000,
          item: workTool(
            block.callId,
            block.name,
            block.argsRaw,
            "running",
            undefined,
            undefined,
            null,
          ),
        });
      }
    });
  }

  for (const turn of turns.values()) emitTurn(snapshot, turn, output);
  return output
    .sort((left, right) => left.order - right.order)
    .map(({ message }) => message);
}
