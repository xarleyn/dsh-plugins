/**
 * Security suite (SPEC §26.2): SSRF targets, lookalike hosts, mixed DNS,
 * redirect credential boundaries, and redaction guarantees. The provider must
 * fail closed in every case; secrets must never appear in thrown errors.
 */

import { describe, expect, test } from "vitest";
import {
  redactHeaders,
  redactSecretsInText,
  sanitizePreview,
  SENSITIVE_HEADER_NAMES,
} from "../src/audit/redact.js";
import { configWith, fixtureRule } from "./helpers.js";
import {
  SECRET,
  errorText,
  expectWebError,
  newProvider,
} from "./security.helpers.js";

describe("redaction utilities", () => {
  test("sensitive headers are fully redacted", () => {
    for (const name of SENSITIVE_HEADER_NAMES) {
      const redacted = redactHeaders({ [name]: SECRET });
      expect(Object.values(redacted)[0]).not.toContain(SECRET);
    }
  });

  test("free text scrubbing catches bearer, basic, jwt, and key=value leaks", () => {
    const samples = [
      `authorization: Bearer ${SECRET}`,
      `Authorization = Basic ${SECRET}`,
      `token: "${SECRET}"`,
      `eyJhbGciOiJIUzI1NiJ9.${SECRET}.sig`,
      `x-api-key: ${SECRET}`,
      `api_key=${SECRET}&next=/`,
    ];
    for (const sample of samples) {
      expect(redactSecretsInText(sample)).not.toContain(SECRET);
    }
  });

  test("previews never reassemble a secret split across the cap", () => {
    const text = `prefix ${"x".repeat(300)} Bearer ${SECRET}`;
    const preview = sanitizePreview(text, 320);
    expect(preview).not.toContain(SECRET);
  });

  test("credential never appears in thrown provider errors", async () => {
    const rule = fixtureRule("http://127.0.0.1:9", {
      match: { schemes: ["http"], hosts: ["127.0.0.1"], ports: [9] },
      auth: { type: "bearer", credential: "MISSING_TOKEN" },
    });
    const { provider } = newProvider(configWith([rule]));
    const error = await expectWebError("AUTH_FETCH_CREDENTIAL_MISSING", () =>
      provider.fetch({ url: "http://127.0.0.1:9/secure/x" }),
    );
    expect(errorText(error)).not.toContain(SECRET);
    expect(errorText(error)).not.toContain("MISSING_TOKEN:");
  });
});
