import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QaAccounts } from "../../src/accounts/store.js";
import type { QaEffectiveCapabilityPolicy } from "../../src/types.js";

/** A minimal frozen policy; only its content matters to the store. */
export function policy(
  revision: string,
  tools: readonly string[] = ["read"],
): QaEffectiveCapabilityPolicy {
  return {
    subroleId: "general",
    tools,
    grantableTools: [],
    skills: [],
    userSkills: [],
    sources: {
      systemTools: [...tools],
      commonTools: [],
      roleTools: [],
      commonGrantableTools: [],
      roleGrantableTools: [],
      systemSkills: [],
      commonSkills: [],
      roleSkills: [],
      declaredSkills: [],
    },
    missingTools: [],
    missingSkills: [],
    policyRevision: revision,
  };
}

export function rig(): { store: QaAccounts; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-retention-"));
  const file = path.join(dir, "qa-accounts.db");
  return { file, store: openStore(file) };
}

export function openStore(file: string): QaAccounts {
  return new QaAccounts(file, {
    sessionTtlDays: 30,
    allowRegistration: true,
    maxAuthAttemptsPerMinute: 100,
  });
}

/** Read the first column of a query out of the store's own database. */
export function column<T>(file: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(file);
  try {
    return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(
      (row) => Object.values(row)[0] as T,
    );
  } finally {
    db.close();
  }
}

export function run(file: string, sql: string, ...params: string[]): void {
  const db = new DatabaseSync(file);
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}
