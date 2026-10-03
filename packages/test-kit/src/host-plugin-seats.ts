/**
 * The Plugins page's seats, read out of the host artifact that owns them.
 *
 * A card seated on the Plugins panel answers the page's calls; nothing in the
 * plugin's own suite can prove the page still makes them. A test that hands the
 * entry a `view` nobody dispatches passes over a dead branch, and a page that
 * stopped handing a seat its props leaves the card resolving a namespace the seat
 * never mentions. The page lives in another repository, so the installed
 * `@deepseek-ai/dsh-client-ui-plugin-manager` bundle and its published contract
 * are the copy of that decision a plugin suite can reach — read here rather than
 * quoted in a comment, so a host that changes how it renders these seats fails on
 * the version bump instead of in a browser.
 *
 * Line numbers of that bundle are deliberately absent from both this module and
 * its callers: the artifact renumbers between release candidates, and a citation
 * would rot while the fact it describes holds. The checks are here rather than in
 * each plugin because one host change should produce one diagnosis, not one per
 * migrated card.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect } from "vitest";

/** The two host files that carry the seats' contract and their call sites. */
export interface HostSeatProbe {
  /** The page bundle: where the seats are rendered, and with which props. */
  readonly clientBundle: string;
  /** The published slot contract: how the seats are declared. */
  readonly slotContract: string;
}

/** The row seat of the Plugins page, keyed `<package name>#<row id>`. */
export const ROW_CONFIG_SEAT = "plugins.row.config";
/** The bundle-level seat of the Plugins page, keyed by the package name. */
export const BUNDLE_CONFIG_SEAT = "plugins.bundle.config";

/**
 * Read the host artifacts, resolving them through the caller's own dependencies.
 *
 * `fromUrl` is the calling test file's `import.meta.url`: the host package is a
 * devDependency of each plugin, so resolution has to start from the consumer, not
 * from this package.
 */
export function readHostSeats(fromUrl: string): HostSeatProbe {
  const hostRequire = createRequire(fromUrl);
  const root = dirname(
    hostRequire.resolve("@deepseek-ai/dsh-client-ui-plugin-manager/package.json"),
  );
  return {
    clientBundle: readFileSync(join(root, "lib/client.js"), "utf8"),
    slotContract: readFileSync(
      join(root, "lib/types/client/slot-contract.d.ts"),
      "utf8",
    ),
  };
}

/** Escape a literal for embedding in a `RegExp` built from a seat name. */
function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The props object of every `renderSlot("<seat>", …)` call site the page holds.
 *
 * The seat is matched as a whole quoted string, not as a prefix: `plugins.row`
 * would otherwise read as `plugins.row.config` and report call sites the page never
 * makes.
 */
export function seatCallSites(seats: HostSeatProbe, seat: string): string[] {
  const pattern = new RegExp(
    `renderSlot\\(\\s*["']${escapePattern(seat)}["']\\s*,\\s*(\\{[\\s\\S]{0,200}?\\})`,
    "gu",
  );
  return [...seats.clientBundle.matchAll(pattern)].map(
    ([, props]) => props ?? "",
  );
}

/** The contract's own docblock for one seat, up to its `kind:` line. */
export function seatDocblock(
  seats: HostSeatProbe,
  seat: string,
): string | undefined {
  return new RegExp(
    `/\\*\\*[\\s\\S]{0,600}?["']${escapePattern(seat)}["']:\\s*\\{[^}]*kind:`,
    "u",
  ).exec(seats.slotContract)?.[0];
}

/**
 * The row seat, as the page renders it: what this bundle's row entry may answer.
 *
 * Four facts, each of which the card's shape depends on:
 *
 * - the contract admits exactly two views, so a `summary` branch answers a call the
 *   page can make and no third value exists to guess at;
 * - the row's missing description is promised to that `summary` view, in the
 *   contract's own prose — the licence for answering it with a sentence;
 * - the seat is rendered twice, a summary sentence and a form page, and only the
 *   page is handed a `form`, which is why a row card resolves its own `ConfigForm`
 *   and passes it through the injected face under a name the owner prop cannot
 *   shadow;
 * - the summary is a *fallback*: the page writes `description ?? renderSlot(…)`
 *   into its own paragraph, so a bundle whose manifest declares a description is
 *   read from the manifest, and a host that dropped the guard would overwrite every
 *   row's sentence with the registrant's.
 */
