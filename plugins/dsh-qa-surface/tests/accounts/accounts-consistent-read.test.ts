import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaAccounts } from "../../src/accounts/store.js";
import { reasonOf } from "./accounts.helpers.js";

/**
 * The accounts model is read statement by statement, so the version that marks
 * it current has to be taken around the read, not after it. These tests commit
 * from a second connection *while* a store is reading.
 */
describe("QA accounts consistent snapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a token revoked between two reads of one reload", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-"));
    const filePath = path.join(dir, "qa-accounts.db");
    const host = new QaAccounts(filePath, {
      sessionTtlDays: 30,
      allowRegistration: true,
    });
    const session = host.register("op@example.com", "password-1");

    // The second connection is what the `qa-accounts` CLI is. Its first write
    // is what makes the Host reload; its second lands inside that reload, after
    // the accounts SELECT and before the read has finished — exactly the window
    // a baseline taken at the end of the read would paper over.
    const cli = new DatabaseSync(filePath);
    cli.exec("PRAGMA journal_mode = WAL");
    cli.exec("PRAGMA busy_timeout = 5000");
    cli.exec(
      "UPDATE qa_accounts SET last_login_at = '2026-09-11T11:00:00Z' WHERE email = 'op@example.com'",
    );

    let revoked = false;
    const prepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      ...query: Parameters<DatabaseSync["prepare"]>
    ) {
      const statement = prepare.apply(this, query);
      if (!revoked && query[0].includes("FROM qa_ownership")) {
        revoked = true;
        cli.exec(
          "UPDATE qa_accounts SET token_version = token_version + 1 WHERE email = 'op@example.com'",
        );
      }
      return statement;
    });

    expect(reasonOf(() => host.currentUser(session.token))).toBe(
      "auth-required",
    );
    // The revocation really did interleave with the read, so the assertion
    // above tested the window rather than a plain reload.
    expect(revoked).toBe(true);
    cli.close();
    host.close();
  });
});
