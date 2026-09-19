import { resolveConfig } from "../src/config.js";
import { Bitrix24Provider } from "../src/providers/bitrix24/index.js";
import { resolveBitrix24Config } from "../src/providers/bitrix24/config.js";
import { BITRIX_OPERATIONS } from "../src/providers/bitrix24/catalog.js";
import { evaluateServiceOperation } from "../src/service-credentials/policy.js";
import { UNCLASSIFIED_OPERATION } from "../src/service-credentials/types.js";
import type {
  ServiceCredentialProfile,
  ServiceResourceBoundary,
} from "../src/service-credentials/types.js";

export const WEBHOOK_SECRET = "s3crettokenvalue01";
export const PORTAL = "company.bitrix24.ru";

export const BOUNDARY = Object.freeze({
  portals: Object.freeze([PORTAL]),
});

export function config() {
  return resolveConfig({
    bitrix24: {
      instances: [{ id: "corp", label: "Corporate Bitrix24", portal: PORTAL }],
    },
  });
}

export const WEBHOOK = `https://${PORTAL}/rest/1/${WEBHOOK_SECRET}/`;

export function plaintext(): string {
  return JSON.stringify({
    webhookBaseUrl: `https://${PORTAL}/rest/1/${WEBHOOK_SECRET}`,
  });
}

export interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
}

export function stub(handler: (url: URL) => StubResult) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const result = handler(url);
    return new Response(JSON.stringify(result.json ?? {}), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

/** A service call: the broker hands the provider a boundary and the mode. */
export function serviceContext(boundary: ServiceResourceBoundary = BOUNDARY) {
  return {
    credentialSource: "service" as const,
    resourceBoundary: boundary,
  };
}

export function profile(): ServiceCredentialProfile {
  return {
    id: "bitrix24-corp-readonly",
    provider: "bitrix24",
    instance: "corp",
    portal: PORTAL,
    label: "QA Bitrix24 Read-only",
    authType: "webhook",
    secretRef: "env:QA_BITRIX24_SERVICE_TOKEN",
    enabled: true,
    resources: BOUNDARY,
    policy: {},
    policyRevision: "rev",
  };
}

export {
  Bitrix24Provider,
  BITRIX_OPERATIONS,
  UNCLASSIFIED_OPERATION,
  evaluateServiceOperation,
  resolveBitrix24Config,
};
