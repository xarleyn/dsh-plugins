/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
//
// Which stage runs for one turn: the server-assembled faces first, the raw
// find/rank/format path when the deployment cannot serve them, and the old peer
// alongside the current one. One reason to change — the order the paths try.

import { compressRecallContext } from "../recall-compress-core.js";
import { buildFallbackInjectionBlock, wrapContext } from "./format.js";
import {
  buildQueryProfile,
  clampScore,
  dedupeItems,
  rankItem,
} from "./rank.js";
import {
  buildRecallEndpointBody,
  DEFAULT_CONTEXT_LIMIT,
} from "./request-body.js";
import { fetchAssembledContext, postRecall } from "./server-assembled.js";
import { searchAllSources } from "./source-search.js";
import { stateFile } from "./state-files.js";
import type {
  FetchJSON,
  RecallConfig,
  RecallLog,
  RecallOptions,
} from "./types.js";
import { asRecord } from "./types.js";

/**
 * Server-assembled context: the context face when the deployment has it, else
 * the deprecated /recall preset. Returns the injection block, "" when there was
 * nothing relevant, or null when no server-side path was usable at all.
 */
async function buildServerAssembledBlock(
  fetchJSON: FetchJSON,
  cfg: RecallConfig,
  query: string,
  options: RecallOptions = {},
): Promise<string | null> {
  const actorPeerId = options.actorPeerId ?? cfg.peerId ?? "";
  const log: RecallLog = options.log || (() => {});

  const block = await recallViaContextFace(
    fetchJSON,
    cfg,
    query,
    { ...options, actorPeerId },
    log,
  );
  if (block !== null) return block;
  return recallViaEndpoint(fetchJSON, cfg, query, actorPeerId, log);
}

async function recallViaContextFace(
  fetchJSON: FetchJSON,
  cfg: RecallConfig,
  query: string,
  options: RecallOptions,
  log: RecallLog,
): Promise<string | null> {
  const assembled = await fetchAssembledContext(fetchJSON, cfg, query, {
    ...options,
    log,
  });
  if (assembled === null) return null;

  const { rendered, entries } = assembled;
  let digest = assembled.digest;
  const mode = String(cfg.recallRewrite || "off").toLowerCase();
  if (String(assembled.stats?.rewrite || "").toLowerCase() === "no_relevant") {
    log("recall_server_compression", { status: "empty" });
    return "";
  }
  const wantsLocal = mode === "client" || (mode === "auto" && !digest);
  const runCompressor = options.runCompressor;
  if (wantsLocal && rendered && typeof runCompressor === "function") {
    try {
      const compression = await compressRecallContext({
        query,
        rendered,
        entries,
        cfg,
        runCompressor,
        cachePath: options.digestCachePath || stateFile("recall-digest.json"),
        now: Date.now(),
      });
      log("recall_local_compression", { status: compression.status });
      if (compression.status === "ok") digest = compression.context;
      if (compression.status === "empty") return "";
    } catch (err) {
      const message = (err as { readonly message?: unknown } | null)?.message;
      log("recall_local_compression_failed", { error: String(message || err) });
    }
  }

  const injected = digest || rendered;
  if (!injected) return "";
  return wrapContext(injected);
}

async function recallViaEndpoint(
  fetchJSON: FetchJSON,
  cfg: RecallConfig,
  query: string,
  actorPeerId: string = "",
  log: RecallLog = () => {},
): Promise<string | null> {
  const body = buildRecallEndpointBody(cfg);
  body.query = query;
  const res = await postRecall(fetchJSON, body, { actorPeerId, log });
  if (!res.ok) {
    log("recall_endpoint_fallback", { status: res.status || 0 });
    return null;
  }
  const rendered = String(asRecord(res.result)?.rendered || "").trim();
  if (!rendered) return "";
  return wrapContext(rendered);
}

/**
 * Recall, plus whatever is still filed under the peer this workspace used
 * before the identity rule changed.
 *
 * Under the default `peer_scope: "all"` this costs nothing: the server's own
 * sweep of `{user_root}/peers` already reaches the old peer's memories. Under
 * `"actor"` that sweep is off by definition, so the old peer is asked for
 * separately — as itself, which is both cheaper and wider than a bare
 * cross-peer read (that would need the user id, and reaches memories only).
 */
export async function buildRecallBlock(
  fetchJSON: FetchJSON,
  cfg: RecallConfig,
  query: string,
  options: RecallOptions = {},
): Promise<string | null> {
  const primary = await recallForPeer(fetchJSON, cfg, query, options);

  const legacyPeerId = String(options.legacyPeerId || "").trim();
  const actorPeerId = options.actorPeerId ?? cfg.peerId ?? "";
  if (
    cfg.recallPeerScope !== "actor" ||
    !legacyPeerId ||
    legacyPeerId === actorPeerId
  )
    return primary;

  const log: RecallLog = options.log || (() => {});
  const legacy = await recallForPeer(fetchJSON, cfg, query, {
    ...options,
    actorPeerId: legacyPeerId,
  });
  if (!legacy) return primary;
  log("recall_legacy_peer_hit", { legacyPeerId });
  return primary ? `${primary}\n${legacy}` : legacy;
}

async function recallForPeer(
  fetchJSON: FetchJSON,
  cfg: RecallConfig,
  query: string,
  options: RecallOptions = {},
): Promise<string | null> {
  const actorPeerId = options.actorPeerId ?? cfg.peerId ?? "";
  const log: RecallLog = options.log || (() => {});
  const trimmed = String(query || "").trim();
  if (!trimmed) return null;

  // Assembly happens server-side when the deployment offers the context face;
  // older servers fall through to /recall, then to raw find.
  const serverBlock = await buildServerAssembledBlock(fetchJSON, cfg, trimmed, {
    ...options,
    actorPeerId,
    log,
  });
  if (serverBlock !== null) return serverBlock || null;

  const recallLimit = Math.max(
    1,
    Number(cfg.recallLimit || DEFAULT_CONTEXT_LIMIT),
  );
  const perSourceLimit = Math.max(recallLimit * 2, 8);
  const raw = await searchAllSources(
    fetchJSON,
    trimmed,
    perSourceLimit,
    actorPeerId,
    log,
  );
  if (raw.length === 0) return null;

  const profile = buildQueryProfile(trimmed);
  const scoreThreshold = Number.isFinite(Number(cfg.scoreThreshold))
    ? Number(cfg.scoreThreshold)
    : 0.35;
  const filtered = raw.filter((it) => clampScore(it.score) >= scoreThreshold);
  filtered.sort((a, b) => rankItem(b, profile) - rankItem(a, profile));
  const picked = dedupeItems(filtered).slice(0, recallLimit);
  log("recall_picked", {
    rawCount: raw.length,
    filteredCount: filtered.length,
    pickedCount: picked.length,
    items: picked.map((it) => ({
      type: it._sourceType,
      uri: it.uri,
      score: clampScore(it.score),
    })),
  });

  if (picked.length === 0) return null;
  return buildFallbackInjectionBlock(fetchJSON, picked, cfg, actorPeerId, log);
}
