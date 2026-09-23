/**
 * What one account's memory holds, read for the page that shows it.
 *
 * The settings page of a deployment is not the place to configure the memory —
 * that is the operator's card — but it is exactly the place to *answer* what
 * the assistant remembers about the person reading it. This module is that
 * read: the profile the store keeps about the account, the sections it files
 * memories under, and the conversations it has seen, all through the client
 * that speaks as that account.
 *
 * Everything here is a read. Nothing is created, updated or committed by a
 * request of this module, so opening the page cannot change what the memory
 * holds, and a store that is slow or absent costs the page its content and
 * nothing else.
 */

import type { OpenVikingResult } from "../api-client.js";
import type {
  QaMemoryOverviewGroup,
  QaMemoryOverviewItem,
  QaMemoryOverviewProfile,
  QaMemoryOverviewSession,
  QaUserMemoryOverview,
} from "../types.js";

/**
 * The client this module reads through. Declared structurally rather than as
 * the concrete client so a unit test can answer without a transport, and so a
 * client built for one account's identity can be passed straight in.
 */
export interface MemoryOverviewSource {
  readonly config: { readonly user: string };
  fetchJSON(
    path: string,
    init?: {
      readonly method?: string;
      readonly body?: string;
      readonly headers?: Record<string, string>;
    },
    options?: { readonly timeoutMs?: number | undefined },
  ): Promise<OpenVikingResult>;
}

/** The account's own space, addressed by the server's home alias. */
const MEMORIES_URI = "viking://~/memories";
const SESSIONS_URI = "viking://~/sessions";

/**
 * Profile files the store may keep, best first. `profile.md` is what this
 * plugin injects; `identity.md` is what a space initialized outside the plugin
 * carries instead, and reading it beats showing an empty page.
 */
const PROFILE_FILES = ["profile.md", "identity.md"] as const;

/** How much of the profile fits a settings page, in characters. */
const PROFILE_MAX_CHARS = 1200;

/** Bounds on what one page open asks the store for. */
const MEMORY_NODE_LIMIT = 400;
const ABSTRACT_LIMIT = 400;
const SESSION_NODE_LIMIT = 200;
const MAX_GROUPS = 12;
const MAX_ITEMS_PER_GROUP = 6;
const MAX_SESSIONS = 8;

/** The OpenViking session prefix this plugin creates its chats under. */
const SESSION_PREFIX = "dsh-";

/** Section titles, for the sections the store actually uses. */
const GROUP_TITLES: Readonly<Record<string, string>> = {
  preferences: "Предпочтения",
  entities: "Сущности",
  events: "События",
  experiences: "Опыт",
  cases: "Разборы",
  trajectories: "Ход работы",
  skills: "Навыки",
  peers: "Собеседники",
  resources: "Ресурсы",
  privacy: "Приватность",
};

/**
 * Files in `memories/` that are about the assistant rather than about the
 * account, and therefore are not shown as notes the store kept about somebody:
 * `soul.md` describes the assistant's own character.
 */
const PERSONA_FILES: readonly string[] = ["soul.md"];

/** The section the loose notes at the top of `memories/` land in. */
const NOTES_GROUP_TITLE = "Заметки";

/** What the reader needs to know that only the plugin knows. */
export interface MemoryOverviewOptions {
  /** Whether the deployment is configured to keep one space per account. */
  readonly scoped: boolean;
}

/** One entry of an `ls` response, as far as this module reads it. */
interface ListingEntry {
  /** Path relative to the listed directory. */
  readonly path: string;
  readonly folder: boolean;
  readonly summary: string;
  readonly updatedAt: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The path of one entry relative to the listed directory.
 *
 * The store answers with an absolute `uri` and — for a recursive listing — a
 * `rel_path`; either can carry the path, and the `uri` never spells the listed
 * directory the way the caller asked for it (`viking://~/sessions` comes back
 * as `viking://user/<space>/sessions/<id>`). So the relative path is read from
 * the entry's own segments, after the last segment of the directory listed.
 */
function relativePath(uri: string, relPath: string, root: string): string {
  const fromRelPath = relPath.trim();
  if (fromRelPath !== "") return fromRelPath;
  const tail = root.split("/").filter(Boolean).at(-1) ?? "";
  const segments = uri.split("/").filter(Boolean);
  const index = tail === "" ? -1 : segments.indexOf(tail);
  return index === -1 ? "" : segments.slice(index + 1).join("/");
}

/** One listing entry, normalized. */
function readEntry(raw: unknown, root: string): ListingEntry | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  const path = relativePath(
    asString(record.uri),
    asString(record.rel_path),
    root,
  )
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");
  if (path === "") return undefined;
  const updatedAt = asString(record.modTime).trim();
  return {
    path,
    folder: record.isDir === true,
    summary: asString(record.abstract).trim(),
    updatedAt: updatedAt === "" ? null : updatedAt,
  };
}

