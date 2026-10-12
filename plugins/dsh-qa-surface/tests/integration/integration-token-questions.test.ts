import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { QaAccounts } from "../../src/accounts/store.js";
import { store } from "../accounts/accounts.helpers.js";

describe("integration token clarification settings", () => {
  it("persists a question preference independently of scopes and enforces the token owner", () => {
    const accounts = store();
    const owner = accounts.register("owner@example.com", "demo-password-1");
    const outsider = accounts.register("other@example.com", "demo-password-1");
    const issued = accounts.mintServiceToken(owner.token, {
      scopes: ["ask"],
      allowClarifications: false,
    });
    expect(issued.allowClarifications).toBe(false);
    expect(accounts.verifyServiceToken(issued.token)).toMatchObject({
      scopes: ["ask"],
      allowClarifications: false,
    });
    expect(
      accounts.setServiceTokenClarifications(outsider.token, issued.id, true),
    ).toBe(false);
    expect(
      accounts.setServiceTokenClarifications(owner.token, issued.id, true),
    ).toBe(true);
    expect(accounts.verifyServiceToken(issued.token)).toMatchObject({
      scopes: ["ask"],
      allowClarifications: true,
    });
    const readOnly = accounts.mintServiceToken(owner.token, {
      scopes: ["sessions:read"],
      allowClarifications: false,
    });
    expect(accounts.verifyServiceToken(readOnly.token)).toMatchObject({
      scopes: ["sessions:read"],
      allowClarifications: false,
    });
    const reloaded = new QaAccounts(accounts.filePath, {
      allowRegistration: true,
      sessionTtlDays: 30,
    });
    expect(
      reloaded
        .listServiceTokens(owner.token)
        .find((token) => token.id === readOnly.id)?.allowClarifications,
    ).toBe(false);
    expect(accounts.revokeServiceToken(owner.token, issued.id)).toBe(true);
    expect(
      accounts.setServiceTokenClarifications(owner.token, issued.id, false),
    ).toBe(false);
  });

  it("migrates a v3 database without changing existing token rights or its secret", () => {
    const accounts = store();
    const owner = accounts.register("owner@example.com", "demo-password-1");
    const issued = accounts.mintServiceToken(owner.token, {
      scopes: ["ask", "sessions:read"],
    });
    const db = new DatabaseSync(accounts.filePath);
    db.exec(
      "BEGIN; ALTER TABLE qa_service_tokens DROP COLUMN allow_clarifications; DROP TABLE qa_integration_request_policies; UPDATE qa_meta SET value='3' WHERE key='schema_version'; COMMIT;",
    );
    db.close();
    const migrated = new QaAccounts(accounts.filePath, {
      allowRegistration: true,
      sessionTtlDays: 30,
    });
    expect(migrated.verifyServiceToken(issued.token)).toMatchObject({
      scopes: ["ask", "sessions:read"],
      allowClarifications: true,
    });
    expect(migrated.verifyToken(owner.token)).not.toBeNull();
    migrated.recordIntegrationRequestPolicy("demo-chat", "demo-request", false);
    migrated.recordIntegrationRequestPolicy("demo-chat", "demo-request", true);
    const again = new QaAccounts(accounts.filePath, {
      allowRegistration: true,
      sessionTtlDays: 30,
    });
    expect(
      again.integrationClarificationsAllowed("demo-chat", "demo-request"),
    ).toBe(false);
    expect(
      again.integrationClarificationsAllowed("other-chat", "demo-request"),
    ).toBe(true);
  });
});
