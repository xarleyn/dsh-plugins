import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rankSlashEntries } from "../../slash/matcher.js";
import type { QaSlashCatalogEntry, QaSlashView } from "../../types.js";
import { slashPaletteQuery } from "../../slash/parser.js";

export interface QaSlashNavigation {
  /** True while the palette is on screen. */
  readonly open: boolean;
  readonly query: string;
  /** The rows the palette renders, best match first. */
  readonly rows: readonly QaSlashCatalogEntry[];
  /** Index into `rows`; -1 when there is nothing to select. */
  readonly active: number;
  readonly activeId: string | null;
  /** Move the selection by one row, wrapping at both ends. */
  readonly move: (delta: number) => void;
  /** Point the selection at one row, as a tap does. */
  readonly hover: (index: number) => void;
  /** Insert the active row's invocation into the draft. */
  readonly pickActive: () => void;
  /** Insert one row, as a click or a tap does. */
  readonly pick: (entry: QaSlashCatalogEntry) => void;
  /** Dismiss the palette for this draft. */
  readonly dismiss: () => void;
  /** The identity the user picked, while the draft still reads as its call. */
  readonly picked: QaSlashCatalogEntry | undefined;
}

export interface UseSlashNavigationOptions {
  readonly draft: string;
  readonly slash: QaSlashView;
  readonly maxVisible: number;
  readonly fuzzySearch: boolean;
  /** Set the draft to `text` and put the caret at its end. */
  readonly setDraft: (text: string) => void;
  /** Monotonic token; a change re-opens a palette the user had dismissed. */
  readonly reopen: number;
}

/**
 * Palette state for one composer draft.
 *
 * The palette is a pure function of the draft: it is open while the draft is
 * `/` plus a name still being typed, and closes the moment the user types a
 * space and starts writing arguments. Nothing has to be kept in sync — which
 * is also why switching chats (the composer is keyed by chat and remounts)
 * cannot leave a palette behind.
 *
 * Selection is one index over the filtered rows; the arrow keys, the mouse and
 * the touch screen all move the same number.
 */
export function useSlashNavigation(
  options: UseSlashNavigationOptions,
): QaSlashNavigation {
  const { draft, slash, setDraft } = options;
  const [dismissed, setDismissed] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const lastReopen = useRef(options.reopen);

  const query = slashPaletteQuery(draft);
  const canOpen = slash.enabled && query !== undefined && !dismissed;
  const open = canOpen;

  useEffect(() => {
    if (lastReopen.current === options.reopen) return;
    lastReopen.current = options.reopen;
    setDismissed(false);
  }, [options.reopen]);

  const rows = useMemo(() => {
    if (query === undefined) return [];
    return rankSlashEntries(slash.entries, query, {
      fuzzy: options.fuzzySearch,
    }).slice(0, options.maxVisible);
  }, [slash.entries, query, options.fuzzySearch, options.maxVisible]);

  // A new query re-ranks the rows, so the old index may point at a row that is
  // no longer the best match; the first row is always the right anchor.
  useEffect(() => {
    setActive(0);
  }, [query]);

  const bounded = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const activeId = bounded === -1 ? null : (rows[bounded]?.id ?? null);

  const picked = useMemo(() => {
    if (pickedId === null) return undefined;
    const entry = slash.entries.find((candidate) => candidate.id === pickedId);
    // The pick survives only while the draft still reads as that invocation;
    // editing the name away retires it and lets the router decide afresh.
    if (entry === undefined) return undefined;
    return draft === `/${entry.name}` || draft.startsWith(`/${entry.name} `)
      ? entry
      : undefined;
  }, [pickedId, slash.entries, draft]);

  const insert = useCallback(
    (entry: QaSlashCatalogEntry) => {
      setPickedId(entry.id);
      setDismissed(true);
      setDraft(`/${entry.name} `);
    },
    [setDraft],
  );

  return {
    open,
    query: query ?? "",
    rows,
    active: bounded,
    activeId,
    move: (delta) => {
      if (rows.length === 0) return;
      setActive((current) => {
        const next = current + delta;
        if (next < 0) return rows.length - 1;
        if (next >= rows.length) return 0;
        return next;
      });
    },
    hover: (index) => {
      setActive(index);
    },
    pickActive: () => {
      const entry = rows[bounded];
      if (entry !== undefined) insert(entry);
    },
    pick: insert,
    dismiss: () => {
      setDismissed(true);
    },
    picked,
  };
}
