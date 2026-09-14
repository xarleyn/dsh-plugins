/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 *
 * MCP bridge: mounts DSH's own MCP-client plugin against the vendored
 * OpenViking stdio proxy, so the model-facing `mcp__openviking__*` tools exist
 * independently of automatic context injection.
 */

import { fileURLToPath } from "node:url";

import type { Context } from "@deepseek-ai/cordis";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";

import { MCP_SERVER_NAME, type ResolvedConfig } from "./config.js";

/** The stdio proxy DSH starts as a local MCP server. */
export const PROXY_PATH = fileURLToPath(
  new URL("./servers/mcp-proxy.js", import.meta.url),
);

/**
 * Build the dsh-mcp-client config for the OpenViking stdio proxy.
 *
 * The bundle's own credential resolution (`OPENVIKING_*` → `ovcli.conf` →
 * `ov.conf`, plus anything set in the Cordis patch) is forwarded through the
 * child environment: DSH scrubs credential-shaped names out of the inherited
 * env, and the patch is invisible to a subprocess, so values the runtime
 * already resolved have to be passed explicitly.
 *
 * `cwd` and `failOnStartupError` are stated explicitly rather than left to the
 * bridge's schema defaults: an unreachable OpenViking must never fail plugin
 * activation, because recall, capture and commit are all still useful against a
 * server whose MCP endpoint is down.
 */
export function buildMcpConfig(config: ResolvedConfig): mcpClient.Config {
  // In DSH Desktop, process.execPath is Electron's executable rather than a
  // standalone Node binary. This tells Electron to run the proxy script as
  // Node instead of attempting to launch a second Desktop instance.
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
  if (config.endpoint) env.OPENVIKING_URL = config.endpoint;
  if (config.apiKey) env.OPENVIKING_API_KEY = config.apiKey;
  if (config.account) env.OPENVIKING_ACCOUNT = config.account;
  if (config.user) env.OPENVIKING_USER = config.user;
  if (config.peerId) env.OPENVIKING_PEER_ID = config.peerId;
  return {
    transport: "stdio",
    serverName: MCP_SERVER_NAME,
    command: process.execPath,
    args: [PROXY_PATH],
    env,
    cwd: "",
    toolCallTimeoutMs: config.mcpToolCallTimeoutMs,
    failOnStartupError: false,
  };
}

/**
 * Mount the tool surface. The bridge ships with dsh itself, so it resolves
 * from the host installation and never needs a separate install step.
 * Startup failure is contained: recall, capture, and commit keep working
 * against a server whose MCP endpoint is unreachable.
 */
export function mountOpenVikingMcp(ctx: Context, config: ResolvedConfig): void {
  ctx.plugin(mcpClient, buildMcpConfig(config));
}
