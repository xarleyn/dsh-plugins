import {
  resolveConfluenceConfig,
  spaceAllowed,
} from "../../src/providers/confluence/config.js";
import { ConfluenceProvider } from "../../src/providers/confluence/index.js";
import {
  COMPANY,
  config,
  credentialFor,
  EMAIL,
  siteStub,
  stub,
  TOKEN,
} from "./shared.js";

describe("confluence site configuration", () => {
  it("canonicalizes configured sites and rejects unsafe ones", () => {
    const flags = resolveConfluenceConfig({
      instances: [
        { id: "company", label: "", baseUrl: "https://company.atlassian.net/" },
        {
          id: "gateway",
          label: "Scoped",
          baseUrl: "https://api.atlassian.com/ex/confluence/cloud-1/",
        },
      ],
    });
    expect(flags.instances).toEqual([
      {
        id: "company",
        label: "company.atlassian.net",
        baseUrl: "https://company.atlassian.net",
        deploymentType: "cloud",
      },
      {
        id: "gateway",
        label: "Scoped",
        baseUrl: "https://api.atlassian.com/ex/confluence/cloud-1",
        deploymentType: "cloud",
      },
    ]);

    for (const bad of [
      { id: "plain", label: "x", baseUrl: "http://company.atlassian.net" },
      { id: "creds", label: "x", baseUrl: "https://u:p@company.atlassian.net" },
      { id: "query", label: "x", baseUrl: "https://company.atlassian.net?x=1" },
      { id: "Bad Id", label: "x", baseUrl: "https://company.atlassian.net" },
      { id: "protocol", label: "x", baseUrl: "ftp://company.atlassian.net" },
      { id: "not-a-url", label: "x", baseUrl: "company.atlassian.net" },
    ]) {
      expect(() => resolveConfluenceConfig({ instances: [bad] })).toThrow(
        /confluence integration config/u,
      );
    }
    expect(() =>
      resolveConfluenceConfig({
        instances: [
          { id: "same", label: "a", baseUrl: "https://a.example" },
          { id: "same", label: "b", baseUrl: "https://b.example" },
        ],
      }),
    ).toThrow(/duplicate/u);
  });

  it("keeps an instance that declares no product on Cloud, and names the others", () => {
    const [implicit] = resolveConfluenceConfig({
      instances: [
        { id: "legacy", label: "", baseUrl: "https://wiki.example.corp" },
      ],
    }).instances;
    expect(implicit?.deploymentType).toBe("cloud");

    // An administrator calls the product Data Center; the API is the same one
    // Server answers, so both spellings resolve to the same deployment.
    for (const declared of ["server", "data-center", "DataCenter"]) {
      const [instance] = resolveConfluenceConfig({
        instances: [
          {
            id: "corp",
            label: "",
            baseUrl: "https://wiki.example.corp/confluence",
            deploymentType: declared,
          },
        ],
      }).instances;
      expect(instance?.deploymentType, declared).toBe("server");
    }

    // A typo fails loudly instead of silently becoming the default: an instance
    // read as the wrong product would answer every read with a 404.
    expect(() =>
      resolveConfluenceConfig({
        instances: [
          {
            id: "corp",
            label: "",
            baseUrl: "https://wiki.example.corp",
            deploymentType: "datacentre",
          },
        ],
      }),
    ).toThrow(/deploymentType must be cloud, server or data-center/u);
  });

  it("allows plain HTTP only when the deployment says so", () => {
    const flags = resolveConfluenceConfig({
      allowInsecureHttp: true,
      instances: [
        { id: "lab", label: "Lab", baseUrl: "http://wiki.lan:8090/" },
      ],
    });
    expect(flags.instances[0]?.baseUrl).toBe("http://wiki.lan:8090");
  });

  it("upper-cases the space allowlist and rejects what is not a key", () => {
    const flags = resolveConfluenceConfig({
      allowedSpaces: [" eng ", "eng", "PLATFORM"],
    });
    expect(flags.allowedSpaces).toEqual(["ENG", "PLATFORM"]);
    expect(spaceAllowed(flags, "eng")).toBe(true);
    expect(spaceAllowed(flags, "hr")).toBe(false);
    expect(spaceAllowed(flags, undefined)).toBe(false);
    // An empty list is the whole space: nothing is narrowed.
    const open = resolveConfluenceConfig({});
    expect(open.allowedSpaces).toEqual([]);
    expect(spaceAllowed(open, "HR")).toBe(true);
    expect(spaceAllowed(open, undefined)).toBe(true);

    for (const bad of [["with space"], ["../etc"], [""], [42]]) {
      expect(() =>
        resolveConfluenceConfig({ allowedSpaces: bad as string[] }),
      ).toThrow(/confluence integration config/u);
    }
  });

  it("refuses a body ceiling below the default budget", () => {
    expect(() =>
      resolveConfluenceConfig({
        defaultBodyChars: 20_000,
        maxBodyChars: 5_000,
      }),
    ).toThrow(/maxBodyChars must be at least defaultBodyChars/u);
  });
});

