import { resolveConfig } from "../../src/config.js";
import { type JiraFlags } from "../../src/providers/jira/config.js";
import { JiraProvider } from "../../src/providers/jira/index.js";

export const TOKEN = "ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789_-";
export const EMAIL = "alice@example.com";

export const COMPANY = {
  id: "company",
  label: "company.atlassian.net",
  baseUrl: "https://company.atlassian.net",
};
export const SANDBOX = {
  id: "sandbox",
  label: "Sandbox",
  baseUrl: "https://sandbox.atlassian.net",
};
export const SITES = [COMPANY, SANDBOX];

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

export function config(jira: Partial<JiraFlags> = {}) {
  return resolveConfig({ jira: { sites: SITES, ...jira } });
}

export function providerFor(
  fetcher: typeof fetch,
  jira: Partial<JiraFlags> = {},
): JiraProvider {
  return new JiraProvider(config(jira), fetcher);
}

/** Credential plaintext as `parseCredential` stores it. */
export function credentialFor(
  provider: JiraProvider,
  siteId = COMPANY.id,
  email = EMAIL,
): string {
  return provider.parseCredential(TOKEN, { siteId, email }).credential;
}

export const MYSELF = {
  accountId: "5b10ac8d82e05b22cc7d4ef5",
  displayName: "Alice Example",
  emailAddress: EMAIL,
  accountType: "atlassian",
  active: true,
  timeZone: "Europe/Moscow",
};

/** The answer every validate call needs: identity plus the Cloud check. */
export function cloud(extra: (url: URL) => StubResult | undefined) {
  return stub((url) => {
    const decided = extra(url);
    if (decided !== undefined) return decided;
    if (url.pathname.endsWith("/myself")) return { json: MYSELF };
    if (url.pathname.endsWith("/serverInfo")) {
      return { json: { deploymentType: "Cloud", version: "1001.0.0" } };
    }
    return { status: 404, json: { errorMessages: ["not found"] } };
  });
}
