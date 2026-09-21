import { describe, expect, it } from "vitest";
import {
  flattenPaletteGroups,
  groupPaletteRows,
} from "../src/client/slash/palette-rows.js";
import { slashEntry } from "./helpers/slash.js";

/**
 * The palette's grouping, driven with plain arrays: the ranking it is handed
 * is global, so the rows of one kind can arrive with the other kind between
 * them, and the palette must still caption each kind once.
 */
describe("palette row grouping", () => {
  const SKILL_A = slashEntry("skill", "a-one");
  const COMMAND = slashEntry("command", "b-two");
  const SKILL_C = slashEntry("skill", "c-three");

  it("keeps one group per kind when the ranking interleaves them", () => {
    const groups = groupPaletteRows([SKILL_A, COMMAND, SKILL_C]);
    expect(groups.map((group) => group.kind)).toEqual(["skill", "command"]);
    expect(groups[0]?.rows.map((row) => row.entry.name)).toEqual([
      "a-one",
      "c-three",
    ]);
    expect(groups[1]?.rows.map((row) => row.entry.name)).toEqual(["b-two"]);
  });

  it("leads with the kind of the best-ranked row", () => {
    const groups = groupPaletteRows([COMMAND, SKILL_A, SKILL_C]);
    expect(groups.map((group) => group.kind)).toEqual(["command", "skill"]);
  });

  it("keeps every row's index into the ranked list it came from", () => {
    const groups = groupPaletteRows([SKILL_A, COMMAND, SKILL_C]);
    expect(
      groups.flatMap((group) => group.rows.map((row) => row.index)),
    ).toEqual([0, 2, 1]);
  });

  it("flattens to the order the palette draws", () => {
    const rows = [SKILL_A, COMMAND, SKILL_C];
    const drawn = flattenPaletteGroups(groupPaletteRows(rows));
    expect(drawn.map((entry) => entry.name)).toEqual([
      "a-one",
      "c-three",
      "b-two",
    ]);
    // The same entries, not copies of them: the caller renders what it ranked.
    expect(drawn[0]).toBe(SKILL_A);
  });

  it("groups a list that is already grouped without moving it", () => {
    const rows = [SKILL_A, SKILL_C, COMMAND];
    expect(flattenPaletteGroups(groupPaletteRows(rows))).toEqual(rows);
  });

  it("has no groups for an empty ranking", () => {
    expect(groupPaletteRows([])).toEqual([]);
  });
});
