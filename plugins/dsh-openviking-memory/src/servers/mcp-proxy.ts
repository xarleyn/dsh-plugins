/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

/**
 * stdio -> streamable-HTTP MCP proxy for the OpenViking DSH bundle.
 *
 * DSH's MCP bridge starts this process as a local stdio MCP server. The proxy
 * reads the same OpenViking credential sources as the in-process runtime; the
 * bundle also forwards its resolved config through the child environment, so
 * values that came from the Cordis patch survive the process boundary.
 *
 * The upstream `#!/usr/bin/env node` shebang is intentionally absent: the child
 * process is spawned with `process.execPath`, so the shebang is inert, and the
 * attribution header above must be the first token in the file.
 */

import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveConfig } from "../config.js";
import { resolveOpenVikingCredentials } from "../openviking/credentials.js";
import { createLogger } from "../openviking/debug-log.js";
import { buildMcpProxyConfig } from "../openviking/mcp-proxy-config.js";
import {
  createOpenVikingMcpProxy,
  type RequestGuard,
  type RequestGuardRejection,
} from "../openviking/mcp-proxy-core.js";
import type { LocalTool } from "../openviking/mcp-proxy-core.js";
import type { McpProxyConfig } from "../openviking/mcp-proxy-config.js";

/**
 * Upstream retrieval tools whose free-text parameter must carry at least one
 * non-whitespace character. The upstream server answers an empty `pattern` or
 * `query` with "no matches", which reads as a real (negative) result — a model
 * that once sent an empty argument kept resending it — so the empty call is
 * rejected here as invalid parameters instead of being forwarded.
 */
const REQUIRED_TEXT_PARAMS: Readonly<Record<string, readonly string[]>> = {
  find: ["query"],
  grep: ["pattern"],
  search: ["query"],
};

/** Whether the value names something worth searching for. */
function hasMeaningfulText(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  // `grep` accepts a pattern list as well as a single pattern.
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === "string" && item.trim() !== "");
  }
  return false;
}

/**
 * Reject a `tools/call` whose required text parameters are empty or missing.
 * Everything else — unknown tools, well-formed calls, non-request messages —
 * forwards upstream untouched.
 */
export function guardEmptySearchParams(
  message: unknown,
): RequestGuardRejection | null {
  if (!message || typeof message !== "object") return null;
  const request = message as {
    readonly method?: unknown;
    readonly params?: {
      readonly name?: unknown;
      readonly arguments?: unknown;
    };
  };
  if (request.method !== "tools/call") return null;
  const name = request.params?.name;
  const required =
    typeof name === "string" ? REQUIRED_TEXT_PARAMS[name] : undefined;
  if (!required) return null;
  const args =
    request.params?.arguments && typeof request.params.arguments === "object"
      ? (request.params.arguments as Readonly<Record<string, unknown>>)
      : {};
  for (const param of required) {
    if (!hasMeaningfulText(args[param])) {
      return {
        code: -32602,
        message: `${param} must be a non-empty string`,
        data: { tool: name, param },
      };
    }
  }
  return null;
}

/**
 * Advertise the required text parameters as required in the upstream tool
 * schemas, so a model sees the contract before its first call. The tool is
 * cloned before patching: the upstream answer object must stay untouched.
 */
export function requireSearchParamsInSchema(tool: LocalTool): LocalTool | null {
  const name = tool?.name;
  const required =
    typeof name === "string" ? REQUIRED_TEXT_PARAMS[name] : undefined;
  if (!required) return tool;
  const clone = JSON.parse(JSON.stringify(tool)) as {
    inputSchema?: {
      properties?: Record<string, Record<string, unknown>>;
      required?: unknown;
    };
  };
  const schema = clone.inputSchema;
  if (schema && typeof schema === "object") {
    const markRequired = new Set(
      Array.isArray(schema.required) ? schema.required : [],
    );
    for (const param of required) {
      const property = schema.properties?.[param];
      if (property && typeof property === "object") {
        const type = property["type"];
        const isArray =
          type === "array" || (Array.isArray(type) && type.includes("array"));
        if (isArray) property["minItems"] = 1;
        else property["minLength"] = 1;
      }
      markRequired.add(param);
    }
    schema.required = [...markRequired];
  }
  return clone as LocalTool;
}

const searchParamGuard: RequestGuard = {
  guardRequest: guardEmptySearchParams,
};

export function readProxyConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): McpProxyConfig {
  const cfg = resolveConfig({}, env, cwd);
  const creds = resolveOpenVikingCredentials(env);
  return buildMcpProxyConfig({
    baseUrl: cfg.endpoint,
    apiKey: cfg.apiKey,
    account: cfg.account,
    user: cfg.user,
    // Not gated through `resolveMcpActorPeerId` like the other proxies: DSH's
    // parent process resolves the peer per session and hands it over in the
    // child env (`mcp.mjs` `buildMcpConfig`), so this one is not a guess at the
    // launch directory.
    peerId: cfg.peerId,
    userAgent: cfg.userAgent,
    timeoutMs: cfg.requestTimeoutMs,
    debug: Boolean(env.OV_DEBUG_LOG),
    debugLogPath: env.OV_DEBUG_LOG,
    credentialSource: creds.credentialSource,
    credentialPath: creds.cliPath || creds.ovPath,
    watchedPaths: [creds.cliPath, creds.ovPath, creds.cliPathCandidate],
    env,
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolvePath(process.argv[1] as string)
) {
  createOpenVikingMcpProxy({
    readConfig: readProxyConfig,
    loggerFactory: createLogger,
    requestGuard: searchParamGuard,
    adjustUpstreamTool: requireSearchParamsInSchema,
  }).start();
}
