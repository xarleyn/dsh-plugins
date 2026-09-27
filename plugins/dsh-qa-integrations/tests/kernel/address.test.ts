import {
  ENDPOINT_ID,
  findEndpoint,
  resolveEndpointList,
  type EndpointListPolicy,
} from "../../src/providers/kernel/address.js";

/**
 * The kernel answers the address question once, so these cases are the contract
 * every provider inherits. They are written against the kernel itself rather
 * than through one provider because a rule that only ever appears in a
 * provider's test is a rule the next provider can lose silently — which is how
 * the fragment check came to exist in Test IT and not in the shared policy.
 */

const policy: EndpointListPolicy = {
  error: (message) => new Error(message),
  field: "sites",
  noun: "site",
};

function one(baseUrl: string, extra: Record<string, unknown> = {}) {
  return resolveEndpointList(
    [{ id: "a", label: "A", baseUrl, ...extra }],
    false,
    policy,
  );
}

describe("kernel address policy", () => {
  it("canonicalizes an operator row to `<origin><path>`", () => {
    const [row] = resolveEndpointList(
      [
        {
          id: "cloud",
          label: "",
          baseUrl: "https://Team.Example.CORP/root/",
        },
      ],
      false,
      policy,
    );
    expect(row).toEqual({
      id: "cloud",
      label: "team.example.corp",
      baseUrl: "https://team.example.corp/root",
    });
  });

  it("keeps a subpath and folds a trailing slash, so an API root can be appended", () => {
    expect(one("https://jira.example.corp/atlassian")?.[0]?.baseUrl).toBe(
      "https://jira.example.corp/atlassian",
    );
    expect(one("https://jira.example.corp///")?.[0]?.baseUrl).toBe(
      "https://jira.example.corp",
    );
  });

  it("names the field it refused, so the operator finds the row", () => {
    expect(() => one("not a URL")).toThrow(
      /sites\[0\]\.baseUrl must be an absolute URL/u,
    );
    expect(() =>
      resolveEndpointList(
        [{ id: "A", label: "A", baseUrl: "https://x" }],
        false,
        policy,
      ),
    ).toThrow(/sites\[0\]\.id must be lowercase latin/u);
    expect(() =>
      resolveEndpointList(
        [
          { id: "a", label: "A", baseUrl: "https://x" },
          { id: "a", label: "Again", baseUrl: "https://y" },
        ],
        false,
        policy,
      ),
    ).toThrow(/sites\[1\]\.id is a duplicate/u);
    expect(() => resolveEndpointList(["a"], false, policy)).toThrow(
      /sites\[0\] must be a mapping/u,
    );
    expect(() => resolveEndpointList("sites", false, policy)).toThrow(
      /sites must be a list/u,
    );
  });

  it("refuses a scheme that is not HTTP or HTTPS", () => {
    expect(() => one("ftp://jira.example.corp")).toThrow(
      /must use HTTP or HTTPS/u,
    );
  });

  it("refuses plain HTTP until the deployment says it is developing", () => {
    expect(() => one("http://jira.example.corp")).toThrow(
      /needs HTTPS; set allowInsecureHttp for a development site/u,
    );
    expect(
      resolveEndpointList(
        [{ id: "a", label: "A", baseUrl: "http://jira.example.corp" }],
        true,
        policy,
      )[0]?.baseUrl,
    ).toBe("http://jira.example.corp");
  });

  it("lets a provider word the development exception in its own terms", () => {
    expect(() =>
      resolveEndpointList(
        [{ id: "a", label: "A", baseUrl: "http://tms.corp.example" }],
        false,
        { ...policy, insecureTarget: "an internal Test IT" },
      ),
    ).toThrow(/set allowInsecureHttp for an internal Test IT/u);
  });

  it("refuses the parts of a URL that are not an endpoint", () => {
    expect(() => one("https://user:pw@jira.example.corp")).toThrow(
      /must carry no credentials or query/u,
    );
    expect(() => one("https://jira.example.corp?debug=1")).toThrow(
      /must carry no credentials or query/u,
    );
  });

  it("refuses a fragment rather than folding a pasted browser URL away", () => {
    // A fragment never reaches the server, so canonicalizing it away would turn
    // `https://jira.example/browse/PROJ` — an operator who pasted the page they
    // read — into an endpoint that silently means something else.
    expect(() => one("https://jira.example.corp/browse/PROJ#anchor")).toThrow(
      /sites\[0\]\.baseUrl must carry no fragment/u,
    );
    expect(() => one("https://jira.example.corp#top")).toThrow(
      /must carry no fragment/u,
    );
  });

  it("holds the list to one deployment's size", () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `s${index}`,
      label: `S${index}`,
      baseUrl: `https://jira${index}.example.corp`,
    }));
    expect(() =>
      resolveEndpointList(rows, false, { ...policy, max: 2 }),
    ).toThrow(/sites accepts at most 2 entries/u);
    expect(
      resolveEndpointList(rows, false, { ...policy, max: 3 }),
    ).toHaveLength(3);
  });

  it("resolves provider row members after the shared ones", () => {
    const [row] = resolveEndpointList(
      [
        {
          id: "a",
          label: "A",
          baseUrl: "https://jira.example.corp",
          tier: "cloud",
        },
      ],
      false,
      {
        ...policy,
        extra: (record) => ({ tier: String(record["tier"]) }),
      },
    );
    expect(row).toEqual({
      id: "a",
      label: "A",
      baseUrl: "https://jira.example.corp",
      tier: "cloud",
    });
  });

  it("answers an undeclared list with an empty one that cannot be written", () => {
    for (const input of [undefined, null]) {
      const rows = resolveEndpointList(input, false, policy);
      expect(rows).toEqual([]);
      expect(Object.isFrozen(rows)).toBe(true);
    }
    expect(Object.isFrozen(one("https://jira.example.corp")[0])).toBe(true);
  });

  it("shares one id grammar between the kernel and its callers", () => {
    expect(ENDPOINT_ID.test("a")).toBe(true);
    expect(ENDPOINT_ID.test("0-abc")).toBe(true);
    expect(ENDPOINT_ID.test("abc_def")).toBe(false);
    expect(ENDPOINT_ID.test("-abc")).toBe(false);
  });

  it("finds the endpoint an id names, and nothing for one it does not", () => {
    const rows = resolveEndpointList(
      [
        { id: "a", label: "A", baseUrl: "https://a.example.corp" },
        { id: "b", label: "B", baseUrl: "https://b.example.corp" },
      ],
      false,
      policy,
    );
    expect(findEndpoint(rows, "b")?.baseUrl).toBe("https://b.example.corp");
    // A stored credential naming a retired endpoint must resolve to nothing the
    // transport could dial, which is what makes the provider fail closed.
    expect(findEndpoint(rows, "c")).toBeUndefined();
    expect(findEndpoint(rows, "")).toBeUndefined();
  });
});