/** Whether an entry is one of the store's own bookkeeping files. */
function isInternal(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

/** Whether a path sits directly inside the listed directory. */
function isTopLevel(path: string): boolean {
  return path.split("/").length === 1;
}

/** Whether a path sits one level below the listed directory. */
function isDirectChild(path: string): boolean {
  return path.split("/").length === 2;
}

/** The display name of an entry: its last segment, without a Markdown suffix. */
function displayName(path: string): string {
  const last = path.split("/").at(-1) ?? path;
  return last.replace(/\.md$/u, "");
}

function itemOf(entry: ListingEntry): QaMemoryOverviewItem {
  return {
    name: displayName(entry.path),
    summary: entry.summary,
    folder: entry.folder,
  };
}

/**
 * The sections of a memory listing.
 *
 * A section is a folder directly under `memories/` — the store's own filing —
 * and its entries are the notes filed into it. Loose notes at the top of
 * `memories/` are about the account itself rather than about a topic, so they
 * share one extra section; the profile file is left out, because the page
 * shows it as text above.
 */
export function memoryGroups(
  entries: readonly ListingEntry[],
  profileName: string | null = null,
): readonly QaMemoryOverviewGroup[] {
  const inside = entries.filter((entry) => !isInternal(entry.path));
  const groups: QaMemoryOverviewGroup[] = [];

  for (const section of inside) {
    if (!section.folder || !isTopLevel(section.path)) continue;
    const prefix = `${section.path}/`;
    const children = inside.filter(
      (entry) => isDirectChild(entry.path) && entry.path.startsWith(prefix),
    );
    // A section the store opened but filed nothing into is not something to
    // report: an empty heading reads as a promise the memory did not keep.
    if (children.length === 0) continue;
    groups.push({
      name: section.path,
      title: GROUP_TITLES[section.path] ?? section.path,
      summary: section.summary,
      items: children
        .slice(0, MAX_ITEMS_PER_GROUP)
        .map((entry) => itemOf(entry)),
      total: children.length,
    });
  }

  const notes = inside.filter(
    (entry) =>
      isTopLevel(entry.path) &&
      !entry.folder &&
      entry.path !== profileName &&
      !PERSONA_FILES.includes(entry.path),
  );
  if (notes.length > 0) {
    groups.push({
      name: "",
      title: NOTES_GROUP_TITLE,
      summary: "",
      items: notes.slice(0, MAX_ITEMS_PER_GROUP).map((entry) => itemOf(entry)),
      total: notes.length,
    });
  }

  return groups;
}

/**
 * The conversations of a session listing, newest first.
 *
 * A stored conversation is a *directory* — the store keeps `.meta.json` and the
 * messages next to each other under it — so a folder is exactly what a chat is
 * here, and filtering folders out would leave the page with none.
 */
export function memorySessions(
  entries: readonly ListingEntry[],
): readonly QaMemoryOverviewSession[] {
  return entries
    .filter(
      (entry) =>
        !isInternal(entry.path) &&
        isTopLevel(entry.path) &&
        entry.path.startsWith(SESSION_PREFIX),
    )
    .sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    )
    .map((entry) => ({
      id: entry.path.slice(SESSION_PREFIX.length),
      summary: entry.summary,
      updatedAt: entry.updatedAt,
    }));
}

/** An empty answer, so every early return reports the same shape. */
function emptyOverview(
  scoped: boolean,
  error: string | null,
  connected: boolean,
): QaUserMemoryOverview {
  return {
    connected,
    scoped,
    accountApplies: false,
    serverIdentity: "",
    profile: null,
    groups: [],
    sessions: [],
    totals: { sections: 0, memories: 0, sessions: 0 },
    truncated: { memories: false, sessions: false },
    error,
  };
}

/** The text of one file in the account's own memory, or nothing. */
async function readFile(
  source: MemoryOverviewSource,
  uri: string,
): Promise<string | null> {
  const response = await source.fetchJSON(
    `/api/v1/content/read?uri=${encodeURIComponent(uri)}`,
    {},
    { timeoutMs: 8000 },
  );
  if (!response.ok || typeof response.result !== "string") return null;
  const text = response.result.trim();
  return text === "" ? null : text;
}

