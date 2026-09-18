import { resolveConfig } from "../../src/config.js";
import { type TeamCityConfigInput } from "../../src/providers/teamcity/config.js";
import { TeamcityProvider } from "../../src/providers/teamcity/index.js";

export const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

export const SERVER = "https://teamcity.example.com";
export const NETWORK = {
  mode: "allowlist" as const,
  allowedHosts: ["teamcity.example.com", "*.corp.example"],
  allowedCidrs: ["10.20.0.0/16"],
  allowedPorts: [443, 8111],
};

export function config(teamcity: TeamCityConfigInput = {}) {
  // A deployment that mounts TeamCity configures its address; a test that wants
  // the unconfigured deployment passes `serverUrl: ""` explicitly.
  return resolveConfig({
    teamcity: { network: NETWORK, serverUrl: SERVER, ...teamcity },
  });
}

export interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Record<string, string>;
}

export interface StubCall {
  readonly url: URL;
  readonly init: RequestInit;
}

export function stub(handler: (url: URL) => StubResult) {
  const calls: StubCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    const result = handler(url);
    const headers = new Headers(result.headers ?? {});
    const status = result.status ?? 200;
    if (result.json !== undefined) {
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(result.json), { status, headers });
    }
    headers.set("content-type", headers.get("content-type") ?? "text/plain");
    return new Response(result.text ?? "", { status, headers });
  };
  return { calls, fetcher };
}

export const SERVER_INFO = {
  version: "2025.11",
  versionMajor: 2025,
  buildNumber: "1",
};
export const USER = { id: 42, username: "alice", name: "Alice Example" };

/** Credential plaintext as `parseCredential` stores it. */
export function credentialFor(
  fetcher: typeof fetch,
  teamcity: TeamCityConfigInput = {},
) {
  return new TeamcityProvider(config(teamcity), fetcher).parseCredential(TOKEN)
    .credential;
}
