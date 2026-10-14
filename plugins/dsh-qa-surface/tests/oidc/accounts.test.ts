import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaAccounts } from "../../src/accounts/store.js";
import { run } from "../../src/cli.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.useRealTimers();
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "qa-oidc-store-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const open = (options = {}) => {
    const store = new QaAccounts(path.join(directory, "accounts.db"), {
      allowRegistration: true,
      sessionTtlDays: 30,
      ...options,
    });
    cleanup.push(() => store.close());
    return store;
  };
  return { store: open(), open };
}
const identity = () => ({
  issuer: "https://id.example.corp/realms/demo",
  subject: "subject-1",
  email: "reader@example.com",
  displayName: "Demo Reader",
  role: "user" as const,
  expiresAt: Date.now() + 300_000,
  autoProvision: true,
});

describe("OIDC account storage and access boundaries", () => {
  it("persists issuer+subject across stores, preserving identity when email changes", () => {
    const f = fixture();
    const first = f.store.loginOidc(identity());
    const second = f
      .open()
      .loginOidc({ ...identity(), email: "renamed@example.com" });
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.authMethod).toBe("oidc");
    expect(f.open().whoami(second.token)).toMatchObject({
      authenticated: true,
      user: { authMethod: "oidc" },
    });
    expect(f.store.listUsers()).toHaveLength(1);
    expect(second.user.role).toBe("user");
  });

  it("refuses automatic email linking and requires explicit operator attachment", () => {
    const f = fixture();
    const local = f.store.register("reader@example.com", "synthetic-password");
    f.store.claimSessions(local.token, ["owned-chat"]);
    expect(() => f.store.loginOidc(identity())).toThrow();
    f.store.linkOidcIdentity(
      local.user.email,
      identity().issuer,
      identity().subject,
    );
    expect(f.store.verifyToken(local.token)).toBeNull();
    const corporate = f.store.loginOidc(identity());
    expect(corporate.user.id).toBe(local.user.id);
    expect(f.store.ownedSessionIds(corporate.token)).toContain("owned-chat");
    expect(() =>
      f.store.login(local.user.email, "synthetic-password"),
    ).toThrow();
    expect(() =>
      f.store.setPassword(local.user.email, "new-synthetic-password"),
    ).toThrow();
    f.store.requestPasswordReset(local.user.email);
    expect(f.store.passwordResetRequests()).toHaveLength(0);
  });

  it("separates subjects and issuers even when they use the same email", () => {
    const f = fixture();
    f.store.loginOidc(identity());
    expect(() =>
      f.store.loginOidc({ ...identity(), subject: "other-subject" }),
    ).toThrow();
    expect(() =>
      f.store.loginOidc({
        ...identity(),
        issuer: "https://other.example.corp",
      }),
    ).toThrow();
  });

  it("links through the operator CLI and keeps its persistent account ID", () => {
    const f = fixture();
    const local = f.store.register("reader@example.com", "synthetic-password");
    const io = { out: vi.fn(), err: vi.fn() };
    expect(
      run(
        [
          "--file",
          f.store.filePath,
          "link-oidc",
          local.user.email,
          identity().issuer,
          identity().subject,
        ],
        io,
      ),
    ).toBe(0);
    expect(f.store.verifyToken(local.token)).toBeNull();
    expect(f.store.loginOidc(identity()).user.id).toBe(local.user.id);
  });

  it("revokes only the logged-out QA session across database connections", () => {
    const f = fixture();
    const first = f.store.loginOidc(identity());
    const second = f.store.loginOidc(identity());
    f.open().logoutOidc(first.token);
    expect(f.store.whoami(first.token).authenticated).toBe(false);
    expect(() => f.store.requireUser(first.token)).toThrow();
    expect(f.store.verifyToken(second.token)).toBe(second.user.id);
  });

  it("expires sessions and immediately applies operator disable/revoke", () => {
    const f = fixture();
    vi.useFakeTimers();
    const session = f.store.loginOidc(identity());
    vi.setSystemTime(Date.now() + 300_001);
    expect(f.store.verifyToken(session.token)).toBeNull();
    const next = f.store.loginOidc(identity());
    f.open().revokeTokens(next.user.email);
    expect(f.store.verifyToken(next.token)).toBeNull();
    const active = f.store.loginOidc(identity());
    f.open().setUserDisabled(active.user.email, true);
    expect(f.store.whoami(active.token).authenticated).toBe(false);
    expect(() => f.store.loginOidc(identity())).toThrow();
  });

  it("revokes existing tokens when signed provider roles change", () => {
    const f = fixture();
    const admin = f.store.loginOidc({ ...identity(), role: "admin" });
    const user = f.store.loginOidc(identity());
    expect(f.store.verifyToken(admin.token)).toBeNull();
    expect(user.user.role).toBe("user");
  });

  it("requires linking when provisioning is disabled", () => {
    const f = fixture();
    expect(() =>
      f.store.loginOidc({ ...identity(), autoProvision: false }),
    ).toThrow();
    expect(f.store.listUsers()).toHaveLength(0);
  });

  it("enforces disabled authentication methods server-side, including existing tokens", () => {
    const f = fixture();
    const local = f.store.register("local@example.com", "synthetic-password");
    const corporate = f.store.loginOidc(identity());
    const onlyOidc = f.open({ localLogin: false, oidcEnabled: true });
    expect(() =>
      onlyOidc.login("local@example.com", "synthetic-password"),
    ).toThrow();
    expect(() =>
      onlyOidc.register("new@example.com", "synthetic-password"),
    ).toThrow();
    expect(onlyOidc.verifyToken(local.token)).toBeNull();
    expect(onlyOidc.verifyToken(corporate.token)).toBe(corporate.user.id);
    expect(
      f.open({ oidcEnabled: false }).verifyToken(corporate.token),
    ).toBeNull();
  });
});
