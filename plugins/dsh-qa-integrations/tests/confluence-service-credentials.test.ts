import {
  CONFLUENCE_CAPABILITIES,
  CONFLUENCE_OPERATIONS,
} from "../src/providers/confluence/catalog.js";
import { ConfluenceProvider } from "../src/providers/confluence/index.js";
import { evaluateServiceOperation } from "../src/service-credentials/policy.js";
import { UNCLASSIFIED_OPERATION } from "../src/service-credentials/types.js";
import type {
  ServiceCredentialHealth,
  ServiceCredentialProfile,
  ServiceResourceBoundary,
} from "../src/service-credentials/types.js";
import {
  COMPANY,
  EMAIL,
  PAGE,
  SPACE,
  TOKEN,
  config,
  stub,
} from "./confluence/shared.js";

/** The spaces the deployment's profile bounds this agent to. */
const BOUNDARY = Object.freeze({
  spaces: Object.freeze(["ENG", "PROD"]),
});

function credential(fetcher: typeof fetch) {
  return {
    provider: new ConfluenceProvider(config(), fetcher),
    plaintext: JSON.stringify({
      instanceId: COMPANY.id,
      email: EMAIL,
      token: TOKEN,
    }),
  };
}

/** A service call: the broker hands the provider a boundary and the mode. */
function serviceContext(boundary: ServiceResourceBoundary = BOUNDARY) {
  return {
    credentialSource: "service" as const,
    resourceBoundary: boundary,
  };
}

function profile(): ServiceCredentialProfile {
  return {
    id: "confluence-company-readonly",
    provider: "confluence",
    instance: COMPANY.id,
    portal: COMPANY.baseUrl,
    label: "QA Confluence Read-only",
    authType: "api-token",
    secretRef: "env:QA_CONFLUENCE_SERVICE_TOKEN",
    enabled: true,
    resources: BOUNDARY,
    policy: {},
    policyRevision: "rev",
  };
}

/** v1 search hits: two inside the boundary, one outside, one with no space. */
const SEARCH_HITS = [
  {
    content: {
      id: "1",
      type: "page",
      title: "Runbook",
      space: { key: "ENG", name: "Engineering" },
    },
    excerpt: "deploy steps",
  },
  {
    content: {
      id: "2",
      type: "page",
      title: "Release notes",
      space: { key: "PROD", name: "Production" },
    },
    excerpt: "version 7",
  },
  {
    content: {
      id: "3",
      type: "page",
      title: "Internal",
      space: { key: "SECRET", name: "Hidden" },
    },
    excerpt: "restricted",
  },
  { content: { id: "4", type: "page", title: "Orphan" }, excerpt: "no space" },
];

/**
 * A site that answers the identity, page, space, listing and search reads.
 * `spaceKey` decides what the space reads resolve to, which is how the tests
 * move a page in and out of the boundary.
 */
function site(spaceKey = SPACE.key) {
  return stub((url) => {
    const path = url.pathname;
    if (path.endsWith("/user/current")) {
      return { json: { accountId: "acc-service", displayName: "QA Bot" } };
    }
    if (path.endsWith("/footer-comments")) return { json: { results: [] } };
    if (path.endsWith("/attachments")) {
      return { json: { results: [{ id: "att-1", title: "spec.pdf" }] } };
    }
    if (path.endsWith("/versions")) {
      return { json: { results: [{ number: 7 }] } };
    }
    if (/\/pages\/\d+$/u.test(path)) return { json: PAGE };
    if (/\/spaces\/\d+$/u.test(path)) {
      return { json: { ...SPACE, key: spaceKey } };
    }
    if (path === "/wiki/api/v2/spaces") {
      return { json: { results: [{ ...SPACE, key: spaceKey }] } };
    }
    if (path === "/wiki/rest/api/search") {
      return { json: { results: SEARCH_HITS } };
    }
    return { status: 404, json: {} };
  });
}

