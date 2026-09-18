import { mkdir, rm, writeFile } from "node:fs/promises";
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
  workspace = path.join(
    tmpdir(),
    `qa-docs-convert-${process.pid}-${Date.now()}`,
  );
  await mkdir(workspace, { recursive: true });
  stub = stubProviderSet();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

export function runtime(
  options: {
    providers?: StubProviders;
    config?: Parameters<typeof resolveDocumentsConfig>[0];
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

export async function writeInput(
  name: string,
  content: Buffer | string,
): Promise<string> {
  const target = path.join(workspace, name);
  await writeFile(target, content);
  return target;
}
