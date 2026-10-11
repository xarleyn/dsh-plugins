// One authoritative read of this bundle's `cordis.patch.yml`, shared by both gates
// that key the Plugins row seat from it.
//
// Parsing the document, rather than matching it, is what keeps the join honest. The
// seat is keyed `<package name>#<row id>`, and the row id is the namespace the
// card's form reads, so a patch that grew a second row would move the seat key away
// from the settings it points at — while a pattern anchored on the first `id:` in
// the file would keep handing out the row it happened to meet first and let the
// gate verify a pair the Host's roster never inventories. A bundle patch here
// declares exactly one row, so that is what this requires, and a second row stops
// the check instead of shifting it.
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

/** The single row a bundle patch declares, as the Host's roster keys it. */
export async function readPatchRow(patchPath) {
  const document = parse(await readFile(patchPath, "utf8"));
  const rows = (Array.isArray(document) ? document : []).flatMap((block) =>
    Array.isArray(block?.insert) ? block.insert : [],
  );
  if (rows.length !== 1) {
    throw new Error(
      `cordis.patch.yml must declare exactly one plugin row to key the seat from, found ${rows.length}`,
    );
  }
  const { id, name } = rows[0];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error('cordis.patch.yml declares a row with no "id"');
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new Error('cordis.patch.yml declares a row with no "name"');
  }
  return { id, name };
}
