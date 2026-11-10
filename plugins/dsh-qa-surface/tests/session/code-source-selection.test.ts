import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCodeSources } from "@yadsh/dsh-plugin-kit/code-sources";
import {
  QaCodeSourceSelection,
  type CodeSourceSession,
} from "../../src/code-source-selection.js";
import { QaSurface } from "../../src/index.js";

const roots: string[] = [];
const stores: QaCodeSourceSelection[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function harness() {
  const root = mkdtempSync(join(tmpdir(), "qa-source-selection-"));
  roots.push(root);
  let catalog = resolveCodeSources({
    defaultSource: "stable",
    entries: [
      { id: "stable", label: "Release", path: "/srv/code/one" },
      { id: "preview", label: "Development", path: "/srv/code/two" },
    ],
  });
  const sessions = new Map<string, CodeSourceSession>([
    ["root", { header: {} }],
    ["child", { header: { parentSession: "root", origin: "subagent" } }],
    ["grandchild", { header: { parentSession: "child", origin: "subagent" } }],
    ["fork", { header: { parentSession: "root", isSeeded: true } }],
  ]);
  let busy = false;
  const open = () => {
    const store = new QaCodeSourceSelection(
      join(root, "selection.db"),
      () => catalog,
      (id) => sessions.get(id),
      () => busy,
    );
    stores.push(store);
    return store;
  };
  return {
    open,
    setBusy: (value: boolean) => {
      busy = value;
    },
    setCatalog: (value: typeof catalog) => {
      catalog = value;
    },
    sessions,
  };
}

describe("durable chat source selection", () => {
  it("snapshots the default for QA children without imposing it on unrelated native agents", () => {
    const h = harness();
    const store = h.open();
    store.inherit("native-child", "root");
    store.inherit("child", "root", true);
    store.select("root", "preview");
    expect(store.catalog("child").defaultSource).toBe("stable");
    expect(
      store.storage.db
        .prepare("SELECT source_id FROM selections WHERE session_id=?")
        .get("native-child"),
    ).toBeUndefined();
  });
  it("refuses a missing parent instead of substituting the deployment default", () => {
    const h = harness();
    const store = h.open();
    h.sessions.delete("root");
    expect(() => store.catalog("child")).toThrow(/no default/u);
  });
  it("persists a choice across reopening and isolates chats", () => {
    const h = harness();
    const store = h.open();
    store.select("root", "preview");
    store.close();
    const reopened = h.open();
    expect(reopened.catalog("root").defaultSource).toBe("preview");
    expect(reopened.catalog("another-chat").defaultSource).toBe("stable");
    expect(reopened.select("root", null)).toMatchObject({
      selectedSource: null,
      effectiveSource: "stable",
    });
  });
  it("snapshots nested children and forks without changing them after a parent selection changes", () => {
    const h = harness();
    const store = h.open();
    store.select("root", "preview");
    store.inherit("child", "root");
    store.inherit("grandchild", "child");
    store.inherit("fork", "root");
    store.select("root", "stable");
    store.inherit("child", "root");
    for (const id of ["child", "grandchild", "fork"])
      expect(store.catalog(id).defaultSource).toBe("preview");
    expect(() => store.select("child", "stable")).toThrow(/подагента/u);
    expect(store.select("fork", "stable").effectiveSource).toBe("stable");
    h.sessions.clear();
    expect(store.catalog("grandchild").defaultSource).toBe("preview");
  });
  it("preserves a removed selection and refuses to switch silently", () => {
    const h = harness();
    const store = h.open();
    store.select("root", "preview");
    h.setCatalog(
      resolveCodeSources({
        entries: [{ id: "stable", label: "Release", path: "/srv/code/one" }],
      }),
    );
    expect(store.view("root", true)).toMatchObject({
      selectedSource: "preview",
      unavailable: true,
    });
    expect(store.catalog("root").defaultSource).toBe("preview");
    expect(() => store.select("root", "missing")).toThrow(/недоступен/u);
  });
  it("rejects writes during work and reports read-only collaborators", () => {
    const h = harness();
    const store = h.open();
    h.setBusy(true);
    expect(() => store.select("root", "preview")).toThrow(/завершения/u);
    expect(store.view("root", true).writable).toBe(false);
    h.setBusy(false);
    expect(store.view("root", false).writable).toBe(false);
    expect(store.catalog("root").defaultSource).toBe("stable");
  });
  it("checks ownership after asynchronous read admission and before writing", async () => {
    const h = harness();
    const store = h.open();
    let revalidated = false;
    const receiver = {
      admitChatRead: async () => () => {
        revalidated = true;
      },
      requireChatOwner: () => {
        throw new Error("owner only");
      },
      codeSourceStore: () => store,
    };
    await expect(
      QaSurface.prototype.chatSelectCodeSource.call(
        receiver as unknown as QaSurface,
        "token",
        "root",
        "preview",
      ),
    ).rejects.toThrow(/owner/u);
    expect(store.catalog("root").defaultSource).toBe("stable");
    expect(revalidated).toBe(false);
    expect(
      await QaSurface.prototype.chatCodeSources.call(
        receiver as unknown as QaSurface,
        "token",
        "root",
      ),
    ).toMatchObject({ writable: false });
    expect(revalidated).toBe(true);
  });
});
