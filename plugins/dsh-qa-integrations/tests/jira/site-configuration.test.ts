import { resolveJiraConfig } from "../../src/providers/jira/config.js";

describe("jira site configuration", () => {
  it("canonicalizes configured sites and rejects unsafe ones", () => {
    const flags = resolveJiraConfig({
      sites: [
        { id: "company", label: "", baseUrl: "https://company.atlassian.net/" },
        { id: "lab", label: "Lab", baseUrl: "https://jira.example.com/jira/" },
      ],
    });
    expect(flags.sites).toEqual([
      {
        id: "company",
        label: "company.atlassian.net",
        baseUrl: "https://company.atlassian.net",
        deploymentType: "cloud",
      },
      {
        id: "lab",
        label: "Lab",
        baseUrl: "https://jira.example.com/jira",
        deploymentType: "cloud",
      },
    ]);
    expect(flags.enabled).toBe(true);
    expect(flags.defaultSearchLimit).toBe(20);
    expect(flags.maxSearchLimit).toBe(100);

    for (const bad of [
      { id: "plain", label: "x", baseUrl: "http://company.atlassian.net" },
      { id: "creds", label: "x", baseUrl: "https://user:pw@jira.example" },
      { id: "query", label: "x", baseUrl: "https://jira.example?x=1" },
      { id: "Bad Id", label: "x", baseUrl: "https://jira.example" },
      { id: "protocol", label: "x", baseUrl: "ftp://jira.example" },
      { id: "no-url", label: "x", baseUrl: "jira.example" },
    ]) {
      expect(() => resolveJiraConfig({ sites: [bad] })).toThrow(
        /jira integration config/u,
      );
    }
    expect(() =>
      resolveJiraConfig({
        sites: [
          { id: "same", label: "a", baseUrl: "https://a.example" },
          { id: "same", label: "b", baseUrl: "https://b.example" },
        ],
      }),
    ).toThrow(/duplicate/u);
  });

  it("keeps a site that declares no product on Cloud, and names the others", () => {
    const [implicit] = resolveJiraConfig({
      sites: [
        { id: "legacy", label: "", baseUrl: "https://jira.example.corp" },
      ],
    }).sites;
    expect(implicit?.deploymentType).toBe("cloud");

    // An administrator calls the product Data Center; the API is the same one
    // Server answers, so both spellings resolve to the same deployment.
    for (const declared of ["server", "data-center", "DataCenter"]) {
      const [site] = resolveJiraConfig({
        sites: [
          {
            id: "corp",
            label: "",
            baseUrl: "https://jira.example.corp",
            deploymentType: declared,
          },
        ],
      }).sites;
      expect(site?.deploymentType, declared).toBe("server");
    }

    const [cloud] = resolveJiraConfig({
      sites: [
        {
          id: "cloud",
          label: "",
          baseUrl: "https://company.atlassian.net",
          deploymentType: " Cloud ",
        },
      ],
    }).sites;
    expect(cloud?.deploymentType).toBe("cloud");

    // A typo fails loudly instead of silently becoming the default: a site read
    // as the wrong product would refuse every connection with no explanation.
    expect(() =>
      resolveJiraConfig({
        sites: [
          {
            id: "corp",
            label: "",
            baseUrl: "https://jira.example.corp",
            deploymentType: "datacentre",
          },
        ],
      }),
    ).toThrow(/deploymentType must be cloud, server or data-center/u);
  });

  it("caps the search page at the deployment ceiling", () => {
    // A default above the ceiling is folded down instead of becoming a hole.
    expect(
      resolveJiraConfig({ defaultSearchLimit: 80, maxSearchLimit: 50 })
        .defaultSearchLimit,
    ).toBe(50);
    expect(resolveJiraConfig({ maxSearchLimit: 500 }).maxSearchLimit).toBe(100);
  });

  it("takes the names of the instance's custom fields from the deployment", () => {
    const flags = resolveJiraConfig({
      fieldAliases: {
        product: " customfield_10010 ",
        team: "customfield_10011",
      },
    });
    expect(flags.fieldAliases).toEqual({
      product: "customfield_10010",
      team: "customfield_10011",
    });
    // No alias is declared by default: a field id belongs to an instance.
    expect(resolveJiraConfig().fieldAliases).toEqual({});

    for (const bad of [
      { Product: "customfield_10010" },
      { "product name": "customfield_10010" },
      { product: "cf_10010" },
      { product: "10010" },
      { product: "" },
      { product: 10 },
    ]) {
      expect(() => resolveJiraConfig({ fieldAliases: bad as never })).toThrow(
        /jira integration config/u,
      );
    }
    expect(() =>
      resolveJiraConfig({
        fieldAliases: Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [
            `alias-${index}`,
            "customfield_10010",
          ]),
        ),
      }),
    ).toThrow(/at most 32/u);
  });
});
