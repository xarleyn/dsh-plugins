import { describe, expect, it } from "vitest";

import { PageIdentities } from "../src/host/providers/page-identities.js";

describe("PageIdentities", () => {
  it("gives one page one identity, whoever asks first", () => {
    const identities = new PageIdentities();
    const page = { name: "a page" };

    // The route handler asks before the page handle exists — that is the whole
    // point of minting on demand. The handle's later question has to get the
    // same answer, or the refusal a brand-new page caused would be filed
    // against no tab at all.
    const minted = identities.idOf(page);

    expect(identities.idOf(page)).toBe(minted);
  });

  it("keeps two pages apart and holds the answer for each", () => {
    const identities = new PageIdentities();
    const first = { name: "first" };
    const second = { name: "second" };

    expect(identities.idOf(first)).not.toBe(identities.idOf(second));
    expect(identities.idOf(second)).toBe(identities.idOf(second));
  });

  it("names every page it mints, and never repeats a name", () => {
    const identities = new PageIdentities();
    const pages = Array.from({ length: 32 }, (_, index) => ({ index }));
    const ids = pages.map((page) => identities.idOf(page));

    expect(new Set(ids).size).toBe(pages.length);
    expect(ids.every((id) => /^page_[0-9a-f]{32}$/u.test(id))).toBe(true);
  });
});
