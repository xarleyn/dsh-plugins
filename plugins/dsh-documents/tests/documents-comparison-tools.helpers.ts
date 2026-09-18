import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import {
  stubProviderSet,
  type StubProviders,
} from "./helpers/document-providers.js";

export let workspace: string;
export let stub: StubProviders;

export const CONTRACT_BEFORE = [
  "# Договор оказания услуг",
  "",
  "## 5. Стоимость",
  "",
  "## 5.2 Порядок оплаты",
  "",
  "Оплата производится в течение 10 рабочих дней.",
  "",
  "## 6. Ответственность",
  "",
  "Исполнитель несёт ответственность за убытки.",
  "",
].join("\n");

export const CONTRACT_AFTER = [
  "# Договор оказания услуг",
  "",
  "## 5. Стоимость",
  "",
  "## 5.2 Порядок оплаты",
  "",
  "Оплата производится в течение 30 календарных дней.",
  "",
  "## 6. Ответственность",
  "",
  "Исполнитель не несёт ответственности за убытки.",
  "",
  "## 7. Прочие условия",
  "",
  "Договор вступает в силу с момента подписания.",
  "",
].join("\n");

beforeEach(async () => {
  workspace = path.join(
    tmpdir(),
    `qa-docs-compare-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(workspace, { recursive: true });
  stub = stubProviderSet();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

export function runtime(
  config: Parameters<typeof resolveDocumentsConfig>[0] = {},
): DocumentRuntime {
  return new DocumentRuntime({
    config: resolveDocumentsConfig(config),
    providers: stub.providers,
    now: () => new Date("2026-09-14T10:00:00Z"),
  });
}

export function tool(
  runtimeInstance: DocumentRuntime,
  name: string,
): ToolDefinition {
  const definition = createDocumentTools({ runtime: runtimeInstance }).find(
    (entry) => entry.name === name,
  );
  if (definition === undefined)
    throw new Error(`tool ${name} is not registered`);
  return definition;
}

export function exec(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: {
      session: { header: { cwd: workspace, id: "session-1" } },
    },
  } as unknown as ToolRunContext;
}

export async function run(
  runtimeInstance: DocumentRuntime,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await tool(runtimeInstance, name).execute(args, exec())) as Record<
    string,
    unknown
  >;
}

export async function write(
  name: string,
  content: string | Buffer,
): Promise<string> {
  const target = path.join(workspace, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return name;
}

export function artifactRoot(): string {
  return path.join(workspace, ".qa", "artifacts", "documents");
}

export async function errorOf(body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (error) {
    if (error instanceof DocumentError) return error.code;
    throw error;
  }
  throw new Error("the call did not fail");
}
