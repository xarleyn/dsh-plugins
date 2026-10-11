/**
 * This plugin's seat on the Plugins page, read out of the host artifact that owns it.
 *
 * `client-card.test.tsx` proves this plugin answers the two shapes the page is called
 * with; it cannot prove the page still calls them. The checks live in
 * `@yadsh/dsh-test-kit` — they are facts about the host, and every card migrated onto
 * `plugins.row.config` needs the same ones, so one host change reads as one diagnosis
 * instead of one red file per plugin.
 */

import {
  expectRowSeatContract,
  expectRowSeatKeyJoin,
  readHostSeats,
} from "@yadsh/dsh-test-kit";
import { describe, it } from "vitest";

const seats = readHostSeats(import.meta.url);

describe("the host's plugins.row.config seat", () => {
  it("offers the two views, a summary sentence and a form page, this card answers", () => {
    expectRowSeatContract(seats);
  });

  it("is keyed by the package name joined to the row id", () => {
    expectRowSeatKeyJoin(seats);
  });
});
