import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { schemaParse } from "../config/config.helpers.js";

const oidc = {
  enabled: true,
  issuer: "https://id.example.corp/realms/demo",
  clientId: "qa-surface",
  redirectUri: "https://qa.example.corp/qa/oidc/callback",
};

describe("QA OIDC configuration", () => {
  it("stays opt-in, preserving local authentication defaults", () => {
    expect(resolveConfig().accounts).toMatchObject({
      localLogin: true,
      oidc: { enabled: false },
    });
  });
  it("retains settings through the Host schema without carrying a client secret", () => {
    const parsed = schemaParse({
      accounts: { enabled: true, localLogin: false, oidc },
    });
    expect(parsed.accounts).toMatchObject({ localLogin: false, oidc });
  });
  it.each([
    { enabled: false, oidc },
    { enabled: true, localLogin: false },
    { enabled: true, oidc: { ...oidc, issuer: "http://id.example.corp" } },
    {
      enabled: true,
      oidc: {
        ...oidc,
        issuer: "https://" + "user:password" + "@id.example.corp",
      },
    },
    {
      enabled: true,
      oidc: { ...oidc, redirectUri: oidc.redirectUri + "?next=elsewhere" },
    },
    { enabled: true, oidc: { ...oidc, sessionTtlSeconds: 86400 } },
    { enabled: true, oidc: { ...oidc, clientSecretEnv: "invalid-name" } },
    {
      enabled: true,
      oidc: { ...oidc, adminRole: "same", reviewerRole: "same" },
    },
  ])("rejects an unsafe or unusable configuration %#", (accounts) => {
    expect(() => resolveConfig({ accounts })).toThrow();
  });
});
