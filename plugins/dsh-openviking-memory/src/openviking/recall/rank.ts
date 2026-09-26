/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
//
// Deciding which of the retrieved items the turn is shown: the relevance
// profile read off the query text, the boosts applied to it, and the dedup that
// collapses near-identical hits. One reason to change — the ranking rule.

import type { QueryProfile, RecallItem } from "./types.js";

const PREFERENCE_QUERY_RE =
  /prefer|preference|favorite|favourite|like|偏好|喜欢|爱好|更倾向/i;
const TEMPORAL_QUERY_RE =
  /when|what time|date|day|month|year|yesterday|today|tomorrow|last|next|什么时候|何时|哪天|几月|几年|昨天|今天|明天/i;
const QUERY_TOKEN_RE = /[a-z0-9一-龥]{2,}/gi;
const STOPWORDS = new Set([
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  "did",
  "does",
  "is",
  "are",
  "was",
  "were",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "you",
]);

export function clampScore(v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function buildQueryProfile(query: string): QueryProfile {
  const text = query.trim();
  const allTokens: string[] = text.toLowerCase().match(QUERY_TOKEN_RE) || [];
  return {
    tokens: allTokens.filter((t) => !STOPWORDS.has(t)),
    wantsPreference: PREFERENCE_QUERY_RE.test(text),
    wantsTemporal: TEMPORAL_QUERY_RE.test(text),
  };
}

function lexicalOverlapBoost(tokens: readonly string[], text: string): number {
  if (tokens.length === 0 || !text) return 0;
  const haystack = ` ${text.toLowerCase()} `;
  let matched = 0;
  for (const token of tokens.slice(0, 8)) {
    if (haystack.includes(token)) matched += 1;
  }
  return Math.min(0.2, (matched / Math.min(tokens.length, 4)) * 0.2);
}

export function rankItem(item: RecallItem, profile: QueryProfile): number {
  const base = clampScore(item.score);
  const abstract = String(item.abstract || item.overview || "").trim();
  const cat = String(item.category || "").toLowerCase();
  const uri = String(item.uri || "").toLowerCase();
  const leafBoost = item.level === 2 || uri.endsWith(".md") ? 0.12 : 0;
  const eventBoost =
    profile.wantsTemporal && (cat === "events" || uri.includes("/events/"))
      ? 0.1
      : 0;
  const prefBoost =
    profile.wantsPreference &&
    (cat === "preferences" || uri.includes("/preferences/"))
      ? 0.08
      : 0;
  const overlapBoost = lexicalOverlapBoost(
    profile.tokens,
    `${item.uri} ${abstract}`,
  );
  return base + leafBoost + eventBoost + prefBoost + overlapBoost;
}

function isEventOrCaseItem(item: RecallItem): boolean {
  const cat = String(item.category || "").toLowerCase();
  const uri = String(item.uri || "").toLowerCase();
  return (
    cat === "events" ||
    cat === "cases" ||
    uri.includes("/events/") ||
    uri.includes("/cases/")
  );
}

export function dedupeItems(items: readonly RecallItem[]): RecallItem[] {
  const seen = new Set<string>();
  const out: RecallItem[] = [];
  for (const item of items) {
    const key = isEventOrCaseItem(item)
      ? `uri:${item.uri}`
      : String(item.abstract || item.overview || "")
          .trim()
          .toLowerCase() || `uri:${item.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
