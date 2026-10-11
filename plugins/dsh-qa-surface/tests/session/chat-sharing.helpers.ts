import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { QaAccounts } from "../../src/accounts/store.js";
import { QaChatSharingStore } from "../../src/chat-sharing/store.js";

export function sharingFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-sharing-test-"));
  const accounts = new QaAccounts(path.join(dir, "accounts.db"), {
    allowRegistration: true,
    sessionTtlDays: 30,
    maxAuthAttemptsPerMinute: 100,
  });
  const outsider = accounts.register(
    "operator@example.com",
    "demo-password-123",
  );
  const owner = accounts.register("owner@example.com", "demo-password-123");
  const reader = accounts.register("reader@example.com", "demo-password-123");
  const collaborator = accounts.register(
    "collaborator@example.com",
    "demo-password-123",
  );
  accounts.reserveSession(owner.token, "chat-a");
  const dbPath = path.join(dir, "sharing.db");
  const store = new QaChatSharingStore(dbPath, () => accounts);
  store.set(owner.token, "chat-a", reader.user.email, "read");
  store.set(owner.token, "chat-a", collaborator.user.email, "collaborate");
  return { store, accounts, owner, reader, collaborator, outsider, dbPath };
}
