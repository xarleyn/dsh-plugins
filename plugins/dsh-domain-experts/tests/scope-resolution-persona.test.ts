import { describe, expect, it } from "vitest";
import { resolveExpert } from "../src/host/resolver.js";
import { PAYMENTS, fixtureOf, resolve } from "./scope-resolution.helpers.js";

describe("scope resolution: persona wiring", () => {
  it("composes a persona that names the caller domain and the depth", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS, "inventory", 2);
    expect(profile.persona).toContain('asked by the "inventory" expert');
    expect(profile.persona).toContain("Delegation depth: 2 of at most 3");
    expect(profile.basePolicy.startsWith("You are the designated expert")).toBe(
      true,
    );
  });

  it("recalls memory into the persona for a real task", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const provider = fixture.memoryProviders.require("builtin");
    await provider.remember(
      "domain/payments",
      "cutoff",
      "The settlement cutoff is 14:00.",
    );
    const profile = await resolveExpert(
      fixture.dependencies,
      {
        definition: PAYMENTS,
        workspaceDir: "",
        callerDomain: null,
        depth: 1,
      },
      {
        task: "When does settlement close?",
        context: "",
        output: "",
        mode: "answer",
        background: false,
      },
    );
    expect(profile.persona).toContain("The settlement cutoff is 14:00.");
  });

  it("does not recall memory for the preview profile", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const provider = fixture.memoryProviders.require("builtin");
    await provider.remember(
      "domain/payments",
      "cutoff",
      "The settlement cutoff is 14:00.",
    );
    const profile = await resolve(fixture, PAYMENTS);
    expect(profile.persona).not.toContain("The settlement cutoff is 14:00.");
    expect(profile.persona).toContain("preview");
  });
});
