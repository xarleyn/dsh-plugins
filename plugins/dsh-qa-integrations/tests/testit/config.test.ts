import {
  resolveTestitConfig,
  testitInstance,
} from "../../src/providers/testit/config.js";

describe("testit instance list", () => {
  it("canonicalizes what the operator configured", () => {
    const flags = resolveTestitConfig({
      instances: [
        {
          id: "cloud",
          label: "",
          baseUrl: "https://Team.Example.TESTIT/root/",
        },
      ],
    });
    expect(flags.instances).toEqual([
      {
        id: "cloud",
        label: "team.example.testit",
        baseUrl: "https://team.example.testit/root",
      },
    ]);
  });

  it("fails loudly on an operator typo instead of dropping an instance", () => {
    expect(() =>
      resolveTestitConfig({
        instances: [{ id: "Cloud", label: "Cloud", baseUrl: "https://x" }],
      }),
    ).toThrow(/instances\[0\]\.id/u);
    expect(() =>
      resolveTestitConfig({
        instances: [
          { id: "a", label: "A", baseUrl: "https://x" },
          { id: "a", label: "A again", baseUrl: "https://y" },
        ],
      }),
    ).toThrow(/duplicate/u);
    expect(() =>
      resolveTestitConfig({
        instances: [{ id: "a", label: "A", baseUrl: "team.example" }],
      }),
    ).toThrow(/absolute URL/u);
    expect(() =>
      resolveTestitConfig({
        instances: [
          { id: "a", label: "A", baseUrl: "https://user:pw@team.example" },
        ],
      }),
    ).toThrow(/credentials/u);
    expect(() =>
      resolveTestitConfig({
        instances: [
          { id: "a", label: "A", baseUrl: "https://team.example?x=1" },
        ],
      }),
    ).toThrow(/no credentials or query/u);
  });

  it("refuses plain HTTP unless the deployment is a development one", () => {
    expect(() =>
      resolveTestitConfig({
        instances: [
          { id: "lab", label: "Lab", baseUrl: "http://tms.corp.example" },
        ],
      }),
    ).toThrow(/needs HTTPS/u);
    expect(
      resolveTestitConfig({
        allowInsecureHttp: true,
        instances: [
          { id: "lab", label: "Lab", baseUrl: "http://tms.corp.example" },
        ],
      }).instances[0]?.baseUrl,
    ).toBe("http://tms.corp.example");
  });

  it("keeps the budgets consistent", () => {
    expect(() =>
      resolveTestitConfig({ defaultResults: 200, maxResults: 100 }),
    ).toThrow(/defaultResults/u);
    expect(() =>
      resolveTestitConfig({
        defaultAttachmentBytes: 2_048,
        maxAttachmentBytes: 1_024,
      }),
    ).toThrow(/defaultAttachmentBytes/u);
    expect(testitInstance(resolveTestitConfig({}), "cloud")).toBeUndefined();
  });
});
