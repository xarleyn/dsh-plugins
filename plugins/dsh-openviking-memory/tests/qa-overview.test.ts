/**
 * The overview reader on its own: the shapes the memory store answers with, and
 * what the page must make of them. The store is faked at the transport level —
 * a path, a query, a JSON body — so every assertion is about what the reader
 * asked for and what it built, not about a mock of the reader.
 */

import { describe, expect, it } from "vitest";

import type { OpenVikingResult } from "../src/api-client.js";
import {
  readUserMemoryOverview,
  type MemoryOverviewSource,
} from "../src/qa/overview.js";

interface FixtureOptions {
  /** The identity the store reports for this caller. */
  readonly user?: string;
  /** The identity the client speaks as; `""` means the deployment's own. */
  readonly headerUser?: string;
  readonly statusOk?: boolean;
  readonly statusError?: string;
  readonly memories?: readonly Record<string, unknown>[];
  readonly sessions?: readonly Record<string, unknown>[];
  readonly files?: Readonly<Record<string, string>>;
}

interface Fixture {
  readonly source: MemoryOverviewSource;
  readonly paths: string[];
}

function entry(
  path: string,
  options: {
    readonly folder?: boolean;
    readonly summary?: string;
    readonly at?: string;
  } = {},
): Record<string, unknown> {
  return {
    uri: `viking://user/space/memories/${path}`,
    rel_path: path,
    isDir: options.folder === true,
    modTime: options.at ?? "2026-09-22T06:00:00.000Z",
    abstract: options.summary ?? "",
  };
}

function session(
  name: string,
  at: string,
  summary = "",
): Record<string, unknown> {
  return {
    uri: `viking://user/space/sessions/${name}`,
    rel_path: name,
    isDir: false,
    modTime: at,
    abstract: summary,
  };
}

/**
 * A conversation as the store really answers it: a directory, with no
 * `rel_path`, and an absolute `uri` that does not spell the listed directory
 * the way the caller asked for it (`viking://~/sessions`).
 */
function storedSession(
  name: string,
  at: string,
  summary = "",
): Record<string, unknown> {
  return {
    uri: `viking://user/space/sessions/${name}`,
    isDir: true,
    modTime: at,
    abstract: summary,
  };
}

/** A store that answers the three endpoints the reader uses. */
function fixture(options: FixtureOptions = {}): Fixture {
  const paths: string[] = [];
  const ok = (result: unknown): OpenVikingResult => ({
    ok: true,
    result,
    status: 200,
  });
  const source: MemoryOverviewSource = {
    config: {
      user: options.headerUser ?? options.user ?? "account-a",
    },
    fetchJSON: async (path) => {
      paths.push(path);
      if (path.startsWith("/api/v1/system/status")) {
        if (options.statusOk === false) {
          return {
            ok: false,
            result: null,
            status: 503,
            error: { message: options.statusError ?? "unreachable" },
          };
        }
        return ok({
          initialized: true,
          user: options.user ?? options.headerUser ?? "account-a",
        });
      }
      if (path.startsWith("/api/v1/fs/ls")) {
        const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
        const uri = query.get("uri") ?? "";
        if (uri.endsWith("/sessions")) return ok(options.sessions ?? []);
        return ok(options.memories ?? []);
      }
      if (path.startsWith("/api/v1/content/read")) {
        const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
        const uri = query.get("uri") ?? "";
        const name = uri.split("/").at(-1) ?? "";
        const text = options.files?.[name];
        return text === undefined
          ? { ok: false, result: null, status: 404 }
          : ok(text);
      }
      return { ok: false, result: null, status: 404 };
    },
  };
  return { source, paths };
}

