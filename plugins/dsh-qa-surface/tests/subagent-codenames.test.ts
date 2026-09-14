import { describe, expect, it } from "vitest";
import { codenameFor } from "../src/client/subagent-codenames.js";

describe("subagent codenames", () => {
  it("stays stable for the same session id", () => {
    const id = "b5b84a41-5597-4ddb-8cb6-9a2fa90517ad";
    expect(codenameFor(id)).toBe(codenameFor(id));
    expect(codenameFor(id.toUpperCase())).toBe(codenameFor(id));
    expect(codenameFor(` ${id} `)).toBe(codenameFor(id));
  });

  it("is an adjective-noun pair drawn from the vocabulary", () => {
    const name = codenameFor("eaa454a4-0000-4ddb-8cb6-9a2fa90517ad");
    const [adjective, noun] = name.split(" ");
    expect(adjective).toBeTruthy();
    expect(noun).toBeTruthy();
    expect(name).toMatch(/^[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+$/u);
  });

  it("spreads distinct ids across more than one adjective and noun", () => {
    const adjectives = new Set<string>();
    const nouns = new Set<string>();
    for (let index = 0; index < 64; index += 1) {
      const [adjective, noun] = codenameFor(
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ).split(" ");
      if (adjective === undefined || noun === undefined)
        throw new Error(`malformed codename for index ${index}`);
      adjectives.add(adjective);
      nouns.add(noun);
    }
    expect(adjectives.size).toBeGreaterThan(4);
    expect(nouns.size).toBeGreaterThan(4);
  });
});
