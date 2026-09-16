/**
 * Cursor paging shared by every administrative list. Admin tables read from
 * append-only files whose newest entries arrive last, so a list is always
 * materialized newest-first and a cursor names the last row the caller saw.
 *
 * The cursor is the row's sort key plus its identity, never an offset: rows
 * keep arriving while a reviewer pages, and an offset would then skip or
 * repeat entries.
 */
export interface QaPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly total: number;
}

export interface QaPageRequest<T> {
  /** Rows in their final order, newest first. */
  readonly rows: readonly T[];
  /** The composite sort key of one row; must be unique together with the id. */
  readonly keyOf: (row: T) => string;
  /** The row's stable identity. */
  readonly idOf: (row: T) => string;
  /** Cursor returned by the previous page; absent for the first page. */
  readonly cursor?: string | undefined;
  /** Requested page size, clamped by the caller's own bounds. */
  readonly limit: number;
}

function cursorOf<T>(
  row: T,
  keyOf: (row: T) => string,
  idOf: (row: T) => string,
) {
  return `${keyOf(row)}\u0000${idOf(row)}`;
}

/**
 * Slice one page out of an already-sorted list. An unknown cursor is treated as
 * the start of the list: it can only mean the row was trimmed away since the
 * caller last paged, in which case restarting is the honest answer.
 */
export function paginate<T>({
  rows,
  keyOf,
  idOf,
  cursor,
  limit,
}: QaPageRequest<T>): QaPage<T> {
  const total = rows.length;
  let start = 0;
  if (cursor !== undefined && cursor !== "") {
    const index = rows.findIndex(
      (row) => cursorOf(row, keyOf, idOf) === cursor,
    );
    start = index === -1 ? 0 : index + 1;
  }
  const items = rows.slice(start, start + limit);
  const last = items[items.length - 1];
  const nextCursor =
    last !== undefined && start + items.length < total
      ? cursorOf(last, keyOf, idOf)
      : null;
  return { items, nextCursor, total };
}
