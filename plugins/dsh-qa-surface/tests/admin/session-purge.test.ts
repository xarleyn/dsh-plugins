import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { QaAccounts } from "../../src/accounts/store.js";
import { createSessionPurge } from "../../src/admin/session-purge.js";

vi.mock("node:fs", async (load) => {
  const fs = await load<typeof import("node:fs")>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.mocked(renameSync).mockReset();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), "qa-purge-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const db = path.join(home, "accounts.db");
  const open = () => {
    const accounts = new QaAccounts(db, {
      allowRegistration: true,
      sessionTtlDays: 1,
    });
    cleanups.push(() => accounts.close());
    return accounts;
  };
  const accounts = open();
  accounts.addUser("admin@example.org", "demo-password", { role: "admin" });
  const user = accounts.addUser("reader@example.org", "demo-password");
  const targets = ["first", "second"];
  const file = (id: string) =>
    path.join(home, "sessions", "project", id, "journal");
  for (const id of targets) {
    mkdirSync(path.dirname(file(id)), { recursive: true });
    writeFileSync(file(id), id);
  }
  const drop = vi.fn((_id: string) => {});
  const deferred = vi.fn();
  const purge = () => createSessionPurge(drop, deferred, home);
  const stage = () =>
    purge().stage(accounts, user.id, targets, new Set(targets));
  return { open, accounts, user, targets, purge, stage, file, drop, deferred };
}

it("restores the first directory after a later move fails and the account rolls back", () => {
  const f = fixture();
  const original = vi.mocked(renameSync).getMockImplementation()!;
  vi.mocked(renameSync)
    .mockImplementationOnce(original)
    .mockImplementationOnce(() => {
      throw new Error("directory is busy");
    });
  expect(() =>
    f.accounts.deleteAccount(f.user.id, { beforeCommit: f.stage }),
  ).toThrow("directory is busy");
  expect(existsSync(f.file("first"))).toBe(false);
  f.purge().recover(f.open());
  for (const id of f.targets) expect(readFileSync(f.file(id), "utf8")).toBe(id);
  expect(f.drop).not.toHaveBeenCalled();
  expect(f.accounts.accountById(f.user.id)).toBeDefined();
});

it("reopens a committed purge and retries cleanup without restoring a removed account", () => {
  const f = fixture();
  f.accounts.deleteAccount(f.user.id, { beforeCommit: f.stage });
  const reopened = f.open();
  const purge = f.purge();
  f.drop.mockImplementationOnce(() => {
    throw new Error("storage is busy");
  });
  purge.recover(reopened);
  expect(f.deferred).toHaveBeenCalledOnce();
  expect(reopened.accountById(f.user.id)).toBeUndefined();
  for (const id of f.targets) expect(existsSync(f.file(id))).toBe(false);
  purge.recover(reopened);
  expect(f.drop.mock.calls.flat()).toEqual(["first", "first", "second"]);
  purge.recover(reopened);
  expect(f.drop).toHaveBeenCalledTimes(3);
});
