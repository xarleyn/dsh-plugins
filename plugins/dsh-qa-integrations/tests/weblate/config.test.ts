import { resolveWeblateConfig } from "../../src/providers/weblate/config.js";
import { INSTANCE, TOKEN, provider, stub } from "./shared.js";

describe("weblate instance configuration", () => {
  it("canonicalizes the instances it is given", () => {
    const flags = resolveWeblateConfig({
      instances: [
        { id: "main", label: "", baseUrl: "https://Weblate.Example.COM/" },
        { id: "dev", label: "Dev", baseUrl: "http://dev.example.com:8080/" },
      ],
      allowInsecureHttp: true,
    });
    expect(flags.instances).toEqual([
      {
        id: "main",
        label: "weblate.example.com",
        baseUrl: "https://weblate.example.com",
      },
      { id: "dev", label: "Dev", baseUrl: "http://dev.example.com:8080" },
    ]);
  });

  it("fails loudly on an operator typo instead of dropping an instance", () => {
    for (const instances of [
      [{ id: "Main", baseUrl: INSTANCE }],
      [{ id: "main", baseUrl: "ftp://weblate.example.com" }],
      [{ id: "main", baseUrl: "/api" }],
      [{ id: "main", baseUrl: "https://user:pw@weblate.example.com" }],
      [{ id: "main", baseUrl: "https://weblate.example.com?x=1" }],
      [
        { id: "main", baseUrl: INSTANCE },
        { id: "main", baseUrl: INSTANCE },
      ],
    ]) {
      expect(() =>
        resolveWeblateConfig({ instances: instances as never }),
      ).toThrow(/weblate integration config/u);
    }
    // Plain HTTP is a development escape hatch, never the default.
    expect(() =>
      resolveWeblateConfig({
        instances: [
          {
            id: "main",
            label: "Weblate",
            baseUrl: "http://weblate.example.com",
          },
        ],
      }),
    ).toThrow(/allowInsecureHttp/u);
    expect(resolveWeblateConfig({ enabled: false }).enabled).toBe(false);
  });

  it("keeps the provider inert until an operator names an instance", () => {
    // An empty list is a state, not a crash: the connect form is what refuses.
    expect(resolveWeblateConfig().instances).toEqual([]);
    const inert = provider(stub(() => ({ json: {} })).fetcher, {
      instances: [],
    });
    expect(inert.capabilities.length).toBeGreaterThan(0);
    expect(() => inert.parseCredential(TOKEN)).toThrow(
      /No Weblate instance is configured/u,
    );
  });
});
