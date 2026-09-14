/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

const DEFAULT_OVCLI_CONF_PATH = join(homedir(), ".openviking", "ovcli.conf");
const DEFAULT_OV_CONF_PATH = join(homedir(), ".openviking", "ov.conf");

/** The credential files that were readable, and where they were looked for. */
export interface LoadedCredentialFiles {
  readonly cliFile: Record<string, unknown>;
  readonly cliPath: string;
  readonly cliPathCandidate: string;
  readonly ovFile: Record<string, unknown>;
  readonly ovPath: string;
}

/** The resolved endpoint, auth, and identity, plus the files they came from. */
export interface ResolvedOpenVikingCredentials extends LoadedCredentialFiles {
  readonly credentialSource: "ovcli" | "env" | "auto";
  readonly credentialPath: string;
  readonly baseUrl: string;
  readonly mcpUrl: string;
  readonly apiKey: string;
  readonly account: string;
  readonly user: string;
  readonly peerId: string;
  readonly hasApiKey: boolean;
}

function str(val: unknown, fallback: string = ""): string {
  if (typeof val === "string" && val.trim()) return val.trim();
  return fallback;
}

function normalizePath(value: unknown): string {
  const raw = str(value, "");
  if (!raw) return "";
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return resolvePath(join(homedir(), raw.slice(2)));
  return resolvePath(raw);
}

function tryLoadJson(path: string): Record<string, unknown> | null {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Build the User-Agent every harness plugin sends on OpenViking-bound requests.
 * Shape is `name/semver` so downstream stats layers can parse it as one token.
 */
export function buildUserAgent(harness: string, version: string): string {
  return `openviking-memory-${harness}/${str(version, "") || "0.0.0"}`;
}

function looksLikeOvcli(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const fields = obj as Record<string, unknown>;
  if (fields.server && typeof fields.server === "object") return false;
  return Boolean(
    typeof fields.url === "string" ||
    typeof fields.api_key === "string" ||
    typeof fields.account === "string" ||
    typeof fields.account_id === "string" ||
    typeof fields.user === "string" ||
    typeof fields.user_id === "string" ||
    typeof fields.actor_peer_id === "string",
  );
}

function hasCredentialFields(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const fields = obj as Record<string, unknown>;
  return [
    "url",
    "api_key",
    "account",
    "account_id",
    "user",
    "user_id",
    "actor_peer_id",
    "peer_id",
  ].some((key) => typeof fields[key] === "string");
}

export function loadCredentialFiles(env: NodeJS.ProcessEnv = process.env): LoadedCredentialFiles {
  const cliPathCandidate = normalizePath(env.OPENVIKING_CLI_CONFIG_FILE) || DEFAULT_OVCLI_CONF_PATH;
  const ovPathCandidate = normalizePath(env.OPENVIKING_CONFIG_FILE) || DEFAULT_OV_CONF_PATH;
  const cliPathEnv = Boolean(str(env.OPENVIKING_CLI_CONFIG_FILE, ""));
  const ovPathEnv = Boolean(str(env.OPENVIKING_CONFIG_FILE, ""));

  let cliFile = tryLoadJson(cliPathCandidate);
  let cliPath = cliFile ? cliPathCandidate : "";
  let ovFile = tryLoadJson(ovPathCandidate);
  let ovPath = ovFile ? ovPathCandidate : "";

  // Backward compat: older plugin installs used OPENVIKING_CONFIG_FILE for
  // both ov.conf and ovcli.conf. Preserve that when the file is ovcli-shaped.
  if (ovPathEnv && !cliPathEnv && looksLikeOvcli(ovFile)) {
    cliFile = ovFile;
    cliPath = ovPath;
    ovFile = null;
    ovPath = "";
  }

  return {
    cliFile: cliFile || {},
    cliPath,
    cliPathCandidate,
    ovFile: ovFile || {},
    ovPath,
  };
}

function sourceMode(env: NodeJS.ProcessEnv): "env" | "cli" | "auto" {
  const raw = str(env.OPENVIKING_CREDENTIAL_SOURCE, str(env.OPENVIKING_CREDENTIALS_SOURCE, "auto"))
    .toLowerCase();
  if (raw === "env" || raw === "environment") return "env";
  if (raw === "cli" || raw === "ovcli" || raw === "file" || raw === "config") return "cli";
  return "auto";
}

function hasEnvCredentialFields(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    str(env.OPENVIKING_URL, str(env.OPENVIKING_BASE_URL, "")) ||
    str(env.OPENVIKING_MCP_URL, "") ||
    str(env.OPENVIKING_BEARER_TOKEN, str(env.OPENVIKING_API_KEY, "")) ||
    str(env.OPENVIKING_ACCOUNT, "") ||
    str(env.OPENVIKING_USER, "") ||
    str(env.OPENVIKING_PEER_ID, ""),
  );
}