describe("confluence connect form", () => {
  it("accepts a token only as a token, never as a pasted URL", () => {
    const provider = new ConfluenceProvider(
      config({ instances: [COMPANY] }),
      stub(() => ({})).fetcher,
    );
    for (const bad of [
      "https://id.atlassian.com/manage-profile/security/api-tokens",
      "Atlassian token",
      "short",
      `${TOKEN}\nmore`,
    ]) {
      expect(() =>
        provider.parseCredential(bad, { instanceId: "company", email: EMAIL }),
      ).toThrow(/Atlassian API token/u);
    }
    expect(
      provider.parseCredential(` ${TOKEN} `, {
        instanceId: "company",
        email: EMAIL,
      }).credential,
    ).toContain(TOKEN);
  });

  it("keeps the account e-mail and the site inside the encrypted credential", () => {
    const { fetcher } = stub(() => ({}));
    const provider = new ConfluenceProvider(config(), fetcher);
    // The token alone cannot authenticate: whom it acts as is part of the pair.
    for (const bad of [
      "",
      "alice",
      "alice@",
      "@example.com",
      "a b@example.com",
    ]) {
      expect(() =>
        provider.parseCredential(TOKEN, { instanceId: "company", email: bad }),
      ).toThrow(/e-mail of the Atlassian account/u);
    }
    expect(() =>
      provider.parseCredential(TOKEN, { instanceId: "company" }),
    ).toThrow(/e-mail of the Atlassian account/u);

    const parsed = provider.parseCredential(TOKEN, {
      instanceId: "company",
      email: ` ${EMAIL} `,
    });
    expect(parsed.portal).toBe("https://company.atlassian.net");
    expect(JSON.parse(parsed.credential)).toEqual({
      instanceId: "company",
      email: EMAIL,
      token: TOKEN,
    });
  });

  it("binds the credential to a configured site and refuses unknown ones", () => {
    const { fetcher } = stub(() => ({}));
    const many = new ConfluenceProvider(config(), fetcher);
    expect(() => many.parseCredential(TOKEN, { email: EMAIL })).toThrow(
      /Choose a Confluence site/u,
    );
    expect(() =>
      many.parseCredential(TOKEN, { instanceId: "nope", email: EMAIL }),
    ).toThrow(/Unknown Confluence site/u);

    const single = new ConfluenceProvider(
      config({ instances: [COMPANY] }),
      fetcher,
    );
    expect(single.parseCredential(TOKEN, { email: EMAIL }).portal).toBe(
      "https://company.atlassian.net",
    );

    const none = new ConfluenceProvider(config({ instances: [] }), fetcher);
    expect(() => none.parseCredential(TOKEN, { email: EMAIL })).toThrow(
      /No Confluence site is configured/u,
    );
  });

  it("fails closed when the site a credential names was removed", async () => {
    const { calls, fetcher } = siteStub();
    const provider = new ConfluenceProvider(
      config({ instances: [COMPANY] }),
      fetcher,
    );
    const credential = credentialFor("sandbox", fetcher);
    await expect(
      provider.execute({ credential }, "connection.get", {}),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
    expect(calls).toHaveLength(0);
  });
});

describe("confluence connection validation", () => {
  it("reports the account and the capabilities the deployment enables", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        accountId: "acc-alice",
        displayName: "Alice Example",
        email: EMAIL,
        accountType: "atlassian",
      },
    }));
    const provider = new ConfluenceProvider(config(), fetcher);
    const validation = await provider.validate({
      credential: credentialFor("company", fetcher),
    });
    expect(validation).toEqual({
      tenantId: "https://company.atlassian.net",
      externalUserId: "acc-alice",
      displayName: "Alice Example",
      capabilities: [
        "identity.read",
        "spaces.read",
        "search.read",
        "content.read",
        "comments.read",
        "attachments.read",
        "versions.read",
      ],
    });
    expect(calls[0]?.url.pathname).toBe("/wiki/rest/api/user/current");
    // An API token cannot be asked which scopes it holds, so the deployment
    // switches are the whole offer.
    const narrow = new ConfluenceProvider(
      config({ searchRead: false, attachmentsRead: false }),
      fetcher,
    );
    const narrowed = await narrow.validate({
      credential: credentialFor("company", fetcher),
    });
    expect(narrowed.capabilities).toEqual([
      "identity.read",
      "spaces.read",
      "content.read",
      "comments.read",
      "versions.read",
    ]);
  });

  it("refuses an answer without an account id", async () => {
    const { fetcher } = stub(() => ({ json: { displayName: "Alice" } }));
    const provider = new ConfluenceProvider(config(), fetcher);
    await expect(
      provider.validate({ credential: credentialFor("company", fetcher) }),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
  });
});
