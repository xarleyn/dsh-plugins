import type { ToolResultNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { QaWorkItem } from "../types.js";

function firstLine(value: string): string {
  return value.split(/\r?\n/u, 1)[0]?.trim() ?? "";
}

function truncate(value: string, length = 140): string {
  return value.length <= length ? value : `${value.slice(0, length - 3)}...`;
}

export function flattenToolOutput(node: ToolResultNode): string | null {
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
  subagent: "Субагент",
  subagent_fork: "Субагент (форк)",
  send_message: "Сообщение агенту",
  list_agents: "Список агентов",
  interrupt_agent: "Остановка агента",
});

/** The durable id a continuable launch reports back ("started subagent <id>"). */
const SUBAGENT_STARTED = /started subagent ([0-9a-f][0-9a-f-]*)/iu;

function toolLabel(name: string): string {
  return (TOOL_LABELS[name] ?? name.replaceAll("_", " ")) || "Инструмент";
}

export function toolStatus(node: ToolResultNode): "ok" | "error" | "stopped" {
  if (node.error?.code === "interrupted") return "stopped";
  return node.isError ? "error" : "ok";
}

export function workTool(
  callId: string,
  name: string,
  argsRaw: string,
  status: "running" | "ok" | "error" | "stopped",
  startedAt: number | undefined,
  endedAt: number | undefined,
  output: string | null,
): QaWorkItem {
  const launched =
    name === "subagent" || name === "subagent_fork"
      ? (SUBAGENT_STARTED.exec(output ?? "")?.[1] ??
        SUBAGENT_STARTED.exec(argsRaw)?.[1])
      : undefined;
  return {
    id: `tool:${callId}`,
    kind: "tool",
    name,
    label: toolLabel(name),
    summary: toolSummary(name, argsRaw),
    input: formatToolInput(argsRaw),
    output,
    status,
    ...(launched === undefined ? {} : { subagentId: launched }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
  };
}
