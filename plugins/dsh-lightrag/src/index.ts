/**
 * dsh-lightrag — LightRAG knowledge-base tools for DeepSeek Harness agents.
 *
 * The plugin registers read tools (`dsh_lightrag_query`,
 * `dsh_lightrag_documents`, `dsh_lightrag_status`) that answer questions from
 * a LightRAG graph-RAG index without handing the model an HTTP client: every
 * request is built by this plugin against one operator-configured origin, byte
 * capped and time boxed (SPEC §1, §3).
 *
 * The write tools (`dsh_lightrag_insert`, `dsh_lightrag_scan`,
 * `dsh_lightrag_delete`) are registered only when `writes.enabled` is true,
 * because a deployment that runs agents read-only must not have a write tool
 * whose name an allow-list could carry.
 */

import {
  getPluginLogger,
  silentPluginLogger,
  type PluginLoggerLike,
} from "@yadsh/dsh-plugin-log";

import { createLightRagClient, type LightRagClient } from "./client.js";
import {
  LightRagConfigSchema,
  resolveLightRagConfig,
  type LightRagConfig,
  type ResolvedLightRagConfig,
} from "./config.js";
import { createLightRagDocumentsTool } from "./tools/documents.js";
import { createLightRagQueryTool } from "./tools/query.js";
import type { LightRagToolDeps } from "./tools/shared.js";
import { createLightRagStatusTool } from "./tools/status.js";
import {
  createLightRagDeleteTool,
  createLightRagInsertTool,
  createLightRagScanTool,
} from "./tools/writes.js";

/** Re-exported for the package's public surface and for tests. */
export { silentPluginLogger, type PluginLoggerLike };

export {
  createLightRagClient,
  DEFAULT_MAX_RESPONSE_BYTES,
  errorForStatus,
  type LightRagAnswer,
  type LightRagClient,
  type LightRagClientOptions,
  type LightRagDeleteResult,
  type LightRagDocument,
  type LightRagDocumentsPage,
  type LightRagDocumentsRequest,
  type LightRagHealth,
  type LightRagIngestStart,
  type LightRagQueryRequest,
  type LightRagReference,
  type LightRagStatusCount,
} from "./client.js";
export {
  LIGHTRAG_DEFAULTS,
  LightRagConfigSchema,
  QUERY_MODES,
  resolveLightRagConfig,
  resolveLightRagEndpoint,
  resolveQueryMode,
  type LightRagConfig,
  type QueryMode,
  type ResolvedLightRagConfig,
} from "./config.js";
export {
  LightRagError,
  LIGHTRAG_ERROR_HINTS,
  type LightRagErrorCode,
} from "./errors.js";
export {
  createLightRagDocumentsTool,
  type LightRagDocumentEntry,
  type LightRagDocumentsResult,
} from "./tools/documents.js";
export {
  createLightRagQueryTool,
  type LightRagQueryReference,
  type LightRagQueryResult,
} from "./tools/query.js";
export {
  byteLength,
  truncateToBytes,
  UNTRUSTED_NOTE,
  type LightRagToolDeps,
} from "./tools/shared.js";
export {
  createLightRagStatusTool,
  type LightRagStatusResult,
} from "./tools/status.js";
export {
  createLightRagDeleteTool,
  createLightRagInsertTool,
  createLightRagScanTool,
  type LightRagDeleteResult as LightRagDeleteToolResult,
  type LightRagInsertResult,
  type LightRagScanResult,
} from "./tools/writes.js";

/** Cordis plugin name. */
export const name = "dsh-lightrag";

/** The tools service is the only required host service. */
export const inject = ["tools"] as const;

/** Schemastery configuration contract (Cordis fills it before `apply`). */
export const Config = LightRagConfigSchema;

/** Structural view of the host surface the plugin needs. */
export interface LightRagToolsHost {
  tools: { register(definition: unknown): () => void };
}

/** Read-only tool names this plugin registers (deployment allow-list contract). */
export const LIGHTRAG_TOOL_NAMES: readonly string[] = [
  "dsh_lightrag_query",
  "dsh_lightrag_documents",
  "dsh_lightrag_status",
];

/** Write tool names, registered only when `writes.enabled` is true. */
export const LIGHTRAG_WRITE_TOOL_NAMES: readonly string[] = [
  "dsh_lightrag_insert",
  "dsh_lightrag_scan",
  "dsh_lightrag_delete",
];

/** Build the tool dependencies from resolved config and one HTTP client. */
export function createLightRagToolDeps(
  config: ResolvedLightRagConfig,
  logger: PluginLoggerLike,
  client?: LightRagClient,
): LightRagToolDeps {
  return {
    config,
    logger,
    client: client ?? createLightRagClient(config),
  };
}

/**
 * Plugin entry: resolve config and register the knowledge-base tools.
 * Registrations are collected by the Cordis plugin scope; `enabled: false`
 * keeps the surface entirely absent instead of registering inert tools, and
 * `writes.enabled: false` keeps every write tool out of the catalog.
 */
export function apply(
  ctx: LightRagToolsHost,
  rawConfig?: LightRagConfig,
): void {
  const config = resolveLightRagConfig(rawConfig);
  const logger = getPluginLogger({ pluginId: "dsh-lightrag" });
  if (!config.enabled) {
    logger.info("plugin.disabled");
    return;
  }
  const deps = createLightRagToolDeps(config, logger);
  ctx.tools.register(createLightRagQueryTool(deps));
  ctx.tools.register(createLightRagDocumentsTool(deps));
  ctx.tools.register(createLightRagStatusTool(deps));
  const registered = [...LIGHTRAG_TOOL_NAMES];
  if (config.writesEnabled) {
    ctx.tools.register(createLightRagInsertTool(deps));
    ctx.tools.register(createLightRagScanTool(deps));
    ctx.tools.register(createLightRagDeleteTool(deps));
    registered.push(...LIGHTRAG_WRITE_TOOL_NAMES);
  }
  logger.info("plugin.applied", {
    tools: registered,
    endpoint: config.endpoint,
    authenticated: config.apiKey !== "",
  });
}

export default { name, inject, Config, apply };
