/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
//
// The raw `find` request against each memory source, and the user-space
// resolution its URIs depend on: the path a deployment without a server-side
// context face falls back to. One reason to change — the backend's search
// endpoint and its URI aliases.

import type { FetchJSON, RecallBody, RecallItem, RecallLog } from "./types.js";
import { asRecord } from "./types.js";

const USER_RESERVED_DIRS = new Set(["memories", "skills"]);

/** One `find` target: a root URI and the response bucket it answers in. */
interface RecallSource {
  readonly type: string;
  readonly uri: string;
  readonly bucket: string;
}

const SOURCES: readonly RecallSource[] = [
  { type: "memory", uri: "viking://~/memories", bucket: "memories" },
  { type: "skill", uri: "viking://~/skills", bucket: "skills" },
];

let userSpaceCache = "";

async function resolveUserSpace(
  fetchJSON: FetchJSON,
  actorPeerId: string = "",
): Promise<string> {
  if (userSpaceCache) return userSpaceCache;

  let fallbackSpace = "default";
  const status = await fetchJSON("/api/v1/system/status");
  const statusUser = asRecord(status.result)?.user;
  if (status.ok && typeof statusUser === "string" && statusUser.trim()) {
    fallbackSpace = statusUser.trim();
  }

  const lsRes = await fetchJSON(
    `/api/v1/fs/ls?uri=${encodeURIComponent("viking://user")}&output=original`,
    {},
    { actorPeerId },
  );
  if (lsRes.ok && Array.isArray(lsRes.result)) {
    const spaces = lsRes.result
      .filter((e) => asRecord(e)?.isDir)
      .map((e) => {
        const name = asRecord(e)?.name;
        return typeof name === "string" ? name.trim() : "";
      })
      .filter((n) => n && !n.startsWith(".") && !USER_RESERVED_DIRS.has(n));
    if (spaces.length > 0) {
      if (spaces.includes(fallbackSpace)) {
        userSpaceCache = fallbackSpace;
        return fallbackSpace;
      }
      if (spaces.includes("default")) {
        userSpaceCache = "default";
        return "default";
      }
      if (spaces.length === 1) {
        userSpaceCache = spaces[0]!;
        return spaces[0]!;
      }
    }
  }
  userSpaceCache = fallbackSpace;
  return fallbackSpace;
}

async function resolveTargetUri(
  fetchJSON: FetchJSON,
  targetUri: string,
  actorPeerId: string = "",
): Promise<string> {
  const trimmed = targetUri.trim().replace(/\/+$/, "");
  // viking://~ is the home alias: the server expands it to the caller's own user
  // space, so it needs no client-side rewrite.
  if (trimmed === "viking://~" || trimmed.startsWith("viking://~/"))
    return trimmed;
  // Legacy compat: uid-less viking://user/<reserved> URIs may still sit in plugin
  // configs. Newer servers reject them, so rewrite to an explicit-uid URI here.
  const m = trimmed.match(/^viking:\/\/user(?:\/(.*))?$/);
  if (!m) return trimmed;
  const rawRest = (m[1] ?? "").trim();
  if (!rawRest) return trimmed;
  const parts = rawRest.split("/").filter(Boolean);
  if (parts.length === 0) return trimmed;
  if (!USER_RESERVED_DIRS.has(parts[0]!)) return trimmed;
  const space = await resolveUserSpace(fetchJSON, actorPeerId);
  return `viking://user/${space}/${parts.join("/")}`;
}

async function searchOneSource(
  fetchJSON: FetchJSON,
  query: string,
  source: RecallSource,
  limit: number,
  actorPeerId: string = "",
): Promise<RecallItem[]> {
  const resolvedUri = await resolveTargetUri(
    fetchJSON,
    source.uri,
    actorPeerId,
  );
  const body: RecallBody = {
    query,
    target_uri: resolvedUri,
    limit,
    score_threshold: 0,
  };
  const res = await fetchJSON(
    "/api/v1/search/find",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    { actorPeerId },
  );
  if (!res.ok) return [];
  const bucket = asRecord(res.result)?.[source.bucket];
  const items: unknown[] = Array.isArray(bucket) ? bucket : [];
  return items.map((item): RecallItem => ({
    ...(item as RecallItem),
    _sourceType: source.type,
  }));
}

export async function searchAllSources(
  fetchJSON: FetchJSON,
  query: string,
  perSourceLimit: number,
  actorPeerId: string = "",
  log: RecallLog = () => {},
): Promise<RecallItem[]> {
  const results = await Promise.all(
    SOURCES.map((src) =>
      searchOneSource(fetchJSON, query, src, perSourceLimit, actorPeerId),
    ),
  );
  const all = results.flat();
  log("recall_search_summary", {
    counts: SOURCES.map((src, i) => ({
      type: src.type,
      uri: src.uri,
      count: results[i]!.length,
    })),
    total: all.length,
  });
  return all;
}
