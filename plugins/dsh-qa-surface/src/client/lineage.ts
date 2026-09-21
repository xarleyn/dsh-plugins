import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";

/**
 * Whether one session-list entry is a delegated child — a subagent's session —
 * rather than a chat.
 *
 * A delegated run is an implementation detail of a single answer: the Host
 * refuses to attest it, its sources reach the parent chat through the
 * provenance inheritance flow, and it has no owner. The host list the surface
 * already follows carries both marks (`origin` and `parentId`), so every
 * projection that talks about chats asks this one question instead of
 * re-deriving it — and a chat row, a chat count and a claim batch can never
 * disagree about what a chat is.
 */
export function isDelegatedSession(
  summary: Pick<SessionSummary, "origin" | "parentId"> | undefined,
): boolean {
  if (summary === undefined) return false;
  return summary.origin === "subagent" || summary.parentId !== undefined;
}

/** The session-list slice the lineage walk reads. */
export type SessionLineage = Readonly<
  Record<string, Pick<SessionSummary, "parentId"> | undefined>
>;

/**
 * The chat a session belongs to: itself when nothing delegated it, otherwise
 * the root of its parent chain.
 *
 * A nested child names its own delegated parent in `parentId`, so one hop is
 * not the chat. The walk stops at the first entry the host list does not know,
 * which keeps a partially hydrated list from inventing a chat that is not
 * there; a repeated id (a hostile or broken list) resolves to the id it
 * repeated on instead of hanging.
 */
export function chatRootOf(byId: SessionLineage, sessionId: string): string {
  let current = sessionId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const parent = byId[current]?.parentId;
    if (parent === undefined) return current;
    current = String(parent);
  }
  return current;
}

/** One delegated session a notice may be signed with, and its raw label. */
export interface SubagentNameCandidate {
  readonly id: string;
  /** The Host's own wording for the delegation; empty when it listed none. */
  readonly label: string;
}

/** One durable delegation catalog entry, as the Host lists it. */
export interface SubagentCatalogEntry {
  readonly kind?: string;
  readonly id?: string;
  readonly label?: string;
}

/** Direct delegation catalogs keyed by their parent chat. */
export type SubagentCatalogs = Readonly<
  Record<
    string,
    { readonly entries?: readonly SubagentCatalogEntry[] } | undefined
  >
>;

/**
 * Delegated sessions whose names a page may sign its notices with: the
 * children of the chats it lists, catalog labels first and list titles after.
 *
 * `chats` is the visible chat set — the account's own chats while accounts are
 * on, and `undefined` for a deployment without accounts, where every chat on
 * the Host is the browser's own. Ownership is checked against the chat, never
 * against the child: a delegated session has no owner of its own, so a child
 * is visible exactly when the chat it belongs to is. Another account's chat
 * therefore contributes no id and no label — a foreign chat can neither sign
 * a notice nor be named by one.
 */
export function visibleSubagentCandidates(
  byId: Readonly<Record<string, SessionSummary>>,
  catalogs: SubagentCatalogs,
  chats: ReadonlySet<string> | undefined,
): readonly SubagentNameCandidate[] {
  const visible = (chatId: string): boolean =>
    chats === undefined || chats.has(chatId);
  const candidates: SubagentNameCandidate[] = [];
  const seen = new Set<string>();
  for (const [parentId, catalog] of Object.entries(catalogs)) {
    if (!visible(parentId)) continue;
    for (const entry of catalog?.entries ?? []) {
      if (entry.kind !== "child") continue;
      const id = entry.id;
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      candidates.push({ id, label: entry.label ?? "" });
    }
  }
  for (const [key, summary] of Object.entries(byId)) {
    if (summary.origin !== "subagent") continue;
    const id = String(summary.id ?? key);
    if (seen.has(id)) continue;
    if (!visible(chatRootOf(byId, id))) continue;
    seen.add(id);
    candidates.push({ id, label: summary.displayTitle });
  }
  return candidates;
}
