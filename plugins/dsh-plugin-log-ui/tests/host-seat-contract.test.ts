/**
 * The seat, read from the host artifact that owns it.
 *
 * `client-card.test.tsx` proves this plugin answers the two shapes the Plugins page
 * is called with; it cannot prove the page still calls them — a test that hands the
 * entry a `view` nobody asks for passes over a dead branch. The page's half lives in
 * another repository, so the shipped `@deepseek-ai/dsh-client-ui-plugin-manager`
 * bundle and its published contract are the copy of that decision this suite can
 * reach. Both are read here rather than quoted in a comment: when the host changes
 * how it renders `plugins.row.config`, this fails on the version bump, which is the
 * moment the card's `summary` answer would otherwise silently stop being called.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const hostRequire = createRequire(import.meta.url);

/** Root of the host package whose page renders this plugin's seat. */
const HOST_ROOT = dirname(
  hostRequire.resolve("@deepseek-ai/dsh-client-ui-plugin-manager/package.json"),
);

const CLIENT_BUNDLE = readFileSync(join(HOST_ROOT, "lib/client.js"), "utf8");

const SLOT_CONTRACT = readFileSync(
  join(HOST_ROOT, "lib/types/client/slot-contract.d.ts"),
  "utf8",
);

/** Every `renderSlot('plugins.row.config', <props>)` call site in the page bundle. */
function rowSeatCallSites(source: string): string[] {
  const sites: string[] = [];
  for (const match of source.matchAll(
    /renderSlot\(\s*["']plugins\.row\.config["']\s*,\s*(\{[\s\S]{0,200}?\})/g,
  )) {
    const props = match[1];
    if (props !== undefined) sites.push(props);
  }
  return sites;
}

describe("the host's plugins.row.config seat", () => {
  it("is declared with exactly the two views this card answers", () => {
    // The contract's own vocabulary, not the card's: `view` carries no third value
    // a registrant would have to guess at, and no fewer than the two it handles.
    expect(SLOT_CONTRACT).toMatch(/readonly view:\s*'summary' \| 'page';/u);
  });

  it("promises the row's missing description to the entry's summary view", () => {
    // The prose is the license for the `view === 'summary'` branch: a row seat is
    // asked for the row's one-liner when the row declares none.
    const rowSeat = SLOT_CONTRACT.match(
      /\/\*\*[\s\S]{0,600}?'plugins\.row\.config':\s*\{[^}]*kind:\s*'keyed'/u,
    )?.[0];
    expect(rowSeat).toBeDefined();
    expect(rowSeat).toContain("falls back to the entry's `view: 'summary'`");
  });

  it("is rendered twice by the page: a summary sentence and a form page", () => {
    const sites = rowSeatCallSites(CLIENT_BUNDLE);
    expect(sites).toHaveLength(2);

    const summary = sites.filter((site) =>
      /view:\s*["']summary["']/u.test(site),
    );
    const page = sites.filter((site) => /view:\s*["']page["']/u.test(site));
    expect(summary).toHaveLength(1);
    expect(page).toHaveLength(1);

    // Only the page view is handed the form, which is why the card resolves its own
    // `ConfigForm` rather than reading `props.form`: the summary call would receive
    // `undefined` there, and `ConfigPageForm` has no subscription or `set` anyway.
    expect(summary[0]).not.toMatch(/\bform\b/u);
    expect(page[0]).toMatch(/\bform\b/u);
  });

  it("asks the entry for a summary only when the row declares no description", () => {
    /*
     * This is what makes the `summary` branch a fallback rather than the row's
     * normal line: the page writes `description ?? renderSlot(…)` into the `<p>`, so
     * a bundle whose manifest declares a `description` is read from the manifest and
     * the seat is never asked. Pinned against the artifact because a host that
     * dropped the guard would silently replace every row's manifest sentence with the
     * registrant's, and one that dropped the unconditional `page` call would leave
     * this card's form with no seat at all.
     */
    expect(CLIENT_BUNDLE).toMatch(
      /description\s*\?\?\s*renderSlot\(\s*["']plugins\.row\.config["']\s*,\s*\{\s*view:\s*["']summary["']/u,
    );
    expect(CLIENT_BUNDLE).toMatch(
      /children:\s*\[\s*renderSlot\(\s*["']plugins\.row\.config["']\s*,\s*\{\s*view:\s*["']page["']/u,
    );
  });

  it("is keyed by the package name joined to the row id", () => {
    // The join this card's registration key is built from; a different join would
    // park the card under a key the page never asks about, and the settings
    // namespace the row id carries would be lost with it.
    expect(CLIENT_BUNDLE).toMatch(
      /function rowConfigKey\(([^)]*)\)\s*\{\s*return\s*`\$\{[^}]+\}#\$\{[^}]+\}`/u,
    );
  });
});
