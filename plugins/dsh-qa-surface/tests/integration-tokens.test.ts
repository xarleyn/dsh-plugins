import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseServiceToken,
  QA_SERVICE_TOKEN_PREFIX,
} from "../src/accounts/service-token.js";
import { reasonOf, rowsOf, store } from "./accounts.helpers.js";

/**
 * Integration tokens: the credential the HTTP API authenticates with. These
 * tests hold the invariants that make it safe to hand one to a machine that
 * runs unattended — the secret is never stored, revocation is immediate, and
 * no other account's credential can be reached with it.
 */
describe("integration tokens", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints a credential once and stores only its digest", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const issued = accounts.mintServiceToken(admin.token, {
      label: "ticket bridge",
    });
    expect(issued.token.startsWith(`${QA_SERVICE_TOKEN_PREFIX}.`)).toBe(true);
    expect(issued.label).toBe("ticket bridge");
    expect(issued.scopes).toEqual(["ask"]);
    const parsed = parseServiceToken(issued.token);
    expect(parsed?.tokenId).toBe(issued.id);
    // The plaintext exists in this call and nowhere else: the row keeps a
    // 64-character digest, and the list shows no way to recover a secret.
    const hashes = rowsOf(
      accounts.filePath,
      `SELECT token_hash FROM qa_service_tokens WHERE id = '${issued.id}'`,
    );
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toHaveLength(64);
    expect(hashes[0]).not.toContain(parsed?.secret);
    expect(
      JSON.stringify(accounts.listServiceTokens(admin.token)),
    ).not.toContain(parsed?.secret ?? "never");
  });

  it("verifies a presented token and records the use", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const issued = accounts.mintServiceToken(admin.token, { scopes: ["ask"] });
    const verified = accounts.verifyServiceToken(issued.token);
    expect(verified).toEqual({
      tokenId: issued.id,
      userId: admin.user.id,
      scopes: ["ask"],
    });
    const summary = accounts.listServiceTokens(admin.token)[0];
    expect(summary?.useCount).toBe(1);
    expect(summary?.lastUsedAt).not.toBeNull();
  });

  it("refuses a forged, unknown, revoked or expired credential", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const issued = accounts.mintServiceToken(admin.token, { ttlDays: 1 });
    expect(accounts.verifyServiceToken(issued.token)).not.toBeNull();

    // A foreign secret on a real id, a real secret on a foreign id, and a
    // credential that is not ours at all: one answer, null.
    const parsed = parseServiceToken(issued.token);
    expect(
      accounts.verifyServiceToken(
        `${QA_SERVICE_TOKEN_PREFIX}.${parsed?.tokenId ?? ""}.nope`,
      ),
    ).toBeNull();
    expect(
      accounts.verifyServiceToken(
        `${QA_SERVICE_TOKEN_PREFIX}.00000000-0000-4000-8000-000000000000.${parsed?.secret ?? ""}`,
      ),
    ).toBeNull();
    expect(accounts.verifyServiceToken("v1.payload.signature")).toBeNull();
    expect(accounts.verifyServiceToken("")).toBeNull();

    vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
    expect(accounts.verifyServiceToken(issued.token)).toBeNull();

    vi.setSystemTime(new Date("2026-09-21T10:01:00Z"));
    expect(accounts.revokeServiceToken(admin.token, issued.id)).toBe(true);
    expect(accounts.verifyServiceToken(issued.token)).toBeNull();
    expect(accounts.revokeServiceToken(admin.token, issued.id)).toBe(false);
  });

  it("stops working the moment the account is disabled", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const issued = accounts.mintServiceToken(admin.token);
    accounts.setUserDisabled("op@example.com", true);
    expect(accounts.verifyServiceToken(issued.token)).toBeNull();
  });

  it("dies with the account's other credentials when the operator revokes all", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const issued = accounts.mintServiceToken(admin.token);
    // A password change must not log a service out — that is why the token
    // carries no `tokenVersion` — but the operator's explicit leak response
    // must reach it.
    accounts.setPassword("op@example.com", "password-2");
    expect(accounts.verifyToken(admin.token)).toBeNull();
    expect(accounts.verifyServiceToken(issued.token)).not.toBeNull();
    accounts.revokeTokens("op@example.com");
    expect(accounts.verifyServiceToken(issued.token)).toBeNull();
  });

  it("grants exactly the requested scopes and drops unknown ones", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const issued = accounts.mintServiceToken(admin.token, {
      scopes: ["sessions:read", "root", "sessions:read"],
    });
    expect(issued.scopes).toEqual(["sessions:read"]);
    expect(accounts.verifyServiceToken(issued.token)?.scopes).toEqual([
      "sessions:read",
    ]);
    const empty = accounts.mintServiceToken(admin.token, { scopes: [] });
    expect(empty.scopes).toEqual([]);
    // An empty scope list is a token that can do nothing, not a token that can
    // do everything.
    expect(accounts.verifyServiceToken(empty.token)?.scopes).toEqual([]);
  });

  it("keeps one account's tokens out of another's reach", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const other = accounts.register("user@example.com", "password-2");
    const issued = accounts.mintServiceToken(admin.token, { label: "bridge" });
    expect(accounts.listServiceTokens(other.token)).toHaveLength(0);
    // Same refusal for "no such token" and "not yours".
    expect(
      reasonOf(() => accounts.revokeServiceToken(other.token, issued.id)),
    ).toBe("forbidden");
    expect(accounts.verifyServiceToken(issued.token)).not.toBeNull();

    // Only an administrator may mint for somebody else, and the token works
    // for the account it names.
    expect(
      reasonOf(() =>
        accounts.mintServiceToken(other.token, { userId: admin.user.id }),
      ),
    ).toBe("admin-required");
    const forOther = accounts.mintServiceToken(admin.token, {
      userId: other.user.id,
      label: "for the bridge",
    });
    expect(accounts.verifyServiceToken(forOther.token)?.userId).toBe(
      other.user.id,
    );
    expect(accounts.listServiceTokens(other.token)).toHaveLength(1);
  });

  it("bounds the lifetime and the label of a minted token", () => {
    const accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    const long = accounts.mintServiceToken(admin.token, { ttlDays: 99_999 });
    expect(long.expiresAt.slice(0, 4)).toBe("2036");
    const short = accounts.mintServiceToken(admin.token, { ttlDays: -5 });
    expect(Date.parse(short.expiresAt)).toBeGreaterThan(Date.now());
    const labelled = accounts.mintServiceToken(admin.token, {
      label: "x".repeat(500),
    });
    expect(labelled.label.length).toBe(80);
    const unlabelled = accounts.mintServiceToken(admin.token);
    expect(unlabelled.label).toBe("integration");
  });
});
