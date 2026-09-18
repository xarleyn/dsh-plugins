import { describe, expect, it } from "vitest";
import {
  SLASH_MATCH_EXACT,
  SLASH_MATCH_PREFIX,
  SLASH_MATCH_SUBSEQUENCE,
  SLASH_MATCH_SUBSTRING,
  SLASH_MATCH_TOKEN,
  matchSlashName,
  rankSlashEntries,
} from "../src/slash/matcher.js";

const NAMES = [
  "generate-tkp",
  "generate-tz",
  "gap-analysis",
  "contract-analysis",
  "review-contract",
  "compact",
];

const rank = (query: string): string[] =>
  rankSlashEntries(
    NAMES.map((name) => ({ name })),
    query,
  ).map(({ name }) => name);

describe("slash matcher", () => {
  it("walks the ladder in the documented order", () => {
    expect(matchSlashName("plan", "plan", {})?.rank).toBe(SLASH_MATCH_EXACT);
    expect(matchSlashName("plan-mode", "plan", {})?.rank).toBe(
      SLASH_MATCH_PREFIX,
    );
    expect(matchSlashName("generate-tkp", "tkp", {})?.rank).toBe(
      SLASH_MATCH_TOKEN,
    );
    expect(matchSlashName("generate-tkp", "rate", {})?.rank).toBe(
      SLASH_MATCH_SUBSTRING,
    );
    expect(matchSlashName("generate-tkp", "gtk", {})?.rank).toBe(
      SLASH_MATCH_SUBSEQUENCE,
    );
    expect(matchSlashName("generate-tkp", "zzz", {})).toBeUndefined();
  });

  it("matches case-insensitively", () => {
    expect(matchSlashName("generate-tkp", "GEN", {})?.rank).toBe(
      SLASH_MATCH_PREFIX,
    );
    expect(matchSlashName("generate-tkp", "TK", {})?.rank).toBe(
      SLASH_MATCH_TOKEN,
    );
  });

  it("finds the abbreviation that the native startsWith would miss", () => {
    expect(rank("gen")).toEqual(["generate-tkp", "generate-tz"]);
    expect(rank("tkp")).toEqual(["generate-tkp"]);
    // `gap` is an ordered subsequence of `generate-tkp` too ("g…a…p"), so the
    // fuzzy rung surfaces it — behind the prefix match, which wins.
    expect(rank("gap")).toEqual(["gap-analysis", "generate-tkp"]);
  });

  it("orders equal-rank rows by the name, not by their length", () => {
    // `gen` is a prefix of both; the list must not lean on which name happens
    // to be shorter, or the same query would order differently per catalog.
    expect(
      rankSlashEntries(
        [{ name: "generate-tz" }, { name: "generate-tkp" }],
        "gen",
      ).map(({ name }) => name),
    ).toEqual(["generate-tkp", "generate-tz"]);
  });

  it("finds a name by any of its words, prefix first", () => {
    // Both spellings of "contract" are found and a prefix beats a later word,
    // which is the whole point of one shared ladder for skills and commands.
    expect(rank("contract")).toEqual(["contract-analysis", "review-contract"]);
  });

  it("drops the two weakest rungs when fuzzy search is off", () => {
    expect(
      rankSlashEntries(
        NAMES.map((name) => ({ name })),
        "rate",
        { fuzzy: false },
      ),
    ).toEqual([]);
    expect(
      rankSlashEntries(
        NAMES.map((name) => ({ name })),
        "gen",
        {
          fuzzy: false,
        },
      ).map(({ name }) => name),
    ).toEqual(["generate-tkp", "generate-tz"]);
  });

  it("matches everything on an empty query, in catalog order", () => {
    expect(rank("")).toEqual([...NAMES].sort());
  });

  it("preserves the entries it ranks", () => {
    const entry = { name: "generate-tkp", id: "skill:generate-tkp" };
    expect(rankSlashEntries([entry], "tkp")).toEqual([entry]);
  });
});