describe("memory overview reader", () => {
  it("groups an account's notes by section and keeps the store's counts", async () => {
    const memories = [
      entry("cases", { folder: true, summary: "Разобранные случаи." }),
      ...Array.from({ length: 8 }, (_unused, index) =>
        entry(`cases/note-${index}.md`),
      ),
      entry("preferences", { folder: true }),
      entry("preferences/tone.md"),
      // Three segments deep: a folder's own contents are reached through it.
      entry("cases/group/leaf.md"),
      entry(".abstract.md"),
      entry("cases/.overview.md"),
    ];
    const { source } = fixture({ memories });

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.groups.map((group) => group.name)).toEqual([
      "cases",
      "preferences",
    ]);
    expect(view.groups[0]?.title).toBe("Разборы");
    expect(view.groups[0]?.summary).toBe("Разобранные случаи.");
    // Shown are six of the eight; the count is what the section holds.
    expect(view.groups[0]?.items).toHaveLength(6);
    expect(view.groups[0]?.total).toBe(8);
    expect(view.groups[1]?.items.map((item) => item.name)).toEqual(["tone"]);
    expect(view.totals.sections).toBe(2);
    expect(view.totals.memories).toBe(9);
  });

  it("counts every bounded section before truncating the browser rows", async () => {
    const memories = Array.from({ length: 14 }, (_unused, index) => [
      entry(`section-${index}`, { folder: true }),
      entry(`section-${index}/note.md`),
    ]).flat();
    const { source } = fixture({ memories });

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.groups).toHaveLength(12);
    expect(view.totals).toEqual({ sections: 14, memories: 14, sessions: 0 });
  });

  it("admits when a server listing reaches its bound", async () => {
    const memories = Array.from({ length: 400 }, (_unused, index) =>
      entry(`note-${index}.md`),
    );
    const sessions = Array.from({ length: 200 }, (_unused, index) =>
      storedSession(`dsh-${index}`, "2026-09-22T10:00:00.000Z"),
    );
    const { source } = fixture({ memories, sessions });

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.truncated).toEqual({ memories: true, sessions: true });
    expect(view.totals.memories).toBe(400);
    expect(view.totals.sessions).toBe(200);
  });

  it("keeps loose notes, but not the files that are not about the account", async () => {
    const memories = [
      entry("notes.md"),
      entry("soul.md"),
      entry("identity.md"),
      entry("cases", { folder: true }),
    ];
    const { source } = fixture({
      memories,
      files: { "identity.md": "Кто вы." },
    });

    const view = await readUserMemoryOverview(source, { scoped: true });

    // `notes.md` is a note about the account; `soul.md` is the assistant's own
    // persona and `identity.md` is the profile shown as text above.
    expect(view.groups.map((group) => group.title)).toEqual(["Заметки"]);
    expect(view.groups[0]?.items.map((item) => item.name)).toEqual(["notes"]);
    expect(view.groups[0]?.total).toBe(1);
  });

  it("lists conversations newest first and only the ones this plugin owns", async () => {
    const sessions = [
      session("dsh-old", "2026-09-20T10:00:00.000Z", "Старый разговор."),
      session("cli__default__x", "2026-09-23T10:00:00.000Z", "Не разговор."),
      session("__openviking_resource_reason__", "2026-09-23T11:00:00.000Z"),
      session("dsh-new", "2026-09-22T10:00:00.000Z", "Новый разговор."),
      session("dsh-middle", "2026-09-21T10:00:00.000Z"),
    ];
    const { source } = fixture({ sessions });

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.sessions.map((item) => item.id)).toEqual([
      "new",
      "middle",
      "old",
    ]);
    expect(view.sessions[0]?.summary).toBe("Новый разговор.");
    expect(view.sessions[1]?.summary).toBe("");
    expect(view.totals.sessions).toBe(3);
  });

  it("reads conversations the store answers as directories without a rel_path", async () => {
    // The store's own shape: `viking://~/sessions` comes back as directories
    // under an absolute URI, with no relative path to lean on.
    const sessions = [
      storedSession("dsh-new", "2026-09-22T10:00:00.000Z", "Новый разговор."),
      storedSession("dsh-old", "2026-09-20T10:00:00.000Z"),
    ];
    const { source } = fixture({ sessions });

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.sessions.map((item) => item.id)).toEqual(["new", "old"]);
    expect(view.sessions[0]?.summary).toBe("Новый разговор.");
    expect(view.totals.sessions).toBe(2);
  });

  it("shows the profile the plugin injects, and falls back to the identity file", async () => {
    const memories = [entry("profile.md"), entry("identity.md")];
    const withProfile = fixture({
      memories,
      files: {
        "profile.md": "Профиль из profile.md",
        "identity.md": "Из identity.md",
      },
    });

    const preferred = await readUserMemoryOverview(withProfile.source, {
      scoped: true,
    });
    expect(preferred.profile).toEqual({
      name: "profile.md",
      text: "Профиль из profile.md",
      truncated: false,
    });

    const identityOnly = fixture({
      memories: [entry("identity.md")],
      files: { "identity.md": "Из identity.md" },
    });
    const fallback = await readUserMemoryOverview(identityOnly.source, {
      scoped: true,
    });
    expect(fallback.profile?.name).toBe("identity.md");
    expect(fallback.profile?.text).toBe("Из identity.md");
  });

  it("bounds the profile it hands to the browser", async () => {
    const long = "x".repeat(2000);
    const { source } = fixture({
      memories: [entry("identity.md")],
      files: { "identity.md": long },
    });

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.profile?.truncated).toBe(true);
    expect(view.profile?.text).toHaveLength(1200);
  });

  it("reads no content when a scoped store answers as somebody else", async () => {
    const { source, paths } = fixture({
      headerUser: "account-a",
      user: "shared",
      memories: [entry("identity.md"), entry("private.md")],
      sessions: [storedSession("dsh-private", "2026-09-22T10:00:00.000Z")],
      files: { "identity.md": "must not be returned" },
    });

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.connected).toBe(true);
    expect(view.accountApplies).toBe(false);
    expect(view.serverIdentity).toBe("shared");
    expect(view.profile).toBeNull();
    expect(view.groups).toEqual([]);
    expect(view.sessions).toEqual([]);
    expect(paths).toEqual(["/api/v1/system/status"]);
  });

  it("does not claim isolation nobody asked for", async () => {
    const { source } = fixture({ user: "shared" });

    const view = await readUserMemoryOverview(source, { scoped: false });

    expect(view.accountApplies).toBe(false);
    expect(view.scoped).toBe(false);
  });

  it("reads nothing further once the store is down", async () => {
    const { source, paths } = fixture({ statusOk: false, statusError: "boom" });

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.connected).toBe(false);
    expect(view.error).toBe("boom");
    expect(paths).toHaveLength(1);
  });

  it("treats an unreadable listing as a store that cannot answer", async () => {
    const source: MemoryOverviewSource = {
      config: { user: "account-a" },
      fetchJSON: async (path) => {
        if (path.startsWith("/api/v1/system/status")) {
          return { ok: true, result: { user: "account-a" }, status: 200 };
        }
        return {
          ok: false,
          result: null,
          status: 500,
          error: { message: "no" },
        };
      },
    };

    const view = await readUserMemoryOverview(source, { scoped: true });

    expect(view.connected).toBe(false);
    expect(view.error).toBe("the memory listing failed");
  });
});
