import { describe, expect, it } from "vitest";
import { domainOf } from "./helpers/fakes.js";
import {
  CODE_WORKER,
  PAYMENTS,
  fixtureOf,
  resolve,
} from "./scope-resolution.helpers.js";

describe("scope resolution: tools", () => {
  it("always offers the plugin's own tools", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    const names = profile.tools.map((tool) => tool.name);
    expect(names).toContain("domain_expert");
    expect(names).toContain("domain_memory");
    expect(profile.toolFilter.allow).toContain("domain_expert");
    expect(profile.toolFilter.allow).toContain("domain_memory");
  });

  it("maps the design's domain_delegate alias onto the real tool", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["domain_delegate"], deny: [] },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition);
    expect(profile.toolFilter.allow).toContain("domain_expert");
    expect(profile.toolFilter.allow).not.toContain("domain_delegate");
    expect(
      profile.tools.find((tool) => tool.name === "domain_delegate")?.note,
    ).toContain("Alias");
  });

  it("flags an unverifiable tool name but keeps it in the filter", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["bash"], deny: [] },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition);
    expect(profile.toolFilter.allow).toContain("bash");
    expect(profile.degradations.map((item) => item.code)).toContain(
      "TOOL_UNVERIFIED",
    );
  });

  it("removes a denied tool from the filter and the visible list", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["bash", "code_worker"], deny: ["bash"] },
    });
    const fixture = fixtureOf([definition]);
    fixture.workers.register(CODE_WORKER);
    const profile = await resolve(fixture, definition);
    expect(profile.toolFilter.allow).not.toContain("bash");
    expect(profile.toolFilter.allow).toContain("code_worker");
    expect(profile.tools.map((tool) => tool.name)).not.toContain("bash");
  });

  it("reports a worker that has no tool binding as unavailable", async () => {
    const definition = domainOf("payments", {
      tools: { allow: ["jira_worker"], deny: [] },
    });
    const fixture = fixtureOf([definition]);
    fixture.workers.register({
      id: "jira_worker",
      title: "Jira worker",
      capabilities: ["search"],
      enforces: [],
      tool: "",
    });
    const profile = await resolve(fixture, definition);
    expect(
      profile.tools.find((tool) => tool.name === "jira_worker")?.available,
    ).toBe(false);
    expect(profile.degradations.map((item) => item.code)).toContain(
      "WORKER_UNAVAILABLE",
    );
  });
});