describe("Confluence managed service credentials", () => {
  it("classifies every catalog operation, leaving none unclassified", () => {
    const { fetcher } = site();
    const provider = new ConfluenceProvider(config(), fetcher);
    for (const [operation, definition] of Object.entries(
      CONFLUENCE_OPERATIONS,
    )) {
      const metadata = provider.operationMetadata?.(operation);
      expect(metadata, operation).toEqual(definition.security);
      expect(metadata?.effect, operation).toBe("read");
      expect(metadata?.sensitivity, operation).toBe("normal");
      expect(metadata?.serviceCredential, operation).toBe("allow");
    }
    // The catalog is all reads of authored content: the identity read stands
    // outside the boundary, every space-scoped read is held inside it.
    expect(provider.operationMetadata?.("connection.get")).toMatchObject({
      requiresResourceBoundary: false,
    });
    expect(provider.operationMetadata?.("pages.get")).toMatchObject({
      requiresResourceBoundary: true,
    });
  });

  it("derives the capability states from the classifications", () => {
    const { fetcher } = site();
    const provider = new ConfluenceProvider(config(), fetcher);
    for (const { capability } of CONFLUENCE_CAPABILITIES) {
      expect(provider.capabilityServiceState?.(capability), capability).toBe(
        "available",
      );
    }
    // A capability the provider never offered is reported as unavailable, so a
    // client never shows a switch that would do nothing.
    expect(provider.capabilityServiceState?.("records.write")).toBe(
      "unavailable",
    );
  });

  it("lets the whole read-only catalog through the service ceiling", () => {
    const { fetcher } = site();
    const provider = new ConfluenceProvider(config(), fetcher);
    for (const [operation, definition] of Object.entries(
      CONFLUENCE_OPERATIONS,
    )) {
      const decision = evaluateServiceOperation({
        metadata: definition.security,
        capability: definition.capability,
        profile: profile(),
        boundaryKind: provider.resourceBoundaryKind?.(operation),
      });
      expect(decision, operation).toMatchObject({ allowed: true });
    }
  });

  it("denies what no provider classified and a profile that bounds nothing", () => {
    const decision = evaluateServiceOperation({
      metadata: UNCLASSIFIED_OPERATION,
      capability: "content.read",
      profile: profile(),
      boundaryKind: "spaces",
    });
    expect(decision).toMatchObject({ allowed: false });
    const pagesGet = CONFLUENCE_OPERATIONS["pages.get"]?.security;
    expect(pagesGet).toBeDefined();
    const unbounded = evaluateServiceOperation({
      metadata: pagesGet ?? UNCLASSIFIED_OPERATION,
      capability: "content.read",
      profile: { ...profile(), resources: {} },
      boundaryKind: "spaces",
    });
    expect(unbounded).toMatchObject({
      allowed: false,
      code: "ServiceResourceNotAllowed",
    });
  });

  it("refuses an operation outside the catalog before any upstream call", async () => {
    const { fetcher, calls } = site();
    const { provider, plaintext } = credential(fetcher);
    // No write exists in this catalog, and an unclassified name is refused as
    // unsupported before the transport is touched at all.
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "pages.update",
        { pageId: 123456, title: "Rewritten" },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toEqual([]);
  });

  it("fails closed when service mode arrives without a boundary", async () => {
    const { fetcher, calls } = site();
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, credentialSource: "service" },
        "pages.get",
        { pageId: 123456 },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
  });

  it("serves a page inside the boundary, resolving its space first", async () => {
    const { fetcher, calls } = site();
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "pages.get",
      { pageId: 123456 },
    )) as { page: { title: string; space: { key: string } } };
    expect(answer.page.title).toBe(PAGE.title);
    expect(answer.page.space).toMatchObject({ key: "ENG" });
    // The page's space is resolved and verified before the answer is built:
    // one read of the page, one of its space, nothing else.
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
    ]);
  });

  it("refuses a page whose space is outside the boundary", async () => {
    const { fetcher, calls } = site("SECRET");
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "pages.get",
        { pageId: 123456 },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // The two reads are the resolution of the page's space; the content never
    // reaches the answer.
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
    ]);
  });

  it("probes the page's space before an attachment or version read", async () => {
    const { fetcher, calls } = site("SECRET");
    const { provider, plaintext } = credential(fetcher);
    for (const operation of ["pages.attachments", "pages.versions"]) {
      await expect(
        provider.execute(
          { credential: plaintext, ...serviceContext() },
          operation,
          { pageId: 123456 },
        ),
      ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    }
    // Both reads resolve the page's space first and refuse before their own
    // endpoint is touched.
    expect(
      calls.every((call) => !call.url.pathname.endsWith("/attachments")),
    ).toBe(true);
    expect(
      calls.every((call) => !call.url.pathname.endsWith("/versions")),
    ).toBe(true);
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
    ]);
  });

  it("serves the metadata reads of a page inside the boundary", async () => {
    const { fetcher, calls } = site();
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "pages.attachments",
        { pageId: 123456 },
      ),
    ).resolves.toMatchObject({ items: [{ id: "att-1" }] });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "pages.comments",
        { pageId: 123456 },
      ),
    ).resolves.toMatchObject({ items: [] });
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
      "/wiki/api/v2/pages/123456/attachments",
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
      "/wiki/api/v2/pages/123456/footer-comments",
    ]);
  });

  it("refuses a space named outside the boundary before any upstream call", async () => {
    const { fetcher, calls } = site("SECRET");
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "spaces.get",
        { space: "SECRET" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "search.run",
        { query: "deploy", spaces: ["SECRET"] },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "spaces.list",
        { keys: ["SECRET"] },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
  });

  it("matches a boundary key in any case", async () => {
    const { fetcher, calls } = site();
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext({ spaces: ["eng"] }) },
        "spaces.get",
        { space: "eng" },
      ),
    ).resolves.toMatchObject({ space: { key: "ENG" } });
    // The keyed lookup is one listing read upstream; a refusal never is.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("keys")).toBe("eng");
  });

  it("resolves a numeric space id to its key before answering", async () => {
    const { fetcher, calls } = site("SECRET");
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "spaces.get",
        { space: "98305" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/wiki/api/v2/spaces/98305",
    ]);
  });

  it("narrows a search to the boundary spaces in the CQL itself", async () => {
    const { fetcher, calls } = site();
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "search.run",
      { query: "deploy" },
    )) as { items: readonly { id: string }[] };
    // The restriction travels upstream, so the answer pages inside the boundary.
    expect(calls[0]?.url.searchParams.get("cql")).toBe(
      'type in (page) AND space in ("ENG", "PROD") AND text ~ "deploy"',
    );
    // The filter over the answer stays as the second lock: a row outside the
    // boundary and a row with no readable space are dropped.
    expect(answer.items.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("narrows the search further to the operator allowlist", async () => {
    const { fetcher, calls } = site();
    const { plaintext } = credential(fetcher);
    const provider = new ConfluenceProvider(
      config({ allowedSpaces: ["ENG"] }),
      fetcher,
    );
    await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "search.run",
      {},
    );
    // The deployment allowlist binds the agent whatever credential it spends.
    expect(calls[0]?.url.searchParams.get("cql")).toBe(
      'type in (page) AND space in ("ENG")',
    );
  });

  it("builds the bounded space listing from the boundary, reporting holes", async () => {
    const { fetcher, calls } = stub((url) => {
      if (url.pathname === "/wiki/api/v2/spaces") {
        if (url.searchParams.get("keys") === "PROD") {
          return { status: 404, json: {} };
        }
        return { json: { results: [SPACE] } };
      }
      return { json: { accountId: "acc-service" } };
    });
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "spaces.list",
      {},
    )) as {
      serviceScoped: boolean;
      items: readonly { key: string }[];
      unavailableResources?: readonly string[];
    };
    expect(answer.serviceScoped).toBe(true);
    expect(answer.items.map((item) => item.key)).toEqual(["ENG"]);
    // A bounded space the service token cannot see is reported, not hidden.
    expect(answer.unavailableResources).toEqual(["PROD"]);
    expect(calls.map((call) => call.url.searchParams.get("keys"))).toEqual([
      "ENG",
      "PROD",
    ]);
  });

  it("leaves the personal mode untouched", async () => {
    const { fetcher, calls } = site("SECRET");
    const { provider, plaintext } = credential(fetcher);
    // No service mode, empty allowlist: a page in any space reads as before,
    // the space read only enriches the answer with its key and name.
    await expect(
      provider.execute({ credential: plaintext }, "pages.get", {
        pageId: 123456,
      }),
    ).resolves.toMatchObject({ page: { title: PAGE.title } });
    // A personal comment read costs no page-and-space probe.
    await expect(
      provider.execute({ credential: plaintext }, "pages.comments", {
        pageId: 123456,
      }),
    ).resolves.toBeDefined();
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/wiki/api/v2/pages/123456",
      "/wiki/api/v2/spaces/98305",
      "/wiki/api/v2/pages/123456/footer-comments",
    ]);
  });

  it("reports a service token healthy after the identity probe alone", async () => {
    const { fetcher, calls } = site();
    const { provider, plaintext } = credential(fetcher);
    const health = (await provider.validateServiceCredential?.({
      credential: plaintext,
    })) as ServiceCredentialHealth;
    expect(health.status).toBe("healthy");
    expect(health.upstreamIdentity).toEqual({
      id: "acc-service",
      label: "QA Bot",
    });
    // Confluence exposes no scope introspection, so no scopes are claimed.
    expect(health.grantedScopes).toBeUndefined();
    expect(health.warnings).toEqual([
      "Confluence did not report the token scopes; the local service ceiling still applies",
    ]);
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/wiki/rest/api/user/current",
    ]);
  });

  it("maps a rejected service token onto its health status", async () => {
    const { fetcher } = stub(() => ({
      status: 401,
      json: { message: "401 Unauthorized" },
    }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.validateServiceCredential?.({ credential: plaintext }),
    ).resolves.toMatchObject({ status: "revoked" });
  });

  it("spends the deployment secret as the Basic pair the site names", () => {
    const { fetcher } = site();
    const provider = new ConfluenceProvider(config(), fetcher);
    const parsed = provider.parseCredential(`${EMAIL}:${TOKEN}`, {
      instanceId: COMPANY.id,
    });
    expect(parsed.portal).toBe(COMPANY.baseUrl);
    expect(JSON.parse(parsed.credential)).toEqual({
      instanceId: COMPANY.id,
      email: EMAIL,
      token: TOKEN,
    });
    // A secret without the account half cannot become a credential.
    expect(() =>
      provider.parseCredential(TOKEN, { instanceId: COMPANY.id }),
    ).toThrow(/e-mail of the Atlassian account/u);
  });
});
