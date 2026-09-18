import { IntegrationError } from "../../src/errors.js";
import {
  UNIT_STATE_FILTERS,
  buildUnitQuery,
  quoteQueryValue,
  stateClause,
  textClause,
} from "../../src/providers/weblate/query.js";
import { TOKEN, credentialFor, provider, stub } from "./shared.js";

describe("weblate search grammar", () => {
  it("quotes every value and refuses what quotes cannot carry", () => {
    expect(quoteQueryValue("Reset password")).toBe('"Reset password"');
    expect(quoteQueryValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteQueryValue("back\\slash")).toBe('"back\\\\slash"');
    expect(quoteQueryValue("it's fine")).toBe('"it\'s fine"');
    for (const bad of ["", "line\nbreak", "tab\there", "\u0000"]) {
      expect(() => quoteQueryValue(bad)).toThrow(IntegrationError);
    }
  });

  it("uses Weblate's own state vocabulary and nothing else", () => {
    expect(stateClause("needs-editing")).toBe("is:needs-editing");
    expect([...UNIT_STATE_FILTERS]).toEqual([
      "untranslated",
      "needs-editing",
      "translated",
      "approved",
      "read-only",
    ]);
    expect(() => stateClause("weird" as never)).toThrow(IntegrationError);
    expect(textClause("target", "Kennwort")).toBe('target:"Kennwort"');
    expect(buildUnitQuery(["a", "", "b"])).toBe("a AND b");
    // A clause asked for twice is asked for once.
    expect(buildUnitQuery(["a", "a", "has:check", "has:check"])).toBe(
      "a AND has:check",
    );
    expect(buildUnitQuery([])).toBe("");
  });

  it("refuses a filter, a page or an operation it does not have", async () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const p = provider(fetcher);
    const credential = credentialFor(TOKEN, {}, fetcher);
    await expect(
      p.execute({ credential }, "units.find", { state: "abandoned" }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      p.execute({ credential }, "units.find", { page: 0 }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      p.execute({ credential }, "units.get", { unitId: -1 }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      p.execute({ credential }, "rest.call", {}),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });
});
