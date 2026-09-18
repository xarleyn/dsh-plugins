import { resolveConfig } from "../../src/config.js";
import { type TestitFlags } from "../../src/providers/testit/config.js";
import { TestitProvider } from "../../src/providers/testit/index.js";

export const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

export const INSTANCE = {
  id: "cloud",
  label: "Test IT Cloud",
  baseUrl: "https://team.example.testit.software",
};
export const SECOND = {
  id: "tms",
  label: "TMS",
  baseUrl: "https://tms.corp.example",
};

/** A deployment with one configured installation unless a test says otherwise. */
export function config(testit: Partial<TestitFlags> = {}) {
  return resolveConfig({
    testit: { instances: [{ ...INSTANCE }], ...testit },
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

/** Credential plaintext as `parseCredential` stores it. */
export function credentialFor(
  fetcher: typeof fetch,
  testit: Partial<TestitFlags> = {},
  options: Readonly<Record<string, string>> = { instanceId: INSTANCE.id },
) {
  return new TestitProvider(config(testit), fetcher).parseCredential(
    TOKEN,
    options,
  ).credential;
}

export const PROJECTS = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Mobile" },
];
