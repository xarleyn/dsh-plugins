import { type QaIntegrationsConfig, resolveConfig } from "../../src/config.js";
import { resolveWeblateConfig } from "../../src/providers/weblate/config.js";
import { WeblateProvider } from "../../src/providers/weblate/index.js";

export const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

export const INSTANCE = "https://weblate.example.com";
export const INSTANCES = [
  { id: "main", label: "weblate.example.com", baseUrl: INSTANCE },
];

export type WeblateSlice = Parameters<typeof resolveWeblateConfig>[0];

export function config(
  weblate: WeblateSlice = {},
  shared: QaIntegrationsConfig = {},
) {
  return resolveConfig({
    ...shared,
    weblate: { instances: INSTANCES, ...weblate },
  });
}

export function provider(fetcher: typeof fetch, weblate: WeblateSlice = {}) {
  return new WeblateProvider(config(weblate), fetcher);
}

export interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
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
    return new Response(JSON.stringify(result.json ?? {}), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

/** One user row, which is what an unprivileged token sees for itself. */
export const USER = { id: 7, username: "alice", name: "Alice Example" };

export const PAGE = { count: 1, next: null, previous: null };

/** Credential plaintext as `parseCredential` stores it. */
export function credentialFor(
  token = TOKEN,
  weblate: WeblateSlice = {},
  fetcher: typeof fetch = stub(() => ({ json: {} })).fetcher,
) {
  return new WeblateProvider(config(weblate), fetcher).parseCredential(token, {
    instanceId: "main",
  }).credential;
}

export const UNIT = {
  id: 18219,
  translation: `${INSTANCE}/api/translations/app/frontend/de/`,
  language_code: "de",
  source: ["Reset password"],
  target: ["Passwort zurücksetzen"],
  state: 10,
  fuzzy: true,
  translated: false,
  approved: false,
  pending: false,
  context: "auth/reset",
  note: "Keep it short",
  explanation: "",
  location: "src/auth.ts:12",
  flags: "",
  labels: [{ name: "auth" }],
  priority: 100,
  num_words: 3,
  position: 4,
  has_suggestion: false,
  has_comment: true,
  has_failing_check: true,
  source_unit: `${INSTANCE}/api/units/18200/`,
  web_url: `${INSTANCE}/translate/app/frontend/de/?checksum=abc`,
  timestamp: "2026-09-15T06:00:00.000Z",
  last_updated: "2026-09-16T06:00:00.000Z",
  previous_source: [],
};
