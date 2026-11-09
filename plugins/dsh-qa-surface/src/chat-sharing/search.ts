import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionSearchValue } from "@deepseek-ai/dsh-api-session-controller/types";

interface SearchProvider {
  searchSessions(
    request: {
      query: string;
      sessionFilters: readonly {
        kind: "id";
        values: readonly ReturnType<typeof SessionId>[];
      }[];
      eventFilters: readonly {
        kind: "type" | "surface";
        values: readonly string[];
      }[];
      limit: number;
      cursor?: string;
    },
    context: { signal: AbortSignal },
  ): Promise<{
    items: readonly {
      header: { id: string };
      bestMatch: {
        sessionId: string;
        type: string;
        surface: string;
        snippet: string;
      };
    }[];
    nextCursor?: string;
  }>;
}

/** Apply account scope before the provider's ranking/limit, then recheck each read. */
export async function searchQaChats(
  ctx: Context,
  query: string,
  visible: () => Promise<ReadonlySet<string>>,
  signal: AbortSignal,
): Promise<SessionSearchValue> {
  const normalized = query.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 500 ||
    normalized.includes("\0")
  )
    throw new Error("Session search requires 1–500 characters without NUL.");
  signal.throwIfAborted();
  const initial = await visible();
  if (initial.size === 0) return { items: [], hasMore: false };
  const provider = ctx.get("sessionQuery") as SearchProvider | undefined;
  if (provider?.searchSessions === undefined)
    throw new Error("Session search is unavailable.");
  const found = new Map<string, string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let limit = 20;
  for (let calls = 0; calls < 100; calls++) {
    signal.throwIfAborted();
    let page: Awaited<ReturnType<SearchProvider["searchSessions"]>>;
    try {
      page = await provider.searchSessions(
        {
          query: normalized,
          sessionFilters: [{ kind: "id", values: [...initial].map(SessionId) }],
          eventFilters: [
            { kind: "type", values: ["user/message", "assistant/message"] },
            { kind: "surface", values: ["current"] },
          ],
          limit,
          ...(cursor === undefined ? {} : { cursor }),
        },
        { signal },
      );
    } catch (error) {
      signal.throwIfAborted();
      const code = (error as { code?: string } | undefined)?.code;
      if (
        cursor === undefined &&
        code === "SESSION_QUERY_INVALID_LIMIT" &&
        limit > 1
      ) {
        limit = Math.max(1, Math.floor(limit / 2));
        continue;
      }
      if (cursor !== undefined && code === "SESSION_QUERY_STALE_CURSOR") {
        cursor = undefined;
        found.clear();
        cursors.clear();
        continue;
      }
      throw error;
    }
    signal.throwIfAborted();
    if (page.items.length > limit)
      throw new Error("Session search provider exceeded its page limit.");
    const allowed = await visible();
    signal.throwIfAborted();
    for (const id of found.keys()) if (!allowed.has(id)) found.delete(id);
    for (const hit of page.items) {
      const id = String(hit.header.id),
        match = hit.bestMatch;
      if (
        !initial.has(id) ||
        !allowed.has(id) ||
        String(match.sessionId) !== id ||
        match.surface !== "current" ||
        !["user/message", "assistant/message"].includes(match.type)
      )
        continue;
      if (!found.has(id))
        found.set(id, [...match.snippet].slice(0, 240).join(""));
    }
    if (page.nextCursor !== undefined && cursors.has(page.nextCursor))
      throw new Error("Session search provider repeated a cursor.");
    if (
      found.size > 20 ||
      page.nextCursor === undefined ||
      allowed.size === 0
    ) {
      return {
        items: [...found].slice(0, 20).map(([sessionId, snippet]) => ({
          sessionId: SessionId(sessionId),
          snippet,
        })),
        hasMore: found.size > 20,
      };
    }
    cursor = page.nextCursor;
    cursors.add(cursor);
  }
  throw new Error("Session search exceeded its bounded page budget.");
}
