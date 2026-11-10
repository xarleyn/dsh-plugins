/** Browser-only presentation metadata. No entry is a filesystem path. */
export interface QaHistoryFolder {
  readonly id: string;
  readonly name: string;
  readonly collapsed: boolean;
}

export interface QaHistoryOrganization {
  readonly folders: readonly QaHistoryFolder[];
  readonly assignments: Readonly<Record<string, string>>;
  readonly pinned: readonly string[];
  readonly order: readonly string[];
}

export const EMPTY_HISTORY: QaHistoryOrganization = {
  folders: [],
  assignments: {},
  pinned: [],
  order: [],
};

/** Treat storage as untrusted and tolerate older, partial or damaged values. */
export function parseHistoryOrganization(
  raw: string | null,
): QaHistoryOrganization {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (value === null || typeof value !== "object") return EMPTY_HISTORY;
    const data = value as Record<string, unknown>;
    const folders: QaHistoryFolder[] = [];
    const ids = new Set<string>();
    if (Array.isArray(data.folders)) {
      for (const entry of data.folders) {
        if (entry === null || typeof entry !== "object") continue;
        const folder = entry as Record<string, unknown>;
        if (
          typeof folder.id !== "string" ||
          !folder.id ||
          ids.has(folder.id) ||
          typeof folder.name !== "string" ||
          !folder.name.trim()
        )
          continue;
        ids.add(folder.id);
        folders.push({
          id: folder.id,
          name: folder.name.trim().slice(0, 80),
          collapsed: folder.collapsed === true,
        });
      }
    }
    const assignments = Object.fromEntries(
      data.assignments !== null &&
        typeof data.assignments === "object" &&
        !Array.isArray(data.assignments)
        ? Object.entries(data.assignments).filter(
            ([, id]) => typeof id === "string" && ids.has(id),
          )
        : [],
    ) as Record<string, string>;
    const strings = (input: unknown): string[] =>
      Array.isArray(input)
        ? [
            ...new Set(
              input.filter(
                (id): id is string => typeof id === "string" && id.length > 0,
              ),
            ),
          ]
        : [];
    return {
      folders,
      assignments,
      pinned: strings(data.pinned),
      order: strings(data.order),
    };
  } catch {
    return EMPTY_HISTORY;
  }
}

export function historyFolderOf(
  state: QaHistoryOrganization,
  id: string,
): string | null {
  return Object.hasOwn(state.assignments, id)
    ? (state.assignments[id] ?? null)
    : null;
}

/** A removed folder releases its chats, including pinned chats, to the root. */
export function removeHistoryFolder(
  state: QaHistoryOrganization,
  folderId: string,
): QaHistoryOrganization {
  return {
    ...state,
    folders: state.folders.filter((folder) => folder.id !== folderId),
    assignments: Object.fromEntries(
      Object.entries(state.assignments).filter(([, id]) => id !== folderId),
    ),
  };
}

/** Insert relative to the visible target without losing filtered or unloaded ids. */
export function insertHistoryId(
  ids: readonly string[],
  id: string,
  before?: string,
): string[] {
  if (before === id) return [...ids];
  const rest = ids.filter((item) => item !== id);
  const index = before === undefined ? -1 : rest.indexOf(before);
  rest.splice(index < 0 ? rest.length : index, 0, id);
  return rest;
}

export type QaHistoryDestination =
  | { readonly kind: "pinned" }
  | {
      readonly kind: "folder";
      readonly id: string | null;
    };

/** Moving a pinned chat into a folder unpins it; pinning retains its folder. */
export function moveHistoryChat(
  state: QaHistoryOrganization,
  id: string,
  destination: QaHistoryDestination,
  visibleOrder: readonly string[],
  before?: string,
): QaHistoryOrganization {
  if (destination.kind === "pinned") {
    return { ...state, pinned: insertHistoryId(state.pinned, id, before) };
  }
  if (
    destination.id !== null &&
    !state.folders.some((folder) => folder.id === destination.id)
  )
    return state;
  const assignments = Object.fromEntries(
    Object.entries(state.assignments).filter(([key]) => key !== id),
  );
  if (destination.id !== null)
    Object.defineProperty(assignments, id, {
      value: destination.id,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  return {
    ...state,
    assignments,
    pinned: state.pinned.filter((entry) => entry !== id),
    order: insertHistoryId(
      [...new Set([...state.order, ...visibleOrder])],
      id,
      before,
    ),
  };
}

/** Unordered rows keep recency order until the reader arranges them. */
export function orderHistoryRows<T extends { readonly id: string }>(
  rows: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
  );
}
