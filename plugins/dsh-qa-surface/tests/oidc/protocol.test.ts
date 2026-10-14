import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as oidc from "openid-client";
import { QaAccounts } from "../../src/accounts/store.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaOidcService } from "../../src/oidc/service.js";
import type { QaSurfaceConfig } from "../../src/types.js";

const issuer = "https://id.example.corp/realms/demo";
const redirectUri = "https://qa.example.corp/qa/oidc/callback";
const clientId = "qa-surface";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function fixture(overrides: QaSurfaceConfig["accounts"] = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "qa-oidc-"));
  const accounts = new QaAccounts(path.join(directory, "accounts.db"), {
    sessionTtlDays: 30,
    allowRegistration: true,
    oidcEnabled: true,
  });
  cleanup.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => accounts.close(),
  );
  let input: QaSurfaceConfig = {
    accounts: {
      enabled: true,
      oidc: { enabled: true, issuer, clientId, redirectUri },
      ...overrides,
    },
  };
  let authorization = new URL(issuer);
  let claims: Record<string, unknown> = {};
  let badSignature = false;
  let tokenRequests = 0;
  let jwksRequests = 0;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  const fetch: oidc.CustomFetch = async (url, init) => {
    const destination = new URL(String(url));
    if (destination.pathname.endsWith("/.well-known/openid-configuration"))
      return json({
        issuer,
        authorization_endpoint: issuer + "/auth",
        token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/certs",
        end_session_endpoint: issuer + "/logout",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
      });
    if (destination.pathname.endsWith("/certs")) {
      jwksRequests++;
      return json({ keys: [jwk] });
    }
    if (destination.pathname.endsWith("/token")) {
      tokenRequests++;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("redirect_uri")).toBe(redirectUri);
      expect(
        createHash("sha256")
          .update(body.get("code_verifier") ?? "")
          .digest("base64url"),
      ).toBe(authorization.searchParams.get("code_challenge"));
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: issuer,
        aud: clientId,
        sub: "directory-subject",
        iat: now,
        exp: now + 600,
        nonce: authorization.searchParams.get("nonce"),
        email: "reader@example.com",
        email_verified: true,
        name: "Demo Reader",
        ...claims,
      };
      const data =
        Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString(
          "base64url",
        ) +
        "." +
        Buffer.from(JSON.stringify(payload)).toString("base64url");
      const signature = sign("RSA-SHA256", Buffer.from(data), pair.privateKey);
      if (badSignature) signature[0] = (signature[0] ?? 0) ^ 1;
      return json({
        token_type: "Bearer",
        access_token: "synthetic-access-token",
        expires_in: 600,
        id_token: data + "." + signature.toString("base64url"),
      });
    }
    throw new Error("Unexpected fixture endpoint");
  };
  const service = new QaOidcService({
    config: () => resolveConfig(input),
    accounts: () => accounts,
    discover: (server, id, metadata, auth, options) =>
      oidc.discovery(server, id, metadata, auth, {
        ...options,
        [oidc.customFetch]: fetch,
      }),
  });
  async function begin() {
    const start = await service.start();
    authorization = new URL(start.authorizationUrl);
    return start;
  }
  function callback(state = authorization.searchParams.get("state") ?? "") {
    return service.callback(
      new URL(redirectUri).pathname +
        "?code=synthetic-code&state=" +
        encodeURIComponent(state),
    );
  }
  return {
    service,
    accounts,
    begin,
    callback,
    setClaims: (value: Record<string, unknown>) => {
      claims = value;
    },
    corruptSignature: () => {
      badSignature = true;
    },
    setConfig: (value: QaSurfaceConfig) => {
      input = value;
    },
    requests: () => ({ tokenRequests, jwksRequests }),
    authorization: () => authorization,
  };
}

