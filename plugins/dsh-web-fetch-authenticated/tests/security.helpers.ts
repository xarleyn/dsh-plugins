/**
 * Security suite (SPEC §26.2): SSRF targets, lookalike hosts, mixed DNS,
 * redirect credential boundaries, and redaction guarantees. The provider must
 * fail closed in every case; secrets must never appear in thrown errors.
 */

import { expect } from "vitest";
import { WebError } from "@deepseek-ai/dsh-web";
import { AuthenticatedFetchProvider } from "../src/provider.js";
import { fakeCredentials } from "./helpers.js";
import type { WebFetchAuthConfig } from "../src/types.js";

export const SECRET = "super-secret-token-value";

export function newProvider(config: WebFetchAuthConfig): {
  provider: AuthenticatedFetchProvider;
  credentialRefs: string[];
} {
  const credentials = fakeCredentials({
    TEST_TOKEN: SECRET,
    TEST_PASSWORD: SECRET,
  });
  const provider = new AuthenticatedFetchProvider({
    configSource: () => config,
    credentials,
    logger: {
      info: () => {},
      warn: () => {},
      child: () => ({ info: () => {} }) as never,
    } as never,
  });
  return { provider, credentialRefs: credentials.lookups };
}

export async function expectWebError(
  code: string,
  run: () => Promise<unknown>,
): Promise<WebError> {
  try {
    await run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(WebError);
    const webError = error as WebError;
    expect(webError.code, errorText(webError)).toBe(code);
    return webError;
  }
  throw new Error(`expected WebError ${code}, but the call succeeded`);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
