/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
//
// What the recall paths send: the request bodies of the two search faces and
// the quota arithmetic behind them. One reason to change — the shape of the
// server's request contract.

import type { RecallBody, RecallConfig, RecallOptions } from "./types.js";

export const DEFAULT_CONTEXT_LIMIT = 10;
const DEFAULT_CONTEXT_MAX_TOKENS = 1600;
const DEFAULT_REWRITE_MAX_BULLETS = 6;
const CODING_QUOTA_WEIGHTS: Record<string, number> = {
  events: 1,
  entities: 2,
  preferences: 1,
  experiences: 1,
  resources: 3,
  skills: 2,
};

function scaleQuotas(
  limit: number,
  weights: Record<string, number>,
): Record<string, number> {
  const slots = Math.max(1, Math.floor(Number(limit) || DEFAULT_CONTEXT_LIMIT));
  const order = Object.keys(weights);
  const quotas: Record<string, number> = Object.fromEntries(
    order.map((key): [string, number] => [key, 0]),
  );
  if (slots < order.length) {
    for (const key of order) quotas[key] = 1;
    return quotas;
  }

  for (const key of order) quotas[key] = 1;
  const totalWeight = Object.values(weights).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  const ideals: Record<string, number> = Object.fromEntries(
    order.map((key): [string, number] => [
      key,
      (slots * weights[key]!) / totalWeight,
    ]),
  );
  while (order.reduce((sum, key) => sum + quotas[key]!, 0) < slots) {
    const key = order.reduce((best, candidate) =>
      ideals[candidate]! - quotas[candidate]! > ideals[best]! - quotas[best]!
        ? candidate
        : best,
    );
    quotas[key] = (quotas[key] ?? 0) + 1;
  }
  return quotas;
}

function legacyMemoryQuotas(limit: number): Record<string, number> {
  return {
    ...scaleQuotas(limit, { events: 10, entities: 10, preferences: 3 }),
    experiences: 0,
  };
}

function codingQuotas(limit: number): Record<string, number> {
  return scaleQuotas(limit, CODING_QUOTA_WEIGHTS);
}

export function buildRecallEndpointBody(cfg: RecallConfig = {}): RecallBody {
  const limit = Math.max(Number(cfg.recallLimit || DEFAULT_CONTEXT_LIMIT), 1);
  const body: RecallBody = {
    query: "",
    quotas: legacyMemoryQuotas(limit),
    max_chars: Math.max(Number(cfg.recallMaxContentChars || 0) * limit, 1000),
    min_score: Number.isFinite(Number(cfg.scoreThreshold))
      ? Number(cfg.scoreThreshold)
      : 0.35,
    render: true,
  };
  if (cfg.recallPeerScope === "actor") body.peer_scope = "actor";
  return body;
}

/**
 * Body for the server-side context face. The plugin declares intent (coding
 * purpose, budget, session) and leaves the mechanics — quota ratios, tier
 * degradation, cross-turn dedup — to the server's defaults.
 */
export function buildContextSearchBody(
  cfg: RecallConfig = {},
  options: RecallOptions = {},
): RecallBody {
  const rewriteMode = String(cfg.recallRewrite || "off").toLowerCase();
  const limit = Math.max(
    1,
    Math.floor(Number(cfg.recallLimit || DEFAULT_CONTEXT_LIMIT)),
  );
  const maxTokens = Math.max(
    64,
    Math.floor(Number(cfg.recallMaxTokens || DEFAULT_CONTEXT_MAX_TOKENS)),
  );
  const body: RecallBody = {
    query: "",
    mode: "context",
    purpose: "coding",
    score_threshold: Number.isFinite(Number(cfg.scoreThreshold))
      ? Number(cfg.scoreThreshold)
      : 0.35,
  };
  const limitConfigured = cfg.recallLimitConfigured === true;
  const maxTokensConfigured = cfg.recallMaxTokensConfigured === true;
  if (limitConfigured) body.quotas = codingQuotas(limit);
  if (maxTokensConfigured) body.max_tokens = maxTokens;
  if (cfg.recallPeerScope === "actor") body.peer_scope = "actor";

  const sessionId = String(options.sessionId || "").trim();
  if (sessionId) {
    body.session_id = sessionId;
    const queryExpansionConfigured =
      cfg.recallQueryExpansionConfigured === true;
    if (queryExpansionConfigured) {
      body.query_expansion =
        cfg.recallQueryExpansion === "off" ? "off" : "auto";
    }
    const dedupTurns = Number(cfg.recallDedupTurns);
    const resolvedDedupTurns = Number.isFinite(dedupTurns)
      ? Math.max(0, Math.floor(dedupTurns))
      : 5;
    if (resolvedDedupTurns > 0) body.dedup_turns = resolvedDedupTurns;
  }

  const excludeUris: unknown[] = Array.isArray(options.excludeUris)
    ? options.excludeUris.slice(0, 200)
    : [];
  if (excludeUris.length) body.exclude_uris = excludeUris;

  if (rewriteMode === "server") body.rewrite = true;
  else if (rewriteMode === "auto" && !options.localCompressorAvailable)
    body.rewrite = "auto";
  const rewriteMaxBullets = Math.max(
    1,
    Math.floor(
      Number(cfg.recallCompressMaxBullets || DEFAULT_REWRITE_MAX_BULLETS),
    ),
  );
  const rewriteMaxBulletsConfigured =
    cfg.recallCompressMaxBulletsConfigured === true;
  if (body.rewrite !== undefined && rewriteMaxBulletsConfigured) {
    body.rewrite_max_bullets = rewriteMaxBullets;
  }
  return body;
}

// The server pipeline is serial and each optional stage has its own fuse. A
// request is aborted client-side unless its deadline covers every stage it
// asked for, and aborting discards the whole response rather than just the
// stage that ran long.
//
//   session_id  -> query expansion   (retrieval.recall_intent_timeout_s,  5s)
//   always      -> retrieval, body reads, budget planning
//   rewrite     -> digest            (retrieval.recall_rewrite_timeout_s, 30s)
//
// Both budgets stay inside the 60s prompt-hook allowance, the rewrite one with
// a quarter to spare.
const EXPANSION_REQUEST_TIMEOUT_MS = 15000;
const SERVER_REWRITE_REQUEST_TIMEOUT_MS = 45000;

/**
 * HTTP deadline for one context request, or undefined to keep the caller's own.
 *
 * Derived from the request body, because the body is what states which server
 * stages will run: reading `cfg` alone cannot tell a bare retrieval from one
 * that also spends the expansion or rewrite fuse.
 */
export function contextRequestTimeoutMs(
  cfg: RecallConfig = {},
  body: RecallBody = {},
): number | undefined {
  const wantsRewrite = body.rewrite !== undefined;
  // `query_expansion` defaults to "auto" server-side, so only an explicit "off"
  // takes the expansion fuse back out of the budget.
  const wantsExpansion =
    Boolean(body.session_id) && body.query_expansion !== "off";
  const configured = Number(cfg.recallContextTimeoutMs);
  if (Number.isFinite(configured) && configured > 0)
    return Math.max(1000, Math.floor(configured));
  if (!wantsRewrite && !wantsExpansion) return undefined;
  const floor = wantsRewrite
    ? SERVER_REWRITE_REQUEST_TIMEOUT_MS
    : EXPANSION_REQUEST_TIMEOUT_MS;
  return Math.max(Number(cfg.timeoutMs) || 0, floor);
}
