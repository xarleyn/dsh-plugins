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
import { createOpenVikingMcpProxy } from "../openviking/mcp-proxy-core.js";
import type { McpProxyConfig } from "../openviking/mcp-proxy-config.js";

export function readProxyConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): McpProxyConfig {
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1] as string)) {
  createOpenVikingMcpProxy({ readConfig: readProxyConfig, loggerFactory: createLogger }).start();
}
