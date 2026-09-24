import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { QaQualityStore } from "../../src/admin/quality-store.js";

const roots: string[] = [];
const stores: QaQualityStore[] = [];

function tempFile(name = "qa-quality.db"): string {
  const root = mkdtempSync(path.join(tmpdir(), "qa-quality-"));
  roots.push(root);
  return path.join(root, name);
}

/** Build a store the cleanup below closes and deletes. */
function openStore(file: string): QaQualityStore {
  const store = new QaQualityStore(file);
  stores.push(store);
  return store;
}

afterEach(() => {
  // The store is a database: its handle goes before the directory does, or
  // Windows refuses to remove a directory holding an open file.
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

export { openStore, tempFile };
