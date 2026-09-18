import {
  buildBuildLocator,
  locatorValue,
  teamCityDate,
} from "../../src/providers/teamcity/locators.js";

describe("teamcity locators", () => {
  it("keeps plain values plain and encodes the ones that would break the parser", () => {
    expect(locatorValue("MyProject_Build")).toBe("MyProject_Build");
    expect(locatorValue("feature/PROJ-123")).toBe("feature/PROJ-123");
    // TeamCity's locator has no escape character, so a value with a comma, a
    // colon or a parenthesis goes through the documented `$base64:` form.
    const encoded = locatorValue("release,2026: (hotfix)");
    expect(encoded).toMatch(/^\(\$base64:[A-Za-z0-9_-]+\)$/u);
    expect(Buffer.from(encoded.slice(9, -1), "base64url").toString()).toBe(
      "release,2026: (hotfix)",
    );
    expect(locatorValue("back\\slash")).toContain("$base64:");
  });

  it("builds build locators without ever accepting one from the model", () => {
    expect(
      buildBuildLocator({
        buildTypeId: "MyProject_Build",
        branch: "feature/PROJ-123",
        status: "FAILURE",
        state: "finished",
        since: "20260901T000000+0000",
        count: 50,
      }),
    ).toBe(
      "buildType:(id:MyProject_Build),branch:(name:feature/PROJ-123),status:FAILURE,state:finished,sinceDate:20260901T000000+0000,count:50",
    );
    // TeamCity hides personal builds behind its default filter, so asking for
    // them has to drop that filter or the answer would be empty.
    expect(buildBuildLocator({ personal: true })).toBe(
      "personal:true,defaultFilter:false",
    );
    expect(buildBuildLocator({})).toBe("");
  });

  it("formats dates in TeamCity's own shape, in UTC", () => {
    expect(teamCityDate("2026-09-01")).toBe("20260901T000000+0000");
    expect(teamCityDate("2026-09-01T12:34:56Z")).toBe("20260901T123456+0000");
    expect(teamCityDate("2026-09-01T15:34:56+03:00")).toBe(
      "20260901T123456+0000",
    );
    expect(teamCityDate("yesterday")).toBeUndefined();
  });
});
