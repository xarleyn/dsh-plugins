/**
 * The MCP bridge surface (SPEC §22.2, §35).
 *
 * The model-facing `mcp__openviking__*` tools are not registered by this plugin:
 * the entry mounts DSH's own mcp-client bridge against the vendored stdio proxy.
 * Two things are therefore worth asserting independently of the bridge itself —
 * the config the bridge is handed (stdio, never fatal, credentials forwarded
 * through the child environment) and the fact that it is mounted rather than
 * re-implemented here.
 */

import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Config as McpClientConfig, type StdioConfig } from "@deepseek-ai/dsh-mcp-client";
import { afterEach, describe, expect, it } from "vitest";

import { MCP_SERVER_NAME, resolveConfig } from "../src/config.js";
import { buildMcpConfig, PROXY_PATH } from "../src/mcp.js";
import { createHarness, type Harness } from "./helpers/harness.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * A credential environment with no credential files at all.
 *
 * `resolveConfig()` otherwise walks `~/.openviking/ovcli.conf` / `ov.conf`, so a
 * developer's own key would decide the outcome of a test about *defaults*.
 */
const NO_CREDENTIAL_FILES: NodeJS.ProcessEnv = {
  OPENVIKING_CLI_CONFIG_FILE: join(packageRoot, "tests", "fixtures", "absent-ovcli.conf"),
  OPENVIKING_CONFIG_FILE: join(packageRoot, "tests", "fixtures", "absent-ov.conf"),
};

/** The stdio arm of the bridge's config union, asserted before it is read. */
function stdioConfig(config: ReturnType<typeof buildMcpConfig>): StdioConfig {
  expect(config.transport).toBe("stdio");
  if (config.transport !== "stdio") {
    throw new Error("the OpenViking bridge must use the stdio transport");
  }
  return config;
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe("buildMcpConfig", () => {
  const resolved = resolveConfig(
    {
      endpoint: "http://ov.local/",
      apiKey: "k",
      account: "a",
      user: "u",
      peerId: "p",
      mcpToolCallTimeoutMs: 12345,
    },
    NO_CREDENTIAL_FILES,
  );

  it("produces the bridge config for the vendored stdio proxy", () => {
    const config = stdioConfig(buildMcpConfig(resolved));

    expect(config.serverName).toBe("openviking");
    expect(config.serverName).toBe(MCP_SERVER_NAME);
    expect(config.command).toBe(process.execPath);
    expect(config.args).toEqual([PROXY_PATH]);
    // Stated rather than left to the bridge's own defaults: an unreachable
    // OpenViking must never fail plugin activation, because recall, capture and
    // commit stay useful against a server whose MCP endpoint is down.
    expect(config.cwd).toBe("");
    expect(config.failOnStartupError).toBe(false);
    expect(config.toolCallTimeoutMs).toBe(12345);
  });

  it("forwards the resolved credentials through the child environment", () => {
    const config = stdioConfig(buildMcpConfig(resolved));

    // DSH scrubs credential-shaped names out of the inherited environment and
    // the Cordis patch is invisible to a subprocess, so this is the only channel
    // the values the plugin already resolved can travel on.
    expect(config.env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      OPENVIKING_URL: "http://ov.local",
      OPENVIKING_API_KEY: "k",
      OPENVIKING_ACCOUNT: "a",
      OPENVIKING_USER: "u",
      OPENVIKING_PEER_ID: "p",
    });
  });

  it("the config validates against the pinned bridge's own schema", async () => {
    const result = await McpClientConfig["~standard"].validate(buildMcpConfig(resolved));

    expect(result.issues).toBeUndefined();
  });

  it("credentials resolved by the plugin reach the proxy through the child env", () => {
    const env: NodeJS.ProcessEnv = {
      ...NO_CREDENTIAL_FILES,
      OPENVIKING_API_KEY: "env-key",
    };
    const config = stdioConfig(buildMcpConfig(resolveConfig({}, env)));

    expect(config.env.OPENVIKING_API_KEY).toBe("env-key");
  });

  it("an anonymous local server forwards no credential env", () => {
    // `workspacePeer: false` is what makes the server anonymous: the default
    // derives a peer id from the checkout's git remote, and that identity — like
    // an explicit one — is deliberately forwarded to the child. What must not
    // appear is a credential.
    const config = stdioConfig(
      buildMcpConfig(
        resolveConfig(
          { endpoint: "http://127.0.0.1:1933", workspacePeer: false },
          NO_CREDENTIAL_FILES,
        ),
      ),
    );

    expect(config.env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      OPENVIKING_URL: "http://127.0.0.1:1933",
    });
  });
});

describe("PROXY_PATH", () => {
  it("points at the compiled proxy entrypoint", async () => {
    // Normalized because `fileURLToPath` yields backslashes on Windows.
    expect(PROXY_PATH.replaceAll("\\", "/").endsWith("servers/mcp-proxy.js")).toBe(true);

    const sourceSibling = PROXY_PATH.replace(/\.js$/, ".ts");
    const builtEntry = join(packageRoot, "lib", "servers", "mcp-proxy.js");
    const sourceEntry = join(packageRoot, "src", "servers", "mcp-proxy.ts");

    // The TypeScript source the proxy is compiled from always ships with the
    // package, so a fresh checkout (no `lib/` yet) still resolves a real file.
    expect(existsSync(sourceEntry)).toBe(true);
    expect(sourceSibling).toBe(sourceEntry);

    const live = [builtEntry, sourceSibling].filter(candidate => existsSync(candidate));
    expect(live.length).toBeGreaterThan(0);
    for (const candidate of live) {
      await expect(access(candidate)).resolves.toBeUndefined();
    }
  });
});

describe("the entry's tool mount", () => {
  it("mounts the tool surface instead of registering tools itself", async () => {
    harness = await createHarness({ endpoint: "http://ov.local/" });

    const bridges = harness.mounted.filter(
      entry => (entry.config as { serverName?: string } | undefined)?.serverName === "openviking",
    );

    expect(bridges).toHaveLength(1);
    const bridge = bridges[0]!;
    // The mounted module is DSH's own mcp-client bridge, mounted as a module
    // (namespace plugin with `apply`), not a tool registered on ctx.tools.
    expect((bridge.plugin as { name?: string }).name).toBe("mcp-client");
    expect(typeof (bridge.plugin as { apply?: unknown }).apply).toBe("function");

    const config = stdioConfig(bridge.config as ReturnType<typeof buildMcpConfig>);
    expect(config.env.OPENVIKING_URL).toBe("http://ov.local");
    expect(config.failOnStartupError).toBe(false);
  });
});
