import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { IntegrationRepository } from "../src/repository.js";
import type {
  EncryptedSecretRecord,
  IntegrationPrincipal,
} from "../src/types.js";

const alice: IntegrationPrincipal = { userId: "user-alice" };

function secret(id = "secret-1"): EncryptedSecretRecord {
  return {
    id,
    ciphertext: "cipher",
    nonce: "nonce",
    authTag: "tag",
    wrappedDek: "dek",
    wrapNonce: "wrap-nonce",
    wrapAuthTag: "wrap-tag",
    keyVersion: 1,
    secretType: "token",
    expiresAt: null,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}

function rig(): {
  dir: string;
  file: string;
  repository: IntegrationRepository;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-integrations-store-"));
  const file = path.join(dir, "qa-integrations.db");
  return { dir, file, repository: new IntegrationRepository(file) };
}

/** Read the first column of a query out of the store's own database. */
function column<T>(file: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(file);
  try {
    return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(
      (row) => Object.values(row)[0] as T,
    );
  } finally {
    db.close();
  }
}

const open: IntegrationRepository[] = [];
afterEach(() => {
  for (const repository of open.splice(0)) repository.close();
});

function openRepository(file: string, days?: number): IntegrationRepository {
  const repository = new IntegrationRepository(
    file,
    days === undefined ? {} : { auditRetentionDays: days },
  );
  open.push(repository);
  return repository;
}

describe("IntegrationRepository connections", () => {
  it("keeps one connection per account and provider, and drops the old secret", () => {
    const { file, repository } = rig();
    open.push(repository);
    repository.connect({
      principal: alice,
      provider: "bitrix24",
      secret: secret("secret-1"),
      tenantId: "acme.bitrix24.ru",
      externalUserId: "11",
      displayName: "Alice",
      capabilities: ["crm.read"],
    });
    const reconnected = repository.connect({
      principal: alice,
      provider: "bitrix24",
      secret: secret("secret-2"),
      tenantId: "acme.bitrix24.ru",
      externalUserId: "12",
      displayName: "Alice",
      capabilities: ["crm.read", "chat.read"],
    });

    // One row, the credential replaced, the previous secret gone.
    expect(column<string>(file, "SELECT id FROM integrations")).toEqual([
      reconnected.id,
    ]);
    expect(column<string>(file, "SELECT id FROM integration_secrets")).toEqual([
      "secret-2",
    ]);
    expect(repository.find(alice, "bitrix24")?.externalUserId).toBe("12");
    expect(repository.secretFor(alice, "bitrix24")?.id).toBe("secret-2");
  });

  it("reads only the rows a lookup asks for", () => {
    const { repository } = rig();
    open.push(repository);
    repository.connect({
      principal: alice,
      provider: "bitrix24",
      secret: secret(),
      tenantId: "acme.bitrix24.ru",
      externalUserId: "11",
      displayName: "Alice",
      capabilities: ["crm.read"],
    });

    // Another account's connection is invisible, and a provider nobody
    // connected resolves to nothing rather than to the first row.
    expect(repository.find({ userId: "user-bob" }, "bitrix24")).toBeUndefined();
    expect(repository.find(alice, "gitlab")).toBeUndefined();
    expect(repository.secretFor(alice, "gitlab")).toBeUndefined();
  });

  it("denies an operation the connection never granted", () => {
    const { repository } = rig();
    open.push(repository);
    const integration = repository.connect({
      principal: alice,
      provider: "bitrix24",
      secret: secret(),
      tenantId: "acme.bitrix24.ru",
      externalUserId: "11",
      displayName: "Alice",
      capabilities: ["crm.read"],
    });

    expect(repository.policy(integration, "crm.read")).toBe("allow");
    expect(repository.policy(integration, "chat.read")).toBe("deny");
    repository.setPolicy(alice, "bitrix24", "chat.read", "allow");
    expect(repository.policy(integration, "chat.read")).toBe("allow");
  });

  it("forgets the credential and the policies when a connection is dropped", () => {
    const { file, repository } = rig();
    open.push(repository);
    repository.connect({
      principal: alice,
      provider: "bitrix24",
      secret: secret(),
      tenantId: "acme.bitrix24.ru",
      externalUserId: "11",
      displayName: "Alice",
      capabilities: ["crm.read"],
    });

    expect(repository.disconnect(alice, "bitrix24")).toBe(true);

    expect(repository.find(alice, "bitrix24")).toBeUndefined();
    expect(column<string>(file, "SELECT id FROM integration_secrets")).toEqual(
      [],
    );
    expect(
      column<string>(file, "SELECT operation FROM integration_policies"),
    ).toEqual([]);
    expect(repository.disconnect(alice, "bitrix24")).toBe(false);
  });
});

describe("IntegrationRepository audit retention", () => {
  it("appends one row per call and keeps them in order", () => {
    const { file, repository } = rig();
    open.push(repository);
    for (const operation of ["crm.search", "crm.get", "chat.search"]) {
      repository.audit({
        ownerUserId: alice.userId,
        provider: "bitrix24",
        operation,
        result: "success",
        sourceSessionId: "session-1",
      });
    }

    expect(
      column<string>(
        file,
        "SELECT operation FROM integration_audit ORDER BY seq",
      ),
    ).toEqual(["crm.search", "crm.get", "chat.search"]);
  });

  it("drops rows older than the configured number of days", () => {
    const { file, repository } = rig();
    repository.close();
    const aged = openRepository(file, 30);
    // One row from long ago, one from today.
    const db = new DatabaseSync(file);
    db.prepare(
      `INSERT INTO integration_audit
         (id, owner_user_id, provider, operation, result, source_session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "old",
      alice.userId,
      "bitrix24",
      "crm.get",
      "success",
      null,
      "2020-01-01T00:00:00.000Z",
    );
    db.close();

    aged.audit({
      ownerUserId: alice.userId,
      provider: "bitrix24",
      operation: "crm.search",
      result: "success",
      sourceSessionId: null,
    });

    expect(column<string>(file, "SELECT id FROM integration_audit")).toEqual([
      expect.any(String),
    ]);
    expect(
      column<string>(file, "SELECT operation FROM integration_audit"),
    ).toEqual(["crm.search"]);
  });

  it("keeps the newest rows when the log outgrows its row cap", () => {
    const { file, repository } = rig();
    repository.close();
    // The age bound is off, so only the row cap can trim this.
    const capped = openRepository(file, 0);
    const db = new DatabaseSync(file);
    db.exec("BEGIN");
    const insert = db.prepare(
      `INSERT INTO integration_audit
         (id, owner_user_id, provider, operation, result, source_session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let index = 0; index < 5_100; index += 1) {
      insert.run(
        `row-${index}`,
        alice.userId,
        "bitrix24",
        "crm.get",
        "success",
        null,
        new Date().toISOString(),
      );
    }
    db.exec("COMMIT");
    db.close();

    capped.audit({
      ownerUserId: alice.userId,
      provider: "bitrix24",
      operation: "crm.search",
      result: "success",
      sourceSessionId: null,
    });

    expect(
      column<number>(file, "SELECT COUNT(*) FROM integration_audit"),
    ).toEqual([5_000]);
    // The newest row survives; the oldest are the ones that went.
    expect(
      column<string>(file, "SELECT id FROM integration_audit"),
    ).not.toContain("row-0");
  });
});

describe("IntegrationRepository import of the pre-SQLite file", () => {
  function writeLegacy(dir: string): string {
    const file = path.join(dir, "qa-integrations.json");
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          version: 1,
          integrations: [
            {
              id: "integration-1",
              ownerUserId: alice.userId,
              provider: "bitrix24",
              authKind: "token",
              status: "connected",
              externalTenantId: "acme.bitrix24.ru",
              externalUserId: "11",
              displayName: "Alice",
              capabilities: ["crm.read"],
              secretRef: "secret-1",
              createdAt: "2026-09-15T00:00:00.000Z",
              updatedAt: "2026-09-15T00:00:00.000Z",
              lastValidatedAt: "2026-09-15T00:00:00.000Z",
              lastErrorCode: null,
            },
          ],
          secrets: { "secret-1": secret() },
          policies: { "integration-1:crm.read": "allow" },
          audit: [
            {
              id: "audit-1",
              ownerUserId: alice.userId,
              provider: "bitrix24",
              operation: "credential.connect",
              result: "success",
              sourceSessionId: null,
              createdAt: "2026-09-15T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return file;
  }

  it("imports connections, credentials, policies and audit, then retires the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-integrations-legacy-"));
    const legacy = writeLegacy(dir);
    const file = path.join(dir, "qa-integrations.db");

    const repository = openRepository(file);
    repository.importLegacyFile(legacy);

    expect(repository.find(alice, "bitrix24")?.id).toBe("integration-1");
    expect(repository.secretFor(alice, "bitrix24")?.id).toBe("secret-1");
    expect(
      repository.policy(repository.find(alice, "bitrix24")!, "crm.read"),
    ).toBe("allow");
    expect(
      column<string>(file, "SELECT operation FROM integration_audit"),
    ).toEqual(["credential.connect"]);
    expect(readdirSync(dir).some((name) => name.includes(".migrated-"))).toBe(
      true,
    );
    expect(() => readFileSync(legacy, "utf8")).toThrow();
  });

  it("never overwrites a live connection from a leftover file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-integrations-legacy-"));
    const file = path.join(dir, "qa-integrations.db");
    const repository = openRepository(file);
    repository.connect({
      principal: alice,
      provider: "bitrix24",
      secret: secret("secret-live"),
      tenantId: "live.bitrix24.ru",
      externalUserId: "99",
      displayName: "Live",
      capabilities: ["crm.read"],
    });
    const legacy = writeLegacy(dir);

    repository.importLegacyFile(legacy);

    expect(repository.secretFor(alice, "bitrix24")?.id).toBe("secret-live");
    expect(repository.find(alice, "bitrix24")?.externalUserId).toBe("99");
    // The leftover file stays where it is: dropping it is the operator's call.
    expect(readFileSync(legacy, "utf8")).toContain("integration-1");
  });

  it("refuses a file it cannot recognize and leaves it in place", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-integrations-legacy-"));
    const legacy = path.join(dir, "qa-integrations.json");
    writeFileSync(legacy, '{"version":2}\n', "utf8");
    const repository = openRepository(path.join(dir, "qa-integrations.db"));

    expect(() => repository.importLegacyFile(legacy)).toThrow(
      /refusing to import/u,
    );
    expect(readFileSync(legacy, "utf8")).toBe('{"version":2}\n');
  });
});
