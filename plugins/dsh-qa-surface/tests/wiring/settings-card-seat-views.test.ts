/**
 * The two views the installed Plugins page actually asks this seat for.
 *
 * Whether the entry has to answer `view: 'summary'` at all was argued from
 * prose in both directions — the migration record read the row seat as a page
 * only, the card's own comment read it as a one-liner — and neither prose is a
 * check. The host build this bundle compiles against is: `RowDetail` calls
 * `renderSlot("plugins.row.config", …)` twice for the same entry, once as the
 * row's description and once as the configuration under its heading. So the
 * calls are measured here, in the build the operator runs, rather than quoted
 * from a document that can drift from it.
 *
 * Which of the two the page reaches for is the page's question, not this
 * bundle's: `PackageRow.meta` is supplied by the Host's inventory, so no file a
 * package owns decides whether an installation shows the row a description. What
 * a package does own is the answer for both views, and that half is rendered in
 * `qa-settings-card-seat.test.tsx`.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireFrom = createRequire(import.meta.url);

/** The browser build of the page this card registers into. */
const managerClient = readFileSync(
  requireFrom.resolve("@deepseek-ai/dsh-client-ui-plugin-manager/client"),
  "utf8",
);

/** One `renderSlot("plugins.row.config", { … })` call, matched loosely. */
const rowSeatCall = (view: string): RegExp =>
  new RegExp(
    `renderSlot\\(\\s*["']plugins\\.row\\.config["']\\s*,\\s*\\{[^}]*?` +
      `["']?view["']?\\s*:\\s*["']${view}["'][^}]*?\\}`,
    "u",
  );

describe("QA Surface row seat views", () => {
  it("seats the entry as the row's description where the Host supplies none", () => {
    // `description ?? renderSlot(...)` — the seat is the fallback for the
    // description text, not a second rendering of the form.
    expect(managerClient).toMatch(
      new RegExp(
        `description\\s*\\?\\?\\s*${rowSeatCall("summary").source}`,
        "u",
      ),
    );
  });

  it("seats the same entry as the page, with the host's form beside the view", () => {
    // The page view is the one that carries `form`, and that prop is the page's
    // own `ConfigPageForm` — a snapshot and a bulk `mutate` — rather than the
    // `ConfigForm` this card writes through.
    const page = rowSeatCall("page").exec(managerClient)?.[0] ?? "";
    expect(page).toMatch(/[{,]\s*form\s*[,}]/u);
  });
});
