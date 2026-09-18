import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import {
  stubProviderSet,
  type StubProviders,
} from "./helpers/document-providers.js";

export let workspace: string;
export let stub: StubProviders;
export const FIXED_NOW = new Date("2026-09-14T10:00:00Z");

beforeEach(async () => {
  workspace = await path.join(
    tmpdir(),
    `qa-docs-create-${process.pid}-${Date.now()}`,
  );
  await mkdir(workspace, { recursive: true });
  stub = stubProviderSet();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

export function runtime(
  options: {
    readonly providers?: StubProviders;
    readonly config?: Parameters<typeof resolveDocumentsConfig>[0];
  } = {},
): DocumentRuntime {
  return new DocumentRuntime({
    config: resolveDocumentsConfig(options.config ?? {}),
    providers: (options.providers ?? stub).providers,
    now: () => FIXED_NOW,
  });
}

export const scope = (): { workspaceRoot: string; sessionId: string } => ({
  workspaceRoot: workspace,
  sessionId: "session-1",
});

export async function readJson(
  filePath: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<
    string,
    unknown
  >;
}
