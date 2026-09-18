/**
 * Integration suite over local fixture servers (SPEC §26.3): Bearer/Basic/API-key
 * auth, same-origin redirects, size/timeout limits, non-2xx-as-result, and the
 * sanitized tester/diagnose reports.
 */

import { expect } from "vitest";
import { WebError } from "@deepseek-ai/dsh-web";
import { AuthenticatedFetchProvider } from "../src/provider.js";
import { fakeCredentials } from "./helpers.js";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { WebFetchAuthConfig } from "../src/types.js";

export const SECRET = "fixture-secret-token";

export function silentLogger(): PluginLogger {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => silentLogger(),
    level: "error",
    setLevel: () => {},
  } as unknown as PluginLogger;
}

export function newProvider(config: WebFetchAuthConfig): {
  provider: AuthenticatedFetchProvider;
  lookups: string[];
} {
  const credentials = fakeCredentials({
    TEST_TOKEN: SECRET,
    TEST_PASSWORD: SECRET,
  });
  const provider = new AuthenticatedFetchProvider({
    configSource: () => config,
    credentials,
    logger: silentLogger(),
  });
  return { provider, lookups: credentials.lookups };
}

export async function expectCode(
  code: string,
  run: () => Promise<unknown>,
): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(WebError);
    expect((error as WebError).code, String(error)).toBe(code);
    return String(error);
  }
  throw new Error(`expected ${code}`);
}
