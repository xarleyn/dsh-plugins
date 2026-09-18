import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import { stubProviderSet } from "./helpers/document-providers.js";

export let workspace: string;

beforeEach(async () => {
  workspace = path.join(
    tmpdir(),
    `qa-docs-compare-sec-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

export function runtime(
  config: Parameters<typeof resolveDocumentsConfig>[0] = {},
  options: { readonly clock?: () => Date } = {},
): DocumentRuntime {
  return new DocumentRuntime({
    config: resolveDocumentsConfig(config),
    providers: stubProviderSet().providers,
    now: options.clock ?? (() => new Date("2026-09-14T10:00:00Z")),
  });
}

export function exec(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: workspace, id: "session-1" } } },
  } as unknown as ToolRunContext;
}

export async function compare(
  instance: DocumentRuntime,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const definition = createDocumentTools({ runtime: instance }).find(
    (entry) => entry.name === "document_compare",
  );
  if (definition === undefined) throw new Error("document_compare is missing");
  return (await definition.execute({ left, right }, exec())) as Record<
    string,
    unknown
  >;
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

export async function write(
  name: string,
  content: string | Buffer,
): Promise<string> {
  const target = path.join(workspace, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return name;
}
