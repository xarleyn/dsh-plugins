import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPlan,
  collectSessions,
  main,
  planAttachments,
  readRegistry,
  readSessionHeader,
  REGISTRY_FILE,
} from "../scripts/attach-workspace-sessions.mjs";

const homes = [];

function tempHome() {
  const home = mkdtempSync(path.join(tmpdir(), "qa-attach-"));
  homes.push(home);
  mkdirSync(path.join(home, "storages"));
  return home;
}

afterEach(() => {
  while (homes.length > 0)
    rmSync(homes.pop(), { recursive: true, force: true });
});

/** One session directory with one log, as the host stores it. */
function writeSession(home, cwd, { id, createdAt = 1, subagent, plain } = {}) {
  const directory = path.join(home, "sessions", "-project-", id);
  mkdirSync(directory, { recursive: true });
  const header = {
    type: "session",
    version: 3,
    id,
    cwd,
    createdAt,
    ...(subagent === undefined ? {} : { parentSession: subagent }),
  };
  const line = `${JSON.stringify(header)}\n`;
  if (plain === true) {
    writeFileSync(path.join(directory, "session.jsonl"), line, "utf8");
    return;
  }
  writeFileSync(
    path.join(directory, "session.v3.jsonl.zstd"),
    zstdCompressSync(
      Buffer.from(`${line}${JSON.stringify({ type: "turn/start" })}\n`),
    ),
  );
}

function writeRegistry(home, id, record, global = {}) {
  const registry = {
    unit: { name: "workspace", version: 2 },
    global: { initialized: true, workspaceIds: [id], ...global },
    tables: { workspaces: { [id]: record } },
  };
  writeFileSync(
    path.join(home, REGISTRY_FILE),
    `${JSON.stringify(registry, null, 2)}\n`,
    "utf8",
  );
  return registry;
}

/** A synthetic workspace id; the host generates one per registered workspace. */
const WORKSPACE_ID = "1f0a5c3b-6d2e-4a71-9c48-5b6e7f8a9b0c";

/** The QA `accounts.perUserWorkspace` shape: a workspace with a child root. */
function fixture(home) {
  const root = path.join(home, "work");
  const userRoot = path.join(
    root,
    ".qa-users",
    "9f1c2d3e-4a5b-4c6d-8e7f-0123456789ab",
  );
  mkdirSync(userRoot, { recursive: true });
  const record = {
    path: root,
    title: "work",
    sessionIds: [],
    createdAt: "2026-09-10T13:01:47.757Z",
    updatedAt: "2026-09-10T13:01:47.757Z",
  };
  writeRegistry(home, WORKSPACE_ID, record);
  return { root, userRoot, record, id: WORKSPACE_ID };
}

function registryText(home) {
  return readFileSync(path.join(home, REGISTRY_FILE), "utf8");
}

function recordOf(registry) {
  return Object.values(registry.tables.workspaces)[0];
}

