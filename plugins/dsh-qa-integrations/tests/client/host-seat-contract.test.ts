/**
 * The two seats this bundle registers, read out of the host artifact that owns them.
 *
 * `client-bundle.test.tsx` drives the components the registrations hand over and
 * `operator-card.test.tsx` proves the row entry answers both `view` shapes. Neither
 * proves the Plugins page still asks for them: a test that hands the entry a `view`
 * nobody dispatches passes over a dead branch, and a page that stopped passing `form`
 * would leave this card resolving a namespace the seat never mentions. The page lives
 * in another repository, so the installed
 * `@deepseek-ai/dsh-client-ui-plugin-manager` bundle and its published contract are
 * the copy of that decision this suite can reach — read here rather than quoted in a
 * comment, so a host that changes how it renders these seats fails on the version bump
 * instead of in a browser.
 *
 * Line numbers of that bundle are deliberately absent: the artifact renumbers between
 * release candidates and a citation would rot while the fact it describes holds.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const hostRequire = createRequire(import.meta.url);

/** Root of the host package whose page renders this bundle's two seats. */
const HOST_ROOT = dirname(
  hostRequire.resolve("@deepseek-ai/dsh-client-ui-plugin-manager/package.json"),
);

const CLIENT_BUNDLE = readFileSync(join(HOST_ROOT, "lib/client.js"), "utf8");

const SLOT_CONTRACT = readFileSync(
  join(HOST_ROOT, "lib/types/client/slot-contract.d.ts"),
  "utf8",
);

/**
 * The props object of every `renderSlot("<seat>", …)` call site the page holds.
 *
 * The seat is matched as a whole quoted string, not as a prefix: `plugins.row` would
 * otherwise read as `plugins.row.config` and report call sites the page never makes.
 */
function seatCallSites(seat: string): string[] {
  const escaped = seat.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `renderSlot\\(\\s*["']${escaped}["']\\s*,\\s*(\\{[\\s\\S]{0,200}?\\})`,
    "gu",
  );
  return [...CLIENT_BUNDLE.matchAll(pattern)].map(([, props]) => props ?? "");
}

/** The contract's own docblock for one seat, up to its `kind:` line. */
function seatDocblock(seat: string): string | undefined {
  const escaped = seat.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `/\\*\\*[\\s\\S]{0,600}?['"]${escaped}['"]:\\s*\\{[^}]*kind:`,
    "u",
  ).exec(SLOT_CONTRACT)?.[0];
}

describe("the host's plugins.row.config seat", () => {
  it("is declared with exactly the two views this bundle answers", () => {
    // The contract's vocabulary, not the card's: `view` carries no third value a
    // registrant would have to guess at, and no fewer than the two it handles.
    expect(SLOT_CONTRACT).toMatch(/readonly view:\s*'summary' \| 'page';/u);
  });

  it("promises the row's missing description to the entry's summary view", () => {
    // This prose is the licence for the `view === "summary"` branch.
    const rowSeat = seatDocblock("plugins.row.config");
    expect(rowSeat).toBeDefined();
    expect(rowSeat).toContain("falls back to the entry's `view: 'summary'`");
  });

  it("renders the row seat twice: a summary sentence and a form page", () => {
    const sites = seatCallSites("plugins.row.config");
    expect(sites).toHaveLength(2);
    const summary = sites.filter((site) =>
      /view:\s*["']summary["']/u.test(site),
    );
    const page = sites.filter((site) => /view:\s*["']page["']/u.test(site));
    expect(summary).toHaveLength(1);
    expect(page).toHaveLength(1);
    // Only the page view is handed a form, which is why the operator card resolves
    // its own `ConfigForm` and takes it through the injected face under a name the
    // owner prop cannot shadow.
    expect(summary[0]).not.toMatch(/\bform\b/u);
    expect(page[0]).toMatch(/\bform\b/u);
  });

  it("asks the row entry for a summary only when the row declares no description", () => {
    /*
     * What makes the branch a fallback rather than the row's normal line: the page
     * writes `description ?? renderSlot(…)` into its own `<p>`. A host that dropped
     * the guard would overwrite every row's manifest sentence with the registrant's;
     * one that dropped the unconditional `page` call would leave this card's form
     * with no seat at all.
     */
    expect(CLIENT_BUNDLE).toMatch(
      /description\s*\?\?\s*renderSlot\(\s*["']plugins\.row\.config["']\s*,\s*\{\s*view:\s*["']summary["']/u,
    );
    expect(CLIENT_BUNDLE).toMatch(
      /children:\s*\[\s*renderSlot\(\s*["']plugins\.row\.config["']\s*,\s*\{\s*view:\s*["']page["']/u,
    );
  });

  it("keys the seat by the package name joined to the row id", () => {
    // The join `ROW_CONFIG_KEY` is built from. A different join parks the card under
    // a key the page never asks about, and the settings namespace the row id carries
    // — the one a live stand already wrote values under — is lost with it.
    expect(CLIENT_BUNDLE).toMatch(
      /function rowConfigKey\(([^)]*)\)\s*\{\s*return\s*`\$\{[^}]+\}#\$\{[^}]+\}`/u,
    );
  });
});

describe("the host's plugins.bundle.config seat", () => {
  it("is declared as page-only, which is why the account card has no summary branch", () => {
    const bundleSeat = seatDocblock("plugins.bundle.config");
    expect(bundleSeat).toBeDefined();
    expect(bundleSeat).toContain("(`view: 'page'` only)");
  });

  it("is rendered once, with no form, under the package name", () => {
    const sites = seatCallSites("plugins.bundle.config");
    // One call site, and it is the page view: the row seat's summary fallback has no
    // counterpart here, so an account card that answered `summary` would answer a
    // call the page never makes.
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatch(/view:\s*["']page["']/u);
    // The bundle page passes this seat no `form` at all, which is the trap §4.2 names
    // — the registrant must resolve its own `ConfigForm` or need none, as the account
    // card does.
    expect(sites[0]).not.toMatch(/\bform\b/u);
    expect(CLIENT_BUNDLE).toMatch(
      /renderSlot\(\s*["']plugins\.bundle\.config["']\s*,\s*\{\s*view:\s*["']page["']\s*\}\s*,\s*\{\s*entryKey:\s*\w+\.name\s*\}/u,
    );
  });
});