export function expectRowSeatContract(seats: HostSeatProbe): void {
  expect(seats.slotContract).toMatch(/readonly view:\s*'summary' \| 'page';/u);

  const rowSeat = seatDocblock(seats, ROW_CONFIG_SEAT);
  expect(rowSeat).toBeDefined();
  expect(rowSeat).toContain("falls back to the entry's `view: 'summary'`");

  const sites = seatCallSites(seats, ROW_CONFIG_SEAT);
  expect(sites).toHaveLength(2);
  const summary = sites.filter((site) =>
    /view:\s*["']summary["']/u.test(site),
  );
  const page = sites.filter((site) => /view:\s*["']page["']/u.test(site));
  expect(summary).toHaveLength(1);
  expect(page).toHaveLength(1);
  expect(summary[0]).not.toMatch(/\bform\b/u);
  expect(page[0]).toMatch(/\bform\b/u);

  expect(seats.clientBundle).toMatch(
    /description\s*\?\?\s*renderSlot\(\s*["']plugins\.row\.config["']\s*,\s*\{\s*view:\s*["']summary["']/u,
  );
  expect(seats.clientBundle).toMatch(
    /children:\s*\[\s*renderSlot\(\s*["']plugins\.row\.config["']\s*,\s*\{\s*view:\s*["']page["']/u,
  );
}

/**
 * The join the row seat's key is built from: package name, `#`, row id.
 *
 * A different join parks a card under a key the page never asks about, and the
 * settings namespace the row id carries — the one a live stand already wrote values
 * under — is lost with it.
 */
export function expectRowSeatKeyJoin(seats: HostSeatProbe): void {
  expect(seats.clientBundle).toMatch(
    /function rowConfigKey\(([^)]*)\)\s*\{\s*return\s*`\$\{[^}]+\}#\$\{[^}]+\}`/u,
  );
}

/**
 * The bundle seat, as the page renders it: one section, one view, no form.
 *
 * The contract gives this seat `view: 'page'` only, so a registrant that answered
 * `summary` would answer a call the page never makes; and the page passes no `form`,
 * which is the trap `docs/DSH-0.1.7-MIGRATION.md` §4.2 names — the registrant either
 * needs none or resolves its own.
 */
export function expectBundleSeatContract(seats: HostSeatProbe): void {
  const bundleSeat = seatDocblock(seats, BUNDLE_CONFIG_SEAT);
  expect(bundleSeat).toBeDefined();
  expect(bundleSeat).toContain("(`view: 'page'` only)");

  const sites = seatCallSites(seats, BUNDLE_CONFIG_SEAT);
  expect(sites).toHaveLength(1);
  expect(sites[0]).toMatch(/view:\s*["']page["']/u);
  expect(sites[0]).not.toMatch(/\bform\b/u);
  expect(seats.clientBundle).toMatch(
    /renderSlot\(\s*["']plugins\.bundle\.config["']\s*,\s*\{\s*view:\s*["']page["']\s*\}\s*,\s*\{\s*entryKey:\s*\w+\.name\s*\}/u,
  );
}

/**
 * The heading the bundle section does *not* get.
 *
 * A card that titles its own body has to know whether the page titles the section it
 * mounts it in: on the row seat the page draws the title, and a heading of ours there
 * would be the second frame the shell decision removed. This reads both halves — the
 * section that holds the bundle seat carries no heading element at all, while the rows
 * section beside it signs itself with the page's `sectionTitle`. So a body seated on
 * `plugins.bundle.config` may name its own section, and takes the level the sibling
 * uses; a host that ever starts titling that section makes the card's heading wrong by
 * one, here rather than on a screen.
 */
export function expectBundleSectionUntitled(seats: HostSeatProbe): void {
  const site = seats.clientBundle.search(
    /renderSlot\(\s*["']plugins\.bundle\.config["']/u,
  );
  expect(site).toBeGreaterThan(-1);
  const section = seats.clientBundle.slice(site - 320, site);
  expect(section).toContain('"data-plugin-config"');
  expect(section).not.toMatch(/\)\s*"h[1-6]"/u);
  // The sibling section does title itself, and that is the level to match.
  expect(seats.clientBundle).toMatch(
    /"data-plugin-rows"[\s\S]{0,400}\("h4",\s*\{\s*className:\s*\w+\.sectionTitle/u,
  );
}
