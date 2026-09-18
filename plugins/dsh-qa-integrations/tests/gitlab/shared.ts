import { resolveConfig } from "../../src/config.js";
import { type GitlabFlags } from "../../src/providers/gitlab/config.js";
import { GitlabProvider } from "../../src/providers/gitlab/index.js";

export const TOKEN = "glpat-abcdefghij0123456789";

export const GITLAB_COM = {
  id: "gitlab-com",
  label: "GitLab.com",
  baseUrl: "https://gitlab.com",
};
export const CORP = {
  id: "corp",
  label: "Corporate GitLab",
  baseUrl: "https://gitlab.example.internal",
};
export const INSTANCES = [GITLAB_COM, CORP];

export function config(gitlab: Partial<GitlabFlags> = {}) {
  return resolveConfig({ gitlab: { instances: INSTANCES, ...gitlab } });
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

export const USER = { id: 153, username: "alice", name: "Alice Example" };

/** Credential plaintext as `parseCredential` stores it. */
export function credentialFor(instanceId: string, fetcher: typeof fetch) {
  const provider = new GitlabProvider(config(), fetcher);
  return provider.parseCredential(TOKEN, { instanceId }).credential;
}