/** One listing, or nothing when the store refused it. */
async function list(
  source: MemoryOverviewSource,
  uri: string,
  options: { readonly recursive?: boolean; readonly nodeLimit: number },
): Promise<{
  readonly entries: readonly ListingEntry[];
  readonly truncated: boolean;
} | null> {
  const query = new URLSearchParams({
    uri,
    output: "agent",
    node_limit: String(options.nodeLimit),
  });
  if (options.recursive === true) {
    query.set("recursive", "true");
    query.set("abs_limit", String(ABSTRACT_LIMIT));
  }
  const response = await source.fetchJSON(
    `/api/v1/fs/ls?${query.toString()}`,
    {},
    { timeoutMs: 8000 },
  );
  if (!response.ok || !Array.isArray(response.result)) return null;
  const root = uri.replace(/\/+$/u, "");
  const entries: ListingEntry[] = [];
  for (const raw of response.result) {
    const entry = readEntry(raw, root);
    if (entry !== undefined) entries.push(entry);
  }
  // The API exposes no continuation marker. Reaching the requested limit is
  // therefore conservatively reported as truncation: claiming completeness
  // here would be worse than admitting that one exact-limit result may be all.
  return {
    entries,
    truncated: response.result.length >= options.nodeLimit,
  };
}

/** The profile the page shows: the first profile file the store actually has. */
async function readProfile(
  source: MemoryOverviewSource,
  entries: readonly ListingEntry[],
): Promise<QaMemoryOverviewProfile | null> {
  for (const name of PROFILE_FILES) {
    if (!entries.some((entry) => entry.path === name)) continue;
    const text = await readFile(source, `${MEMORIES_URI}/${name}`);
    if (text === null) continue;
    return {
      name,
      text: text.slice(0, PROFILE_MAX_CHARS),
      truncated: text.length > PROFILE_MAX_CHARS,
    };
  }
  return null;
}

/** The identity the store resolved for this caller, and whether it answered. */
async function readIdentity(source: MemoryOverviewSource): Promise<{
  readonly ok: boolean;
  readonly identity: string;
  readonly error: string | null;
}> {
  const response = await source.fetchJSON(
    "/api/v1/system/status",
    {},
    { timeoutMs: 5000 },
  );
  if (!response.ok) {
    const message = response.error?.message || `HTTP ${response.status}`;
    return { ok: false, identity: "", error: message };
  }
  const identity = asString(asRecord(response.result)?.user).trim();
  return { ok: true, identity, error: null };
}

/**
 * Read one account's memory, bounded for a page.
 *
 * The identity check is the honest part: this plugin sends the account as
 * `X-OpenViking-User`, but a server in API-key mode strips that header and
 * answers as its own user. Comparing the two is what turns "the page looks
 * shared" into a sentence the reader can act on, instead of a puzzle.
 */
export async function readUserMemoryOverview(
  source: MemoryOverviewSource,
  options: MemoryOverviewOptions,
): Promise<QaUserMemoryOverview> {
  const status = await readIdentity(source);
  if (!status.ok) {
    return emptyOverview(options.scoped, status.error, false);
  }

  const expected = source.config.user.trim();
  const identityMatches = expected !== "" && status.identity === expected;
  const accountApplies = options.scoped && identityMatches;
  if (options.scoped && !identityMatches) {
    // In per-account mode an identity mismatch is an authorization boundary,
    // not a warning. Do not ask the store for content that may belong to a
    // deployment-wide account, much less return it to the signed-in caller.
    return {
      ...emptyOverview(true, null, true),
      serverIdentity: status.identity,
    };
  }

  const memoryListing = await list(source, MEMORIES_URI, {
    recursive: true,
    nodeLimit: MEMORY_NODE_LIMIT,
  });
  if (memoryListing === null) {
    return emptyOverview(options.scoped, "the memory listing failed", false);
  }
  const sessionListing = await list(source, SESSIONS_URI, {
    nodeLimit: SESSION_NODE_LIMIT,
  });

  const profile = await readProfile(source, memoryListing.entries);
  const allGroups = memoryGroups(memoryListing.entries, profile?.name ?? null);
  const allSessions = memorySessions(sessionListing?.entries ?? []);

  return {
    connected: true,
    scoped: options.scoped,
    accountApplies,
    serverIdentity: status.identity,
    profile,
    groups: allGroups.slice(0, MAX_GROUPS),
    sessions: allSessions.slice(0, MAX_SESSIONS),
    totals: {
      sections: allGroups.length,
      memories: allGroups.reduce((sum, group) => sum + group.total, 0),
      sessions: allSessions.length,
    },
    truncated: {
      memories: memoryListing.truncated,
      sessions: sessionListing?.truncated ?? false,
    },
    error: null,
  };
}
