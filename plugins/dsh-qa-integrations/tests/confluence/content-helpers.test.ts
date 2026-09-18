import { buildCql, cqlLiteral } from "../../src/providers/confluence/cql.js";
import { plainExcerpt } from "../../src/providers/confluence/operations.js";

describe("confluence content helpers", () => {
  it("quotes CQL literals so a value cannot end a query", () => {
    expect(cqlLiteral("plain")).toBe('"plain"');
    expect(cqlLiteral('say "hi"')).toBe('"say \\"hi\\""');
    expect(cqlLiteral("back\\slash")).toBe('"back\\\\slash"');
    expect(cqlLiteral("trailing\\")).toBe('"trailing\\\\"');
    expect(cqlLiteral("two\nlines")).toBe('"two lines"');
  });

  it("builds one query out of typed filters, in a fixed order", () => {
    expect(buildCql({})).toBe("type in (page)");
    expect(
      buildCql({
        contentTypes: ["blogpost"],
        spaces: ["ENG"],
        labels: ["runbook"],
        query: "deploy",
        modifiedAfter: "2026-09-01",
        creator: "me",
        contributor: "acc-bob",
        orderBy: "created",
      }),
    ).toBe(
      'type in (blogpost) AND space in ("ENG") AND label in ("runbook") AND text ~ "deploy" AND lastmodified >= "2026-09-01" AND creator = currentUser() AND contributor = "acc-bob" ORDER BY created DESC',
    );
  });

  it("strips highlight markup from an excerpt", () => {
    expect(
      plainExcerpt('<span class="search-highlight">deploy</span> &amp; more'),
    ).toBe("deploy & more");
  });
});
