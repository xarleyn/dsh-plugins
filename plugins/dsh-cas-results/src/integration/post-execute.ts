/**
 * DSH integration seam (SPEC §8, §26).
 *
 * Current `@deepseek-ai/dsh-tools` re-derives the model-facing `content` of a
 * successful result from its canonical `value` after the `tools/execute`
 * waterfall and validates it against the tool's output schema, so replacing
 * `value` there would either be ignored or break the tool. The plugin
 * therefore subscribes to `tools/post-execute`, which is the registry's
 * supported result-reshaping seam: scanning operates on the canonical
 * `result.value` unless a downstream listener already projected its content.
 * The accepted decision replaces only model-facing `content`; `value` stays canonical
 * for execution-local consumers; durable session events never carry it.
 *
 * Every failure inside the transformation is contained: the downstream
 * decision (the original result) passes through unchanged (SPEC §26).
 */

import { Buffer } from "node:buffer";

import type {
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import type { PluginLoggerLike } from "@yadsh/dsh-plugin-log";
import { resolvePostExecuteContent } from "@yadsh/dsh-plugin-kit/post-execute";

import type { ResolvedCasResultsConfig } from "../config.js";
import { transformValue, type JsonValue } from "../transform/scan-value.js";
import { CasCounters } from "../observability/counters.js";
import type { CasStore } from "../cas/types.js";
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

export function createPostExecuteListener(
  options: PostExecuteListenerOptions,
): CasPostExecuteListener {
  const { store, counters, readConfig, logger } = options;
  return async (exec, result, next) => {
    const decision = await next();
    try {
      if (decision.kind !== "accept") return decision;
      const effective = resolvePostExecuteContent(decision, result.content);
      if (effective.kind !== "content") return decision;
      if (exec.parent !== undefined) return decision; // code-mode sub-dispatch: model never sees content
      if (isOwnToolName(exec.name)) return decision; // recursion protection (SPEC §21)
      const config = readConfig();
      if (!config.enabled) return decision;
      if (result.isError && !config.includeErrors) return decision; // errors untouched by default (SPEC AC8)

      let content: ToolExecutionResult["content"];
      if (result.isError || effective.replaced) {
        let changed = false;
        const blocks = [];
        for (const block of effective.content) {
          if (block.type !== "text") {
            blocks.push(block);
            continue;
          }
          const preview = await (
            result.isError ? transformErrorText : transformSuccessValue
          )(block.text, exec, config, store, counters, logger);
          changed ||= preview !== null;
          blocks.push(preview === null ? block : { ...block, text: preview });
        }
        if (!changed) return decision;
        content = blocks;
      } else {
        const previewText = await transformSuccessValue(
          result.value as JsonValue,
          exec,
          config,
          store,
          counters,
          logger,
        );
        if (previewText === null) return decision;
        content = [{ type: "text", text: previewText }];
      }

      counters.increment(
        "previewBytes",
        content.reduce(
          (bytes, block) =>
            bytes +
            (block.type === "text" ? Buffer.byteLength(block.text, "utf8") : 0),
          0,
        ),
      );
      return {
        ...effective.decision,
        content,
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
  // Preserve the field names, scalar status metadata and small sibling values.
  // Only each oversized string has been substituted with a bounded preview.
  return typeof outcome.value === "string"
    ? outcome.value
    : JSON.stringify(outcome.value, null, 2);
}

/**
 * Failed results carry no canonical value; when `includeErrors` is enabled,
 * oversized text blocks of the error content are offloaded with a head-only
 * preview and the error tail stays addressable in the CAS.
 */
async function transformErrorText(
  text: string,
  exec: ToolExecution,
  config: ResolvedCasResultsConfig,
  store: CasStore,
  counters: CasCounters,
  logger: PluginLoggerLike,
): Promise<string | null> {
  const policy = resolveToolPolicy(config, exec.name);
  if (policy === null) return null;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes < policy.thresholds.textBytes) return null;
  counters.increment("resultsScanned");
  const object = await store.put({
    payload: Buffer.from(text, "utf8"),
    kind: "text",
    mediaType: "text/plain",
    encoding: "utf8",
    firstTool: exec.name,
  });
  counters.add({
    stringsScanned: 1,
    objectsStored: object.reused ? 0 : 1,
    casHits: object.reused ? 1 : 0,
    logicalBytesOffloaded: bytes,
  });
  logger.debug("cas.offloaded_error_block", {
    tool: exec.name,
    ref: object.ref,
    bytes,
  });
  const head = text.slice(0, Math.min(policy.preview.maxChars, 2048));
  return [
    `[dsh-cas-results: ${bytes}B text → ${Buffer.byteLength(head, "utf8")}B preview; ${object.ref}; use dsh_cas_retrieve]`,
    "type: text/plain",
    "",
    head,
    "",
    `Full content:\ndsh_cas_retrieve(ref="${object.ref}")`,
  ].join("\n");
}
