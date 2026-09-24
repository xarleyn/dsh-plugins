import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QaAccounts, QaAccountsError } from "../../src/accounts/store.js";

/** Read the first column of a query out of the store's own database. */
export function rowsOf(filePath: string, sql: string): string[] {
  const db = new DatabaseSync(filePath);
  try {
    return (db.prepare(sql).all() as Record<string, unknown>[]).map(
      (row) => Object.values(row)[0] as string,
    );
  } finally {
    db.close();
  }
}

export function store(options?: {
  allowRegistration?: boolean;
  maxAuthAttemptsPerMinute?: number;
  sessionTtlDays?: number;
}): QaAccounts {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-"));
  return new QaAccounts(path.join(dir, "qa-accounts.db"), {
    sessionTtlDays: options?.sessionTtlDays ?? 30,
    allowRegistration: options?.allowRegistration ?? true,
    maxAuthAttemptsPerMinute: options?.maxAuthAttemptsPerMinute ?? 100,
  });
}

export function reasonOf(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    if (error instanceof QaAccountsError) return error.reason;
    throw error;
  }
  throw new Error("expected the operation to fail");
}
