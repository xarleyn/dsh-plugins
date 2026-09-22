/**
 * Grouping for the palette's rows.
 *
 * Ranking is global: skills and commands are scored and sorted together, so
 * `/tkp` can put a command between two skills and a palette that captioned
 * every neighbouring run would draw «Навыки» twice over one group of rows.
 *
 * This module is the translation between the two: it buckets the ranked rows
 * by kind, keeps each bucket in ranked order, and puts the bucket whose best
 * row ranked highest first. The palette's first row is therefore still the
 * best match — which is the row Enter picks when the user types nothing else.
 *
 * A row keeps its `index` from the ranked list, so what the keyboard moves
 * through is the order the palette draws: the navigation hook publishes the
 * flattened groups rather than the raw ranking.
 *
 * Pure on purpose: the hook and the component both need the same grouping, and
 * the tests drive it with plain arrays.
 */

import type { QaSlashCatalogEntry } from "../../types.js";

/** One palette row: the entry, and where it sat in the ranked list. */
export interface QaSlashPaletteRow {
  readonly entry: QaSlashCatalogEntry;
  /** Position in the ranked list these groups were built from. */
  readonly index: number;
}

/** One titled group of the palette: exactly one per kind that was ranked. */
export interface QaSlashPaletteGroup {
  readonly kind: QaSlashCatalogEntry["kind"];
  readonly rows: readonly QaSlashPaletteRow[];
}

/**
 * Bucket ranked rows by kind, one group per kind.
 *
 * A kind with no row contributes no group, and the group order follows the
 * ranking (the best row's own kind leads) rather than a fixed
 * skill-then-command order, so the top of the list never disagrees with the
 * ranking above it.
 */
export function groupPaletteRows(
  rows: readonly QaSlashCatalogEntry[],
): readonly QaSlashPaletteGroup[] {
  const buckets = new Map<QaSlashCatalogEntry["kind"], QaSlashPaletteRow[]>();
  rows.forEach((entry, index) => {
    const row: QaSlashPaletteRow = Object.freeze({ entry, index });
    const bucket = buckets.get(entry.kind);
    if (bucket === undefined) {
      buckets.set(entry.kind, [row]);
      return;
    }
    bucket.push(row);
  });
  return Object.freeze(
    [...buckets.entries()].map(([kind, group]) =>
      Object.freeze({ kind, rows: Object.freeze([...group]) }),
    ),
  );
}

/** The entries of every group, in the order the palette draws them. */
export function flattenPaletteGroups(
  groups: readonly QaSlashPaletteGroup[],
): readonly QaSlashCatalogEntry[] {
  return Object.freeze(
    groups.flatMap((group) => group.rows.map((row) => row.entry)),
  );
}
