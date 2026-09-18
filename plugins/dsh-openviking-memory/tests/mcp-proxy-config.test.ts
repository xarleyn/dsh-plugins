import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "../src/openviking/debug-log.js";
import {
  buildMcpProxyConfig,
  DEFAULT_PROXY_TIMEOUT_MS,
  defaultCredentialPaths,
  normalizeConfigPath,
  trimSlash,
} from "../src/openviking/mcp-proxy-config.js";
import { readProxyConfig } from "../src/servers/mcp-proxy.js";

describe("debug-log createLogger", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ov-debug-log-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("is a no-op that never touches the filesystem when debug is off", async () => {
    const path = join(directory, "nested", "debug.ndjson");
    const logger = createLogger("mcp-proxy", {
      debug: false,
      debugLogPath: path,
    });

    logger.log("start", { mcpUrl: "http://ov.local/mcp" });
    logger.logError("start", new Error("nope"));

    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(directory, "nested"))).toBe(false);

    // Debug on but no destination is the same no-op, not a crash on an
    // undefined path.
    const pathless = createLogger("mcp-proxy", { debug: true });
    const unset = createLogger("mcp-proxy", null);
    expect(() => {
      pathless.log("start");
      pathless.logError("start", "boom");
      unset.log("start");
      unset.logError("start", "boom");
    }).not.toThrow();
    expect(existsSync(join(directory, "nested"))).toBe(false);
  });

  it("appends one NDJSON object per call when debug is on", async () => {
    const path = join(directory, "debug.ndjson");
    const logger = createLogger("mcp-proxy", {
      debug: true,
      debugLogPath: path,
    });

    logger.log("start", { mcpUrl: "http://ov.local/mcp" });
    logger.log("credentials_reloaded", { reason: "auth_failure" });
    logger.logError("request_failed", new Error("kaboom"));

    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    const entries = lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );

    for (const entry of entries) {
      expect(entry.hook).toBe("mcp-proxy");
      expect(typeof entry.ts).toBe("string");
      expect(Number.isNaN(Date.parse(entry.ts as string))).toBe(false);
    }

    expect(entries[0]).toMatchObject({
      stage: "start",
      data: { mcpUrl: "http://ov.local/mcp" },
    });
    expect(entries[1]).toMatchObject({
      stage: "credentials_reloaded",
      data: { reason: "auth_failure" },
    });
    expect(entries[2]!.stage).toBe("request_failed");
    expect(entries[2]!.data).toBeUndefined();
    expect(entries[2]!.error).toMatchObject({ message: "kaboom" });
    expect(typeof (entries[2]!.error as { stack?: unknown }).stack).toBe(
      "string",
    );
  });

  it("records a thrown non-Error as a string", async () => {
    const path = join(directory, "debug.ndjson");
    const logger = createLogger("mcp-proxy", {
      debug: true,
      debugLogPath: path,
    });

    logger.logError("request_failed", "plain string");

    const entry = JSON.parse((await readFile(path, "utf8")).trim()) as Record<
      string,
      unknown
    >;
    expect(entry.error).toBe("plain string");
  });
});