function deriveBaseUrl({
  env,
  cliFile,
  ovFile,
  mode,
  useCli,
}: LoadedCredentialFiles & { env: NodeJS.ProcessEnv; mode: string; useCli: boolean }): string {
  const envUrl = str(env.OPENVIKING_URL, str(env.OPENVIKING_BASE_URL, ""));
  const cliUrl = str(cliFile.url, "");

  if (mode !== "cli" && envUrl) return envUrl.replace(/\/+$/, "");
  if (useCli && cliUrl) return cliUrl.replace(/\/+$/, "");
  if (mode !== "env" && cliUrl) return cliUrl.replace(/\/+$/, "");

  const server = (ovFile.server || {}) as Record<string, unknown>;
  const ovUrl = str(server.url, "");
  if (ovUrl) return ovUrl.replace(/\/+$/, "");

  const host = str(server.host, "127.0.0.1").replace("0.0.0.0", "127.0.0.1");
  const port = Number.isFinite(Number(server.port)) ? Math.floor(Number(server.port)) : 1933;
  return `http://${host}:${port}`;
}

export function resolveOpenVikingCredentials(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOpenVikingCredentials {
  const files = loadCredentialFiles(env);
  const mode = sourceMode(env);
  const envHasCredentials = hasEnvCredentialFields(env);
  const useCli = mode === "cli" ||
    (mode === "auto" && !envHasCredentials && Boolean(files.cliPath) && hasCredentialFields(files.cliFile));
  const cx = (files.ovFile.codex || {}) as Record<string, unknown>;
  const server = (files.ovFile.server || {}) as Record<string, unknown>;

  const baseUrl = deriveBaseUrl({ env, ...files, mode, useCli });

  const apiKey = useCli
    ? str(files.cliFile.api_key, "")
    : (
        str(env.OPENVIKING_BEARER_TOKEN, "") ||
        str(env.OPENVIKING_API_KEY, "") ||
        str(files.cliFile.api_key, "") ||
        str(cx.apiKey, "") ||
        str(server.root_api_key, "")
      );

  const account = useCli
    ? str(files.cliFile.account, str(files.cliFile.account_id, ""))
    : (
        str(env.OPENVIKING_ACCOUNT, "") ||
        str(files.cliFile.account, str(files.cliFile.account_id, "")) ||
        str(cx.accountId, "")
      );

  const user = useCli
    ? str(files.cliFile.user, str(files.cliFile.user_id, ""))
    : (
        str(env.OPENVIKING_USER, "") ||
        str(files.cliFile.user, str(files.cliFile.user_id, "")) ||
        str(cx.userId, "")
      );

  const peerId = useCli
    ? str(files.cliFile.actor_peer_id, str(files.cliFile.peer_id, ""))
    : (
        str(env.OPENVIKING_PEER_ID, "") ||
        str(files.cliFile.actor_peer_id, str(files.cliFile.peer_id, "")) ||
        str(cx.peerId, str(cx.peer_id, ""))
      );

  const explicitMcpUrl = str(env.OPENVIKING_MCP_URL, "");
  const mcpUrl = (mode !== "cli" && explicitMcpUrl) ? explicitMcpUrl : `${baseUrl.replace(/\/+$/, "")}/mcp`;

  // The file that actually supplied the api_key, following the same chain —
  // empty when the key came from the environment or was never found.
  let credentialPath = "";
  if (apiKey) {
    if (useCli) credentialPath = files.cliPath;
    else if (str(env.OPENVIKING_BEARER_TOKEN, str(env.OPENVIKING_API_KEY, ""))) credentialPath = "";
    else if (str(files.cliFile.api_key, "")) credentialPath = files.cliPath;
    else credentialPath = files.ovPath;
  }

  return {
    ...files,
    credentialSource: useCli ? "ovcli" : ((mode === "env" || envHasCredentials) ? "env" : "auto"),
    credentialPath,
    baseUrl,
    mcpUrl,
    apiKey,
    account,
    user,
    peerId,
    hasApiKey: Boolean(apiKey),
  };
}
