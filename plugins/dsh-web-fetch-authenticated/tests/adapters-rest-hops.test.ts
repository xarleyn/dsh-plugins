/**
 * Adapter REST hops over the real transport (SPEC §15.2/§16).
 *
 * The seam tests stub the transport and the provider tests walk the happy
 * path; what runs here is the hop itself — the URL the adapter rewrote the
 * request to, answered through `src/transport/fetch.ts`. That is where a rule's
 * policy is either shown to bind the REST request exactly as it binds a page
 * request, or quietly bypassed: the credential leaves on the rewritten path, a
 * redirect is decided by the rule rather than by the HTTP client, an over-cap
 * body is refused before it is read, and the answer is classified before the
 * adapter parses it.
 *
 * Every fixture listens on loopback; no request leaves the machine.
 */

import { afterEach, describe, expect, test } from "vitest";
import { applyAdapter } from "../src/adapters/index.js";
import type { AdapterRequestContext } from "../src/adapters/index.js";
import { issueApiUrl } from "../src/adapters/jira.js";
import {
  DEFAULT_MAX_URL_LENGTH,
  DEFAULT_USER_AGENT,
  resolveConfig,
} from "../src/config.js";
import type { AuthenticatedFetchRule } from "../src/types.js";
import {
  configWith,
  fixtureRule,
  startFixture,
  type FixtureRoute,
  type FixtureServer,
} from "./helpers.js";
import { adapterSettings } from "./adapters.helpers.js";
import { SECRET, expectCode } from "./provider.helpers.js";

const ISSUE_JSON = JSON.stringify({
  key: "PROJ-1",
  fields: {
    summary: "Hop issue",
    status: { name: "Open" },
    description: "hop body",
  },
});

/**
 * The request target of the hop a Server-flavored Jira rule answers for
 * `PROJ-1`. Path and query do not depend on the origin, so one constant names
 * the route on every fixture port.
 */
const HOP_TARGET = (() => {
  const url = issueApiUrl("http://127.0.0.1:1", "PROJ-1", adapterSettings());
  return `${url.pathname}${url.search}`;
})();

/** A second REST path on the same origin, for the followed-redirect case. */
const CANONICAL_TARGET = "/rest/api/2/issue/PROJ-1/canonical";

/** A Jira rule aimed at a loopback fixture, covering both REST paths. */
function jiraRule(
  origin: string,
  overrides: Partial<AuthenticatedFetchRule> = {},
): AuthenticatedFetchRule {
  return fixtureRule(origin, {
    adapter: { type: "jira" },
    match: {
      schemes: ["http"],
      hosts: ["127.0.0.1"],
      ports: [Number(new URL(origin).port)],
      allowPaths: ["/browse/**", "/rest/api/**"],
    },
    ...overrides,
  });
}

/** The adapter context the provider builds for one rule's resolved config. */
function hopContext(source: AuthenticatedFetchRule): AdapterRequestContext {
  const config = resolveConfig(configWith([source]));
  const rule = config.rules[0];
  if (rule === undefined)
    throw new Error(`the rule was rejected: ${config.configErrors.join("; ")}`);
  return {
    rule,
    rules: config.rules,
    globals: {
      maxUrlLength: DEFAULT_MAX_URL_LENGTH,
      userAgent: DEFAULT_USER_AGENT,
    },
    resolveSecrets: async () => ({ credential: SECRET }),
  };
}

/** Ask the seam for a browse URL, letting it fetch its own hop for real. */
function takeHop(server: FixtureServer, rule?: AuthenticatedFetchRule) {
  return applyAdapter(
    new URL(`${server.origin}/browse/PROJ-1`),
    hopContext(rule ?? jiraRule(server.origin)),
  );
}