describe("buildMcpProxyConfig", () => {
  it("derives the MCP URL from the base URL and trims its trailing slashes", () => {
    expect(
      buildMcpProxyConfig({ baseUrl: "http://ov.local/", env: {} }).mcpUrl,
    ).toBe("http://ov.local/mcp");
    expect(trimSlash("http://ov.local///")).toBe("http://ov.local");
  });

  it("clamps the timeout to at least one second", () => {
    expect(
      buildMcpProxyConfig({ baseUrl: "http://ov.local", env: {} }).timeoutMs,
    ).toBe(DEFAULT_PROXY_TIMEOUT_MS);
    expect(
      buildMcpProxyConfig({ baseUrl: "http://ov.local", timeoutMs: 5, env: {} })
        .timeoutMs,
    ).toBe(1000);
    expect(
      buildMcpProxyConfig({
        baseUrl: "http://ov.local",
        timeoutMs: 45000,
        env: {},
      }).timeoutMs,
    ).toBe(45000);
  });

  it("deduplicates the watched paths and always includes the two default ones", () => {
    const config = buildMcpProxyConfig({
      baseUrl: "http://ov.local",
      watchedPaths: ["/tmp/custom.conf", "/tmp/custom.conf", ""],
      env: {},
    });

    expect(config.watchedPaths).toContain(
      join(homedir(), ".openviking", "ovcli.conf"),
    );
    expect(config.watchedPaths).toContain(
      join(homedir(), ".openviking", "ov.conf"),
    );
    expect(
      config.watchedPaths.filter((path) => path === "/tmp/custom.conf"),
    ).toHaveLength(1);
    expect(new Set(config.watchedPaths).size).toBe(config.watchedPaths.length);
    expect(config.watchedPaths).not.toContain("");
  });

  it("lets an explicit mcpUrl win over the base URL", () => {
    const config = buildMcpProxyConfig({
      baseUrl: "http://ov.local",
      mcpUrl: "http://elsewhere.local/custom",
      env: {},
    });

    expect(config.mcpUrl).toBe("http://elsewhere.local/custom");
  });

  it("expands `~` and lists the environment overrides before the defaults", () => {
    expect(normalizeConfigPath("~")).toBe(homedir());
    expect(normalizeConfigPath("~/ov/ovcli.conf")).toBe(
      join(homedir(), "ov", "ovcli.conf"),
    );
    expect(normalizeConfigPath("")).toBe("");

    const paths = defaultCredentialPaths({
      OPENVIKING_CLI_CONFIG_FILE: "~/cli.conf",
      OPENVIKING_CONFIG_FILE: "",
    });
    expect(paths[0]).toBe(join(homedir(), "cli.conf"));
    expect(paths).toEqual([
      join(homedir(), "cli.conf"),
      join(homedir(), ".openviking", "ovcli.conf"),
      join(homedir(), ".openviking", "ov.conf"),
    ]);
  });
});

describe("readProxyConfig", () => {
  const env: NodeJS.ProcessEnv = {
    OPENVIKING_URL: "http://ov.local/",
    OPENVIKING_API_KEY: "env-key",
    OPENVIKING_ACCOUNT: "acme",
    OPENVIKING_USER: "casey",
    OPENVIKING_PEER_ID: "peer-7",
    // Point the credential chain at files that do not exist, so a developer's
    // own ~/.openviking cannot decide the outcome.
    OPENVIKING_CLI_CONFIG_FILE: join(tmpdir(), "ov-absent-ovcli.conf"),
    OPENVIKING_CONFIG_FILE: join(tmpdir(), "ov-absent-ov.conf"),
  };

  it("resolves the child env into the proxy's credentials", () => {
    const config = readProxyConfig(env, "/workspace");

    expect(config.mcpUrl).toBe("http://ov.local/mcp");
    expect(config.apiKey).toBe("env-key");
    expect(config.account).toBe("acme");
    expect(config.user).toBe("casey");
    expect(config.peerId).toBe("peer-7");
    expect(config.userAgent).toMatch(/^openviking-memory-dsh\//);
  });

  it("keeps debug logging off while OV_DEBUG_LOG is unset", () => {
    const config = readProxyConfig(env, "/workspace");

    expect(config.debug).toBe(false);
    expect(config.debugLogPath).toBe("");
  });

  it("uses OV_DEBUG_LOG as the debug log path", () => {
    const config = readProxyConfig(
      { ...env, OV_DEBUG_LOG: "C:/tmp/ov.ndjson" },
      "/workspace",
    );

    expect(config.debug).toBe(true);
    expect(config.debugLogPath).toBe("C:/tmp/ov.ndjson");
  });
});
