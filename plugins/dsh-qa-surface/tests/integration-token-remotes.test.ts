import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createQaAccountRemotes } from "../src/account-remotes.js";
import type { QaAccountRemotes } from "../src/account-remotes.js";
import type { QaAccounts } from "../src/accounts/store.js";
import { resolveConfig } from "../src/resolve-config.js";
import type { ResolvedQaSurfaceConfig } from "../src/types.js";

/**
 * The account remotes that back the profile page's integration-token section.
 *
 * The store itself is covered where it lives (`integration-tokens.test.ts`);
 * what is under test here is the seam the browser reaches: which config makes
 * minting meaningful, that the owner is always the authenticated account, and
 * that a list never carries a secret.
 *
 * The context builds its store at the deployment's own accounts path, which
 * `DSH_HOME` points at a temporary directory for the duration of a test.
 */

const HOME_KEY = "DSH_HOME";

function logger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    close() {},
  } as never;
}

function context(config: ResolvedQaSurfaceConfig): {
  readonly remotes: QaAccountRemotes;
  readonly store: QaAccounts;
} {
  const remotes = createQaAccountRemotes({
    getConfig: () => config,
    logger: logger(),
  });
  const store = remotes.resolve(config);
  if (store === undefined) throw new Error("accounts are disabled");
  return { remotes, store };
}

/**
 * The reason code the browser reads off a refusal. The remote layer folds the
 * store's typed error into a plain one carrying the `(reason: <code>)` marker,
 * so this asserts the wire form rather than the Host's own class.
 */
function refusalReason(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /\(reason: ([a-z-]+)\)/u.exec(message)?.at(1);
    if (reason === undefined) throw error;
    return reason;
  }
  throw new Error("expected the remote to refuse");
}

function config(integrationEnabled: boolean): ResolvedQaSurfaceConfig {
  return resolveConfig({
    accounts: { enabled: true },
    integration: { enabled: integrationEnabled },
  });
}

describe("integration token remotes", () => {
  const originalHome = process.env[HOME_KEY];
  let open: QaAccounts | undefined;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "qa-token-home-"));
    process.env[HOME_KEY] = home;
  });

  afterEach(() => {
    open?.close();
    open = undefined;
    if (originalHome === undefined) delete process.env[HOME_KEY];
    else process.env[HOME_KEY] = originalHome;
  });

  it("mints for the caller, lists it without the secret, and revokes it", () => {
    const resolved = config(true);
    const { remotes, store } = context(resolved);
    open = store;
    const admin = remotes.register("op@example.com", "password-1");

    const issued = remotes.createServiceToken(admin.token, {
      label: "мост заявок",
      scopes: ["ask"],
      ttlDays: 30,
    });
    expect(issued.token.startsWith("qsat.")).toBe(true);
    expect(issued.label).toBe("мост заявок");
    expect(issued.scopes).toEqual(["ask"]);
    // The credential works: the same store accepts it as an integration.
    expect(store.verifyServiceToken(issued.token)).toMatchObject({
      userId: store.findUser("op@example.com")?.id,
      scopes: ["ask"],
    });

    const listed = remotes.listServiceTokens(admin.token);
    expect(listed.tokens).toHaveLength(1);
    expect(listed.tokens[0]?.id).toBe(issued.id);
    // A list must never carry a credential back to the page.
    expect(JSON.stringify(listed)).not.toContain(issued.token);
    expect(Object.keys(listed.tokens[0] ?? {})).not.toContain("token");

    expect(remotes.revokeServiceToken(admin.token, issued.id)).toEqual({
      revoked: true,
    });
    expect(store.verifyServiceToken(issued.token)).toBeNull();
    // Revoking twice is not an error, it is a no-op the page can report.
    expect(remotes.revokeServiceToken(admin.token, issued.id)).toEqual({
      revoked: false,
    });
  });

  it("refuses to mint while the API the token is for is switched off", () => {
    const resolved = config(false);
    const { remotes, store } = context(resolved);
    open = store;
    const admin = remotes.register("op@example.com", "password-1");

    expect(
      refusalReason(() => remotes.createServiceToken(admin.token, {})),
    ).toBe("integration-disabled");
    // A credential that already exists has to stay revocable even with the
    // endpoint off, so the read path is not gated the same way.
    expect(remotes.listServiceTokens(admin.token).tokens).toEqual([]);
  });

  it("keeps each account's tokens to itself", () => {
    const resolved = config(true);
    const { remotes, store } = context(resolved);
    open = store;
    const first = remotes.register("first@example.com", "password-1");
    const second = remotes.register("second@example.com", "password-2");

    const mine = remotes.createServiceToken(first.token, { label: "мой" });
    const theirs = remotes.createServiceToken(second.token, { label: "чужой" });

    expect(
      remotes.listServiceTokens(first.token).tokens.map((t) => t.id),
    ).toEqual([mine.id]);
    expect(
      refusalReason(() => remotes.revokeServiceToken(first.token, theirs.id)),
    ).toBe("forbidden");
    // The refusal changed nothing: the other account's credential still works.
    expect(store.verifyServiceToken(theirs.token)).not.toBeNull();
  });

  it("refuses a caller without a live session", () => {
    const resolved = config(true);
    const { remotes, store } = context(resolved);
    open = store;
    remotes.register("op@example.com", "password-1");
    for (const call of [
      () => remotes.listServiceTokens("not-a-token"),
      () => remotes.createServiceToken("not-a-token", {}),
      () => remotes.revokeServiceToken("not-a-token", "whatever"),
    ]) {
      expect(refusalReason(call)).toBe("auth-required");
    }
  });
});
