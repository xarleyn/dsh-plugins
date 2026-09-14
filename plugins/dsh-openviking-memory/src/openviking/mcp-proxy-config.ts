/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
/**
 * Shared config shaping for the stdio MCP proxy entrypoints.
 *
 * Every harness loads its credentials differently, but the shape
 * `createOpenVikingMcpProxy` consumes is identical everywhere, and so is the
 * set of files whose changes must trigger a credential reload. Keeping that
 * here stops each entrypoint from re-deriving `~` expansion, URL trimming,
 * timeout clamping, and the watch list.
 */

import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

export const DEFAULT_PROXY_TIMEOUT_MS = 15000;
const MIN_PROXY_TIMEOUT_MS = 1000;

export function trimSlash(value: unknown): string {
  return String(value || "").replace(/\/+$/, "");
}

/** Expand a leading `~` and resolve to an absolute path; "" stays "". */
export function normalizeConfigPath(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return resolvePath(join(homedir(), raw.slice(2)));
  return resolvePath(raw);
}

/**
 * The credential files every harness must watch: the two `OPENVIKING_*_FILE`
 * overrides and the two default locations under `~/.openviking`.
 */
export function defaultCredentialPaths(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    normalizeConfigPath(env.OPENVIKING_CLI_CONFIG_FILE),
    normalizeConfigPath(env.OPENVIKING_CONFIG_FILE),
    join(homedir(), ".openviking", "ovcli.conf"),
    join(homedir(), ".openviking", "ov.conf"),
  ].filter(Boolean);
}

/** The resolved shape `createOpenVikingMcpProxy` consumes. */
export interface McpProxyConfig {
  readonly mcpUrl: string;
  readonly apiKey: string;
  readonly account: string;
  readonly user: string;
  readonly peerId: string;
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly debugLogPath: string;
  readonly credentialSource: string;
  readonly credentialPath: string;
  readonly watchedPaths: string[];
}

/** Everything a harness may contribute to `buildMcpProxyConfig`. */
export interface BuildMcpProxyConfigInput {
  readonly baseUrl?: string;
  readonly mcpUrl?: string;
  readonly apiKey?: string;
  readonly account?: string;
  readonly user?: string;
  readonly peerId?: string;
  readonly userAgent?: string;
  readonly timeoutMs?: number;
  readonly debug?: boolean;
  readonly debugLogPath?: string;
  readonly credentialSource?: string;
  readonly credentialPath?: string;
  readonly watchedPaths?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

function uniq(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Shape a harness's loaded config into the object `createOpenVikingMcpProxy`
 * expects.
 *
 * `mcpUrl` wins over `baseUrl` when both are given, so a harness that lets the
 * user pin an explicit MCP URL keeps that behavior. `watchedPaths` are the
 * harness's own extra files; the shared defaults are appended and the result
 * deduplicated.
 */
export function buildMcpProxyConfig({
  baseUrl = "",
  mcpUrl = "",
  apiKey = "",
  account = "",
  user = "",
  peerId = "",
  userAgent = "",
  timeoutMs,
  debug = false,
  debugLogPath = "",
  credentialSource = "auto",
  credentialPath = "",
  watchedPaths = [],
  env = process.env,
}: BuildMcpProxyConfigInput = {}): McpProxyConfig {
  return {
    mcpUrl: mcpUrl || `${trimSlash(baseUrl)}/mcp`,
    apiKey: apiKey || "",
    account: account || "",
    user: user || "",
    peerId: peerId || "",
    userAgent: userAgent || "",
    timeoutMs: Math.max(
      MIN_PROXY_TIMEOUT_MS,
      Number(timeoutMs) || DEFAULT_PROXY_TIMEOUT_MS,
    ),
    debug: debug === true,
    debugLogPath,
    credentialSource: credentialSource || "auto",
    credentialPath: credentialPath || "",
    watchedPaths: uniq([...watchedPaths, ...defaultCredentialPaths(env)]),
  };
}
