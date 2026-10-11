/**
 * This bundle's two seats, read out of the host artifact that owns them.
 *
 * `client-bundle.test.tsx` drives the components the registrations hand over and
 * `operator-card.test.tsx` proves the row entry answers both `view` shapes; neither
 * proves the Plugins page still asks for them. The checks themselves live in
 * `@yadsh/dsh-test-kit`, because the facts are the host's and every card migrated
 * onto these seats needs the same ones — one host change should read as one
 * diagnosis, not as one red file per plugin.
 *
 * What is this bundle's own is the pair of seats: the row entry answers `summary`
 * and `page`, the bundle entry answers `page` and nothing else, and only the row
 * body may carry no heading while the bundle body signs its own section.
 */

import {
  BUNDLE_CONFIG_SEAT,
  expectBundleSectionUntitled,
  expectBundleSeatContract,
  expectRowSeatContract,
  expectRowSeatKeyJoin,
  readHostSeats,
  seatCallSites,
} from "@yadsh/dsh-test-kit";
import { describe, expect, it } from "vitest";

const seats = readHostSeats(import.meta.url);

describe("the host's plugins.row.config seat", () => {
  it("offers the two views, a summary sentence and a form page, this entry answers", () => {
    expectRowSeatContract(seats);
  });

  it("keys the seat by the package name joined to the row id", () => {
    expectRowSeatKeyJoin(seats);
    // The key this bundle registers is that join over the row id its patch
    // declares; `scripts/verify-package.mjs` pins the literal in the artifact
    // against `src/shared/settings.ts` and `cordis.patch.yml`.
  });
});

describe("the host's plugins.bundle.config seat", () => {
  it("is declared page-only and rendered once, which is why the account card answers nothing else", () => {
    expectBundleSeatContract(seats);
    expect(seatCallSites(seats, BUNDLE_CONFIG_SEAT)).toHaveLength(1);
  });

  it("titles the bundle's own section with nothing, so the card's heading is the section's only one", () => {
    expectBundleSectionUntitled(seats);
  });
});