describe("adapter REST hops over the authenticated transport", () => {
  let servers: FixtureServer[] = [];

  async function fixture(
    routes: Record<string, FixtureRoute>,
    defaults?: Partial<FixtureRoute>,
  ): Promise<FixtureServer> {
    const server = await startFixture(routes, defaults);
    servers.push(server);
    return server;
  }

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  test("the hop leaves on the rewritten path with the rule's credential", async () => {
    const server = await fixture({ [HOP_TARGET]: { body: ISSUE_JSON } });
    const result = await takeHop(server);
    expect(result?.body.content).toContain("# PROJ-1: Hop issue");
    expect(result?.body.content).toContain("hop body");
    // The page URL the caller asked for is never what goes on the wire, and
    // the auth the rule configures is what the REST endpoint receives.
    expect(server.requests.map((request) => request.url)).toEqual([HOP_TARGET]);
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  test("a hop redirected inside the rule's paths is followed and its body parsed", async () => {
    const server = await fixture({
      [HOP_TARGET]: {
        redirectStatus: 302,
        redirectLocation: CANONICAL_TARGET,
      },
      [CANONICAL_TARGET]: { body: ISSUE_JSON },
    });
    const result = await takeHop(server);
    expect(result?.body.content).toContain("# PROJ-1: Hop issue");
    expect(server.requests.map((request) => request.url)).toEqual([
      HOP_TARGET,
      CANONICAL_TARGET,
    ]);
    expect(server.requests[1]?.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  test("a hop redirected to another origin is denied and carries no credential there", async () => {
    const other = await fixture({ [HOP_TARGET]: { body: ISSUE_JSON } });
    const server = await fixture({
      [HOP_TARGET]: {
        redirectStatus: 302,
        redirectLocation: `${other.origin}${HOP_TARGET}`,
      },
    });
    const detail = await expectCode("AUTH_FETCH_REDIRECT_DENIED", () =>
      takeHop(server),
    );
    // The adapter does not opt its hop out of the redirect policy: a target
    // the rule does not authorize is never dialed, so the token stays home.
    expect(detail).toContain(other.origin);
    expect(other.requests).toHaveLength(0);
  });

  test("an over-cap REST body is refused before it is read", async () => {
    const server = await fixture({
      [HOP_TARGET]: {
        body: ISSUE_JSON,
        headers: { "content-length": String(Buffer.byteLength(ISSUE_JSON)) },
      },
    });
    await expectCode("AUTH_FETCH_RESPONSE_TOO_LARGE", () =>
      takeHop(
        server,
        jiraRule(server.origin, { limits: { maxResponseBytes: 64 } }),
      ),
    );
    expect(server.requests).toHaveLength(1);
  });

  test("a body the server under-reports is cut at the cap, never half-parsed", async () => {
    // The fixture answers chunked, so nothing declares the size: the cap then
    // bites mid-stream, and the adapter is handed a JSON prefix it must refuse
    // rather than pass off as the issue.
    const server = await fixture({ [HOP_TARGET]: { body: ISSUE_JSON } });
    const detail = await expectCode("AUTH_FETCH_ADAPTER_FAILED", () =>
      takeHop(
        server,
        jiraRule(server.origin, { limits: { maxResponseBytes: 64 } }),
      ),
    );
    expect(detail).toContain("malformed JSON");
  });

  test("a hop answered by a login page is an adapter failure, not a parsed issue", async () => {
    const server = await fixture({
      [HOP_TARGET]: {
        body: "<html><body>Sign in</body></html>",
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });
    const detail = await expectCode("AUTH_FETCH_ADAPTER_FAILED", () =>
      takeHop(server),
    );
    expect(detail).toContain("did not return JSON");
    expect(detail).not.toContain(SECRET);
  });

  test("a hop answered with a body the transport cannot carry never reaches the parser", async () => {
    const server = await fixture({
      [HOP_TARGET]: {
        body: "not really a png",
        headers: { "content-type": "image/png" },
      },
    });
    // The harness body union has no binary arm, so the transport refuses this
    // on classification — the adapter is not handed bytes to guess at.
    await expectCode("AUTH_FETCH_UNSUPPORTED_CONTENT", () => takeHop(server));
  });
});
