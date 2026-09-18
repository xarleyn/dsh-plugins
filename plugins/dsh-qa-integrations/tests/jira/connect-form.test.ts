import { COMPANY, EMAIL, TOKEN, providerFor, stub } from "./shared.js";

describe("jira connect form", () => {
  it("accepts an API token only as a token, never as a pasted URL", () => {
    const provider = providerFor(stub(() => ({})).fetcher);
    for (const bad of [
      "https://id.atlassian.com/manage-profile/security/api-tokens",
      "short",
      "alice@example.com:ATATT3xFfGF0abcdefghijklmnop",
      `${TOKEN}\nmore`,
    ]) {
      expect(() =>
        provider.parseCredential(bad, { siteId: "company", email: EMAIL }),
      ).toThrow(/Atlassian API token/u);
    }
    // Surrounding whitespace is a paste artifact, not part of the token.
    expect(
      provider.parseCredential(` ${TOKEN} `, {
        siteId: COMPANY.id,
        email: EMAIL,
      }).credential,
    ).toContain(TOKEN);
  });

  it("requires the e-mail the token is spent as", () => {
    const provider = providerFor(stub(() => ({})).fetcher);
    for (const email of ["", "alice", "alice@", "alice example@x.com"]) {
      expect(() =>
        provider.parseCredential(TOKEN, { siteId: COMPANY.id, email }),
      ).toThrow(/e-mail of the Atlassian account/u);
    }
  });

  it("binds the token to a configured site and refuses unknown ones", () => {
    const { fetcher } = stub(() => ({}));
    const many = providerFor(fetcher);
    expect(() => many.parseCredential(TOKEN, { email: EMAIL })).toThrow(
      /Choose a Jira site/u,
    );

    const single = providerFor(fetcher, { sites: [COMPANY] });
    const parsed = single.parseCredential(TOKEN, { email: EMAIL });
    expect(parsed.portal).toBe("https://company.atlassian.net");
    expect(JSON.parse(parsed.credential)).toEqual({
      siteId: "company",
      email: EMAIL,
      token: TOKEN,
    });

    expect(() =>
      many.parseCredential(TOKEN, { siteId: "nope", email: EMAIL }),
    ).toThrow(/Unknown Jira site/u);
    const none = providerFor(fetcher, { sites: [] });
    expect(() => none.parseCredential(TOKEN, { email: EMAIL })).toThrow(
      /No Jira site is configured/u,
    );
  });
});
