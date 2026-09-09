/**
 * DSH integration seam (SPEC §8, §26).
 *
 * Current `@deepseek-ai/dsh-tools` re-derives the model-facing `content` of a
 * successful result from its canonical `value` after the `tools/execute`
 * waterfall and validates it against the tool's output schema, so replacing
 * `value` there would either be ignored or break the tool. The plugin
 * therefore subscribes to `tools/post-execute`, which is the registry's
 * supported result-reshaping seam: scanning still operates on the canonical
 * `result.value` (SPEC §8), while the accepted decision replaces only the
 * model-facing `content` with the bounded preview. `value` stays canonical
 * for execution-local consumers; durable session events never carry it.
 *
 * Every failure inside the transformation is contained: the downstream
 * decision (the original result) passes through unchanged (SPEC §26).
 */

import { Buffer } from "node:buffer";

import type { PostToolDecision, ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";

import type { ResolvedCasResultsConfig } from "../config.js";
import { transformValue, type JsonValue } from "../transform/scan-value.js";
import { CasCounters } from "../observability/counters.js";
import type { CasStore } from "../cas/types.js";
import type { PluginLoggerLike } from "../logging.js";
import { isOwnToolName, resolveToolPolicy } from "./policies.js";

export type CasPostExecuteListener = (
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
) => Promise<PostToolDecision>;

export interface PostExecuteListenerOptions {
  readonly store: CasStore;
  readonly counters: CasCounters;
  readonly readConfig: () => ResolvedCasResultsConfig;
  readonly logger: PluginLoggerLike;
}

/** Structural view of one text content block; avoids a `dsh-llm` peer. */
interface TextBlockLike {
  readonly type: string;
  readonly text?: unknown;
}

export function createPostExecuteListener(options: PostExecuteListenerOptions): CasPostExecuteListener {
  const { store, counters, readConfig, logger } = options;
  return async (exec, result, next) => {
    const decision = await next();
    try {
      if (decision.kind !== "accept") return decision;
      if (exec.parent !== undefined) return decision; // code-mode sub-dispatch: model never sees content
      if (isOwnToolName(exec.name)) return decision; // recursion protection (SPEC §21)
      const config = readConfig();
      if (!config.enabled) return decision;
      if (result.isError && !config.includeErrors) return decision; // errors untouched by default (SPEC AC8)

      const previewText = result.isError
        ? await transformErrorContent(result, exec, config, store, counters, logger)
        : await transformSuccessValue(result.value as JsonValue, exec, config, store, counters, logger);
      if (previewText === null) return decision;

      counters.increment("previewBytes", Buffer.byteLength(previewText, "utf8"));
      return {
        kind: "accept",
        content: [{ type: "text", text: previewText }],
      };
    } catch (error) {
      counters.increment("storageErrors");
      logger.warn("cas.transform_failed", {
        tool: exec.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return decision;
    }
  };
}

async function transformSuccessValue(
  value: JsonValue,
  exec: ToolExecution,
  config: ResolvedCasResultsConfig,
  store: CasStore,
  counters: CasCounters,
  logger: PluginLoggerLike,
): Promise<string | null> {
  const policy = resolveToolPolicy(config, exec.name);
  if (policy === null) return null;
  counters.increment("resultsScanned");
  const outcome = await transformValue(value, policy, store, exec.name);
  if (!outcome.changed) return null;
  counters.add({
    stringsScanned: outcome.objectsStored + outcome.casHits,
    objectsStored: outcome.objectsStored,
    casHits: outcome.casHits,
    logicalBytesOffloaded: outcome.logicalBytesOffloaded,
  });
  logger.debug("cas.offloaded", {
    tool: exec.name,
    fields: outcome.replacements.length,
    stringsScanned: outcome.stringsScanned,
    objectsStored: outcome.objectsStored,
    casHits: outcome.casHits,
    logicalBytes: outcome.logicalBytesOffloaded,
  });
  // Every oversized field of a structured value becomes one bounded preview
  // block; they share the model-facing content replacement.
  return outcome.replacements.map((replacement) => replacement.previewText).join("\n\n");
}

/**
 * Failed results carry no canonical value; when `includeErrors` is enabled,
 * oversized text blocks of the error content are offloaded with a head-only
 * preview and the error tail stays addressable in the CAS.
 */
async function transformErrorContent(
  result: Readonly<ToolExecutionResult>,
  exec: ToolExecution,
  config: ResolvedCasResultsConfig,
  store: CasStore,
  counters: CasCounters,
  logger: PluginLoggerLike,
): Promise<string | null> {
  const policy = resolveToolPolicy(config, exec.name);
  if (policy === null) return null;
  const blocks = (result.content as readonly TextBlockLike[]).filter(
    (block) => block.type === "text" && typeof block.text === "string",
  );
  let largest: { index: number; text: string; bytes: number } | undefined;
  for (let index = 0; index < blocks.length; index += 1) {
    const text = blocks[index]?.text as string;
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes >= policy.thresholds.textBytes && (largest === undefined || bytes > largest.bytes)) {
      largest = { index, text, bytes };
    }
  }
  if (largest === undefined) return null;
  counters.increment("resultsScanned");
  const object = await store.put({
    payload: Buffer.from(largest.text, "utf8"),
    kind: "text",
    mediaType: "text/plain",
    encoding: "utf8",
    firstTool: exec.name,
  });
  counters.add({
    stringsScanned: 1,
    objectsStored: object.reused ? 0 : 1,
    casHits: object.reused ? 1 : 0,
    logicalBytesOffloaded: largest.bytes,
  });
  logger.debug("cas.offloaded_error_block", { tool: exec.name, ref: object.ref, bytes: largest.bytes });
  const head = largest.text.slice(0, Math.min(policy.preview.maxChars, 2048));
  return [
    `[dsh-cas-results: ${largest.bytes}B text → ${Buffer.byteLength(head, "utf8")}B preview; ${object.ref}; use dsh_cas_retrieve]`,
    "type: text/plain",
    "",
    head,
    "",
    `Full content:\ndsh_cas_retrieve(ref="${object.ref}")`,
  ].join("\n");
}
