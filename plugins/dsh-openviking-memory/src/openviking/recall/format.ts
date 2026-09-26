/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
//
// Turning picked items into the text the model is handed: the token estimate
// the budget is measured in, the per-item content (read back only to be
// rendered), and the envelope around the result. One reason to change — the
// shape of the injected block.

import type {
  FetchJSON,
  RecallConfig,
  RecallItem,
  RecallLog,
} from "./types.js";
import { clampScore } from "./rank.js";

export function estimateTokens(text: unknown): number {
  return text ? Math.ceil(String(text).length / 4) : 0;
}

async function resolveItemContent(
  fetchJSON: FetchJSON,
  item: RecallItem,
  cfg: RecallConfig,
  actorPeerId: string = "",
): Promise<string> {
  let content: string;

  if (
    cfg.recallPreferAbstract &&
    String(item.abstract || item.overview || "").trim()
  ) {
    content = String(item.abstract || item.overview).trim();
  } else if (item.level === 2) {
    try {
      const res = await fetchJSON(
        `/api/v1/content/read?uri=${encodeURIComponent(String(item.uri))}`,
        {},
        { actorPeerId },
      );
      const body =
        res.ok && typeof res.result === "string" ? res.result.trim() : "";
      content =
        body ||
        String(item.abstract || item.overview || "").trim() ||
        String(item.uri);
    } catch {
      content =
        String(item.abstract || item.overview || "").trim() || String(item.uri);
    }
  } else {
    content =
      String(item.abstract || item.overview || "").trim() || String(item.uri);
  }

  const maxChars = Math.max(50, Number(cfg.recallMaxContentChars || 500));
  if (content.length > maxChars) content = `${content.slice(0, maxChars)}...`;
  return content;
}

export async function buildFallbackInjectionBlock(
  fetchJSON: FetchJSON,
  items: readonly RecallItem[],
  cfg: RecallConfig,
  actorPeerId: string = "",
  log: RecallLog = () => {},
): Promise<string | null> {
  if (items.length === 0) return null;

  let budgetRemaining = Math.max(200, Number(cfg.recallTokenBudget || 2000));
  const lines = [
    "<openviking-context>",
    "Relevant context from OpenViking. Use the read MCP tool to expand URIs.",
  ];
  let contentCount = 0;
  let hintCount = 0;

  for (const item of items) {
    const score = (clampScore(item.score) * 100).toFixed(0);
    const uriLine = `- [${item._sourceType} ${score}%] ${item.uri}`;

    if (budgetRemaining > 0) {
      const content = await resolveItemContent(
        fetchJSON,
        item,
        cfg,
        actorPeerId,
      );
      const contentLine = `- [${item._sourceType} ${score}%] ${content}`;
      const lineTokens = estimateTokens(contentLine);

      if (lineTokens > budgetRemaining && contentCount > 0) {
        lines.push(uriLine);
        hintCount++;
      } else {
        lines.push(contentLine);
        budgetRemaining -= lineTokens;
        contentCount++;
      }
    } else {
      lines.push(uriLine);
      hintCount++;
    }
  }

  lines.push("</openviking-context>");

  const budgetUsed =
    Math.max(200, Number(cfg.recallTokenBudget || 2000)) - budgetRemaining;
  log("recall_injection_built", {
    contentItems: contentCount,
    hintItems: hintCount,
    budgetUsed,
    budgetTotal: Math.max(200, Number(cfg.recallTokenBudget || 2000)),
  });

  return lines.join("\n");
}

export function wrapContext(body: string): string {
  return [
    "<openviking-context>",
    "Relevant memory from OpenViking. Use the search/read MCP tools to expand URIs.",
    body,
    "</openviking-context>",
  ].join("\n");
}