describe("qa-attach-sessions", () => {
  it("reads the cwd from the first frame of a Zstandard log", () => {
    const home = tempHome();
    const { root } = fixture(home);
    writeSession(home, root, { id: "session-packed" });
    writeSession(home, root, { id: "session-text", plain: true });
    const sessions = collectSessions(home);
    expect(sessions.map((session) => session.id).sort()).toEqual([
      "session-packed",
      "session-text",
    ]);
    expect(sessions.every((session) => session.cwd === root)).toBe(true);
  });

  it("reports a plan without touching the registry", () => {
    const home = tempHome();
    const { root, userRoot } = fixture(home);
    const elsewhere = path.join(home, "elsewhere");
    mkdirSync(elsewhere);
    writeSession(home, root.replaceAll("\\", "/"), {
      id: "session-slashes",
      createdAt: 2,
    });
    writeSession(home, userRoot, { id: "session-user" });
    writeSession(home, elsewhere, { id: "session-other" });
    const before = registryText(home);

    const [entry] = planAttachments({ home }).workspaces;
    expect(entry.attachable.map((session) => session.id)).toEqual([
      "session-slashes",
    ]);
    expect(entry.below.map((session) => session.id)).toEqual(["session-user"]);
    expect(entry.elsewhere).toBe(1);
    expect(entry.members).toBe(0);
    expect(registryText(home)).toBe(before);

    const applied = applyPlan(planAttachments({ home }), { write: false });
    expect(applied.written).toBe(false);
    expect(applied.adopted[0].ids).toEqual(["session-slashes"]);
    expect(registryText(home)).toBe(before);
  });

  it("adopts the session with a backup and preserves the rest of the registry", () => {
    const home = tempHome();
    const { root, record, id } = fixture(home);
    writeSession(home, root, { id: "session-first" });
    const applied = applyPlan(planAttachments({ home }), { write: true });

    expect(applied.written).toBe(true);
    const backup = readRegistry(applied.backup);
    expect(recordOf(backup).sessionIds).toEqual([]);
    expect(recordOf(backup).title).toBe("work");

    const written = readRegistry(path.join(home, REGISTRY_FILE));
    expect(written.global.workspaceIds).toEqual([id]);
    expect(recordOf(written).sessionIds).toEqual(["session-first"]);
    expect(recordOf(written).path).toBe(record.path);
    expect(recordOf(written).createdAt).toBe(record.createdAt);
    expect(recordOf(written).updatedAt).not.toBe(record.updatedAt);
    expect(registryText(home)).toMatch(/^\{\n {2}"unit"/u);

    // Second run: nothing left to do, and no second backup.
    const again = planAttachments({ home });
    expect(again.workspaces[0].attachable).toEqual([]);
    expect(applyPlan(again, { write: true }).written).toBe(false);
  });

  it("prepends newest first and keeps the existing order", () => {
    const home = tempHome();
    const { root, record, id } = fixture(home);
    writeRegistry(home, id, { ...record, sessionIds: ["session-member"] });
    writeSession(home, root, { id: "session-old", createdAt: 1 });
    writeSession(home, root, { id: "session-new", createdAt: 2 });
    applyPlan(planAttachments({ home }), { write: true });
    expect(
      recordOf(readRegistry(path.join(home, REGISTRY_FILE))).sessionIds,
    ).toEqual(["session-new", "session-old", "session-member"]);
  });

  it("leaves subagents, archived sessions and dangling cwds alone", () => {
    const home = tempHome();
    const { root, record, id } = fixture(home);
    writeRegistry(home, id, record, {
      archivedSessionIds: ["session-archived"],
    });
    writeSession(home, root, { id: "session-archived" });
    writeSession(home, root, {
      id: "session-child",
      subagent: "session-parent",
    });
    writeSession(home, path.join(home, "vanished"), { id: "session-dangling" });

    const [entry] = planAttachments({ home }).workspaces;
    expect(entry.attachable).toEqual([]);
    expect(entry.archived).toBe(1);
    expect(entry.refused).toBe(1);
    expect(entry.unresolved.map((session) => session.id)).toEqual([
      "session-dangling",
    ]);
  });

  it("adopts subagents on request and refuses unknown options", () => {
    const home = tempHome();
    const { root } = fixture(home);
    writeSession(home, root, {
      id: "session-child",
      subagent: "session-parent",
    });
    const plan = planAttachments({ home, includeSubagents: true });
    expect(plan.workspaces[0].attachable.map((s) => s.id)).toEqual([
      "session-child",
    ]);
    expect(() => main(["--home", home, "--nope"])).toThrow(/unknown option/u);
    expect(main(["--help"])).toBe(0);
  });

  it("skips a workspace whose path does not resolve", () => {
    const home = tempHome();
    writeRegistry(home, WORKSPACE_ID, {
      path: path.join(home, "gone"),
      title: "gone",
      sessionIds: [],
      createdAt: "2026-09-10T13:01:47.757Z",
      updatedAt: "2026-09-10T13:01:47.757Z",
    });
    const plan = planAttachments({ home });
    expect(plan.workspaces[0].root).toBeUndefined();
    expect(plan.workspaces[0].attachable).toEqual([]);
  });

  it("selects one workspace by id or path and rejects a bad registry", () => {
    const home = tempHome();
    const { root } = fixture(home);
    writeSession(home, root, { id: "session-1" });
    const id = Object.keys(
      readRegistry(path.join(home, REGISTRY_FILE)).tables.workspaces,
    )[0];
    expect(planAttachments({ home, workspace: id }).workspaces).toHaveLength(1);
    expect(planAttachments({ home, workspace: root }).workspaces).toHaveLength(
      1,
    );
    expect(
      planAttachments({ home, workspace: "other" }).workspaces,
    ).toHaveLength(0);

    writeFileSync(path.join(home, REGISTRY_FILE), "{}\n", "utf8");
    expect(() => planAttachments({ home })).toThrow(/no workspace table/u);
    expect(statSync(path.join(home, REGISTRY_FILE)).isFile()).toBe(true);
  });

  it("returns no header for a log that carries none", () => {
    const home = tempHome();
    const file = path.join(home, "sessions", "torn.jsonl.zstd");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from("not zstd"));
    expect(readSessionHeader(file)).toBeUndefined();
    expect(collectSessions(home)).toEqual([]);
  });
});
