/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
//
// Asking the server to assemble the context instead of doing it here: the
// context face, the deprecated `/recall` preset behind it, and the rejections
// that mean "this deployment predates the field". One reason to change — the
// server's response contract.

import {
  buildContextSearchBody,
  contextRequestTimeoutMs,
} from "./request-body.js";
import {
  isContextFaceLegacy,
  markContextFaceLegacy,
  markPeerScopeDowngrade,
  readPeerScopeDowngrade,
} from "./state-files.js";
import type {
  AssembledContext,
  FetchJSON,
  FetchJSONResult,
  PostRecallOptions,
  RecallBody,
  RecallConfig,
  RecallItem,
  RecallLog,
  RecallOptions,
} from "./types.js";
import { asRecord } from "./types.js";

function looksLikeUnknownField(res: FetchJSONResult): boolean {
  const text = JSON.stringify(
    res?.error ?? res?.result ?? res?.detail ?? "",
  ).toLowerCase();
  return (
    text.includes("extra") ||
    text.includes("mode") ||
    text.includes("unexpected")
  );
}

/**
 * Raw server-assembled context, or null when the deployment has no context face.
 * Returns `{ rendered, entries, digest, stats }` — callers that need the entries
 * (their own compression, their own envelope) use this instead of the block
 * builders below.
 */
export async function fetchAssembledContext(
  fetchJSON: FetchJSON,
  cfg: RecallConfig,
  query: string,
  options: RecallOptions = {},
): Promise<AssembledContext | null> {
  const actorPeerId = options.actorPeerId || "";
  const log: RecallLog = options.log || (() => {});
  if (await isContextFaceLegacy(options.legacyCachePath)) return null;

  const body = buildContextSearchBody(cfg, options);
  body.query = query;
  const res = await fetchJSON(
    "/api/v1/search/search",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    { actorPeerId, timeoutMs: contextRequestTimeoutMs(cfg, body) },
  );

  if (!res.ok) {
    const status = res.status || 0;
    if ((status === 400 || status === 422) && looksLikeUnknownField(res)) {
      await markContextFaceLegacy(options.legacyCachePath);
      log("recall_context_face_unsupported", { status });
    } else {
      log("recall_context_face_error", { status });
    }
    return null;
  }

  const result: Record<string, unknown> = asRecord(res.result) || {};
  const stats: Record<string, unknown> = asRecord(result.stats) || {};
  log("recall_context_assembled", {
    entries: Array.isArray(result.entries) ? result.entries.length : 0,
    usedTokens: stats.used_tokens || 0,
    tiers: stats.tier_counts || {},
    rewrite: stats.rewrite || "off",
  });
  const rawEntries: unknown[] = Array.isArray(result.entries)
    ? result.entries
    : [];
  return {
    rendered: String(result.rendered || "").trim(),
    entries: rawEntries.map((entry): RecallItem => entry as RecallItem),
    digest: String(result.digest || "").trim(),
    stats,
  };
}

export async function postRecall(
  fetchJSON: FetchJSON,
  body: RecallBody,
  opts: PostRecallOptions = {},
): Promise<FetchJSONResult> {
  const actorPeerId = opts.actorPeerId || "";
  const log: RecallLog = opts.log || (() => {});
  const memoPath = opts.peerScopeMemoPath;
  const request: RecallBody = { ...body };

  // A remembered downgrade is still a downgrade: recall runs wider than the
  // caller asked for, so the memo doubles as the doctor's evidence.
  if (request.peer_scope && (await readPeerScopeDowngrade(memoPath))) {
    delete request.peer_scope;
  }

  const res = await fetchJSON(
    "/api/v1/search/recall",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    { actorPeerId },
  );
  if (!request.peer_scope || (res.status !== 400 && res.status !== 422)) {
    return res;
  }
  // Only an unknown-field rejection means "this server predates peer_scope".
  // Retrying every other 400/422 without it silently widens the search from
  // the caller's own peer to the whole user root.
  if (!looksLikeUnknownField(res)) {
    log("recall_peer_scope_error", { status: res.status || 0 });
    return res;
  }

  const downgraded: RecallBody = { ...request };
  delete downgraded.peer_scope;
  await markPeerScopeDowngrade(
    String(request.peer_scope),
    res.status || 0,
    memoPath,
  );
  log("recall_peer_scope_downgrade", { status: res.status || 0 });
  return fetchJSON(
    "/api/v1/search/recall",
    {
      method: "POST",
      body: JSON.stringify(downgraded),
    },
    { actorPeerId },
  );
}