describe("QA OIDC protocol with signed provider responses", () => {
  it("validates discovery, PKCE and JWKS, then issues one account-bound QA session", async () => {
    const f = fixture();
    const start = await f.begin();
    expect(f.authorization().searchParams.get("scope")).toBe(
      "openid profile email",
    );
    expect(f.authorization().searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    const destination = new URL(await f.callback());
    expect(destination.origin + destination.pathname).toBe(
      "https://qa.example.corp/qa",
    );
    expect(destination.search).toBe("");
    const handoff =
      new URLSearchParams(destination.hash.slice(1)).get("qa-oidc") ?? "";
    expect(() => f.service.complete(handoff, "wrong-browser-proof")).toThrow();
    const session = f.service.complete(handoff, start.completionKey);
    expect(session.user.role).toBe("user");
    expect(f.accounts.verifyToken(session.token)).toBe(session.user.id);
    expect(() => f.service.complete(handoff, start.completionKey)).toThrow();
    await expect(f.callback()).rejects.toThrow();
    expect(f.requests()).toEqual({ tokenRequests: 1, jwksRequests: 1 });
    expect(() =>
      f.accounts.login(session.user.email, "any-password"),
    ).toThrow();
  });

  it.each([
    ["wrong audience", { aud: "other-client" }],
    ["wrong issuer", { iss: "https://other.example.corp/realms/demo" }],
    ["wrong nonce", { nonce: "other-nonce" }],
    ["expired identity", { exp: 1 }],
    ["unverified email", { email_verified: false }],
    ["missing email", { email: null }],
    ["empty subject", { sub: "" }],
  ])("rejects %s", async (_name, claims) => {
    const f = fixture();
    await f.begin();
    f.setClaims(claims);
    await expect(f.callback()).rejects.toThrow("Corporate sign-in failed");
    expect(f.accounts.listUsers()).toHaveLength(0);
  });

  it("rejects a tampered signature even when token endpoint TLS is trusted", async () => {
    const f = fixture();
    await f.begin();
    f.corruptSignature();
    await expect(f.callback()).rejects.toThrow();
    expect(f.accounts.listUsers()).toHaveLength(0);
  });

  it("rejects unknown state without exchanging a code", async () => {
    const f = fixture();
    await f.begin();
    await expect(f.callback("other-state")).rejects.toThrow();
    expect(f.requests().tokenRequests).toBe(0);
  });

  it("rejects duplicate state, foreign origin and wrong callback path", async () => {
    const f = fixture();
    await f.begin();
    const state = f.authorization().searchParams.get("state");
    for (const url of [
      redirectUri + "?code=x&state=" + state + "&state=" + state,
      "https://other.example.corp/qa/oidc/callback?code=x&state=" + state,
      "/qa/other?code=x&state=" + state,
    ])
      await expect(f.service.callback(url)).rejects.toThrow();
    expect(f.requests().tokenRequests).toBe(0);
  });

  it("admits only configured client roles, with explicit admin mapping", async () => {
    const f = fixture({
      oidc: {
        enabled: true,
        issuer,
        clientId,
        redirectUri,
        requiredRole: "qa-access",
        adminRole: "qa-admin",
      },
    });
    await f.begin();
    await expect(f.callback()).rejects.toThrow();
    const start = await f.begin();
    f.setClaims({
      resource_access: { [clientId]: { roles: ["qa-access", "qa-admin"] } },
    });
    const destination = new URL(await f.callback());
    const session = f.service.complete(
      new URLSearchParams(destination.hash.slice(1)).get("qa-oidc") ?? "",
      start.completionKey,
    );
    expect(session.user.role).toBe("admin");
    const logout = await f.service.logout(session.token);
    expect(new URL(logout ?? "").pathname).toBe("/realms/demo/logout");
    expect(f.accounts.verifyToken(session.token)).toBeNull();
  });

  it("expires transactions and handoffs and invalidates them on configuration changes", async () => {
    const f = fixture();
    vi.useFakeTimers();
    const start = await f.begin();
    const location = new URL(await f.callback());
    const handoff =
      new URLSearchParams(location.hash.slice(1)).get("qa-oidc") ?? "";
    vi.setSystemTime(Date.now() + 60_001);
    expect(() => f.service.complete(handoff, start.completionKey)).toThrow();
    await f.begin();
    vi.setSystemTime(Date.now() + 300_001);
    await expect(f.callback()).rejects.toThrow();
    await f.begin();
    f.setConfig({ accounts: { enabled: true } });
    await expect(f.callback()).rejects.toThrow();
  });

  it("fails closed for disabled OIDC and missing server secret", async () => {
    const f = fixture({
      oidc: {
        enabled: true,
        issuer,
        clientId,
        redirectUri,
        clientSecretEnv: "QA_OIDC_FIXTURE_MISSING_SECRET",
      },
    });
    await expect(f.begin()).rejects.toThrow();
    expect(f.requests().tokenRequests).toBe(0);
  });

  it("supports confidential clients without sending a secret to the browser", async () => {
    vi.stubEnv("QA_OIDC_FIXTURE_SECRET", "synthetic-client-secret");
    const f = fixture({
      oidc: {
        enabled: true,
        issuer,
        clientId,
        redirectUri,
        clientSecretEnv: "QA_OIDC_FIXTURE_SECRET",
      },
    });
    const start = await f.begin();
    expect(start.authorizationUrl).not.toContain("synthetic-client-secret");
    await expect(f.callback()).resolves.toContain("#qa-oidc=");
  });

  it("rate limits start requests before contacting the provider again", async () => {
    const f = fixture({ maxAuthAttemptsPerMinute: 1 });
    await f.begin();
    await expect(f.begin()).rejects.toThrow();
  });
});
