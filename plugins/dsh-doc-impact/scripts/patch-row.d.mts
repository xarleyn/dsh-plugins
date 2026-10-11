/**
 * The single row this bundle's patch declares. The keyed Plugins seat joins the
 * package `name` to the row `id`, and that id is the settings namespace the card's
 * form reads, so both halves come from the patch rather than from a copy of it.
 *
 * @param patchPath - the bundle's `cordis.patch.yml`, as a path or a file URL.
 * @throws when the patch declares no row, more than one row, or a row missing
 * either half of the pair.
 */
export function readPatchRow(
  patchPath: string | URL,
): Promise<{ readonly id: string; readonly name: string }>;
