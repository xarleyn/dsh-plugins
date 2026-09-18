/**
 * Content adapter suite (SPEC §15.2/§26): URL recognition, REST URL
 * construction, markup conversion, normalization output, seam fall-through,
 * and the full provider path over a local Jira-like REST fixture.
 */

import { afterEach, describe, expect, test } from "vitest";
import { resolveConfig } from "../src/config.js";
import { validateRule } from "../src/rule-validation.js";
import {
  fakeCredentials,
  configWith,
  fixtureRule,
  startFixture,
  type FixtureServer,
} from "./helpers.js";
import { AuthenticatedFetchProvider } from "../src/provider.js";
import { silentLogger } from "./adapters.helpers.js";
import type { AuthenticatedFetchRule } from "../src/types.js";

describe("provider end-to-end with a Jira adapter over a fixture", () => {
  let server: FixtureServer | undefined;

  afterEach(async () => {
    if (server !== undefined) await server.close();
    server = undefined;
  });

  test("a browse URL is served from the REST fixture as normalized text", async () => {
    server = await startFixture(
      {},
      {
        body: JSON.stringify({
          key: "PROJ-1",
          fields: {
            summary: "Fixture issue",
            status: { name: "Open" },
            description: "plain body",
          },
        }),
      },
    );
    const rule: AuthenticatedFetchRule = fixtureRule(server.origin, {
      adapter: { type: "jira" },
      match: {
        schemes: ["http"],
        hosts: ["127.0.0.1"],
        ports: [server.port],
        allowPaths: ["/browse/**", "/rest/api/**"],
      },
    });
    const credentials = fakeCredentials({ TEST_TOKEN: "secret" });
    const provider = new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials,
      logger: silentLogger(),
    });
    const result = await provider.fetch({
      url: `${server.origin}/browse/PROJ-1`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body.kind).toBe("text");
    expect(result.body.content).toContain("# PROJ-1: Fixture issue");
    expect(result.body.content).toContain("plain body");
    expect(server.requests.map((request) => request.url)).toEqual([
      "/rest/api/2/issue/PROJ-1?fields=summary%2Cdescription%2Cstatus%2Cassignee%2Creporter%2Cpriority%2Clabels%2Ccomponents%2Ccreated%2Cupdated%2Cattachment",
    ]);
  });

  test("an adapter URL the adapter cannot map falls through to raw transport", async () => {
    server = await startFixture({
      "/open": {
        body: "<html><body>hello</body></html>",
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });
    const rule: AuthenticatedFetchRule = fixtureRule(server.origin, {
      adapter: { type: "jira" },
    });
    const provider = new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials: fakeCredentials({ TEST_TOKEN: "secret" }),
      logger: silentLogger(),
    });
    const result = await provider.fetch({ url: `${server.origin}/open` });
    expect(result.body.kind).toBe("html");
    expect(result.body.content).toContain("hello");
  });

  test("a Confluence rule serves the page with its configured cleanup level", async () => {
    const storage =
      '<h1>Runbook</h1><ac:structured-macro ac:name="toc"/><p><ac:image><ri:attachment ri:filename="schema.png"/></ac:image></p>';
    server = await startFixture(
      {},
      {
        body: JSON.stringify({
          id: "7",
          title: "Runbook",
          space: { name: "Operations" },
          body: { storage: { value: storage } },
        }),
      },
    );
    const ruleFor = (cleanup: "balanced" | "strict"): AuthenticatedFetchRule =>
      fixtureRule(server!.origin, {
        adapter: { type: "confluence", cleanup },
        match: {
          schemes: ["http"],
          hosts: ["127.0.0.1"],
          ports: [server!.port],
          allowPaths: ["/pages/**", "/rest/api/**"],
        },
      });
    const providerFor = (
      rule: AuthenticatedFetchRule,
    ): AuthenticatedFetchProvider =>
      new AuthenticatedFetchProvider({
        configSource: () => configWith([rule]),
        credentials: fakeCredentials({ TEST_TOKEN: "secret" }),
        logger: silentLogger(),
      });

    const balanced = await providerFor(ruleFor("balanced")).fetch({
      url: `${server.origin}/pages/7`,
    });
    expect(balanced.body.content).toContain("# Runbook");
    expect(balanced.body.content).toContain(
      `[schema.png](${server.origin}/download/attachments/7/schema.png?api=v2)`,
    );
    expect(balanced.body.content).not.toContain("[macro: toc");

    const strict = await providerFor(ruleFor("strict")).fetch({
      url: `${server.origin}/pages/7`,
    });
    expect(strict.body.content).toContain("# Runbook");
    expect(strict.body.content).not.toContain("_[");
  });

  test("a Server view-page link under a context path is served end to end", async () => {
    server = await startFixture(
      {},
      {
        body: JSON.stringify({
          id: "112996462",
          title: "Регламент по работе с Git",
          space: { name: "SD" },
          body: { storage: { value: "<p>Одна основная ветка.</p>" } },
        }),
      },
    );
    const rule: AuthenticatedFetchRule = fixtureRule(server.origin, {
      adapter: { type: "confluence" },
      match: {
        schemes: ["http"],
        hosts: ["127.0.0.1"],
        ports: [server.port],
        allowPaths: ["/wiki/**"],
      },
    });
    const provider = new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials: fakeCredentials({ TEST_TOKEN: "secret" }),
      logger: silentLogger(),
    });
    const result = await provider.fetch({
      url: `${server.origin}/wiki/pages/viewpage.action?pageId=112996462`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body.content).toContain("# Регламент по работе с Git");
    expect(result.body.content).toContain("Одна основная ветка.");
    expect(server.requests.map((request) => request.url)).toEqual([
      "/wiki/rest/api/content/112996462?expand=body.storage%2Cspace%2Cversion",
      "/wiki/rest/api/content/112996462/child/attachment?limit=50&expand=version%2Cmetadata",
    ]);
  });
});

describe("adapter configuration", () => {
  test("defaults resolve to none with server flavor", () => {
    const config = resolveConfig(
      configWith([fixtureRule("http://127.0.0.1:1")]),
    );
    expect(config.rules[0]?.adapter).toEqual({
      type: "none",
      jiraFlavor: "server",
      maxAttachments: 50,
      includeComments: false,
      includeLinks: false,
      cleanup: "balanced",
    });
  });

  test("adapter settings resolve with defaults applied", () => {
    const config = resolveConfig(
      configWith([
        fixtureRule("http://127.0.0.1:1", {
          adapter: { type: "jira", includeComments: true },
        }),
      ]),
    );
    expect(config.rules[0]?.adapter).toEqual({
      type: "jira",
      jiraFlavor: "server",
      maxAttachments: 50,
      includeComments: true,
      includeLinks: false,
      cleanup: "balanced",
    });
  });

  test("a confluence rule carries its cleanup level into the adapter settings", () => {
    const config = resolveConfig(
      configWith([
        fixtureRule("http://127.0.0.1:1", {
          adapter: { type: "confluence", cleanup: "strict" },
        }),
      ]),
    );
    expect(config.rules[0]?.adapter.cleanup).toBe("strict");
    expect(
      validateRule(
        fixtureRule("http://127.0.0.1:1", {
          adapter: { type: "confluence", cleanup: "aggressive" as never },
        }),
        0,
      ).some((error) => error.includes("adapter.cleanup")),
    ).toBe(true);
  });

  test("unknown adapter types and flavors are rejected", () => {
    const broken = fixtureRule("http://127.0.0.1:1", {
      adapter: { type: "wiki" as never },
    });
    const errors = validateRule(broken, 0);
    expect(errors.some((error: string) => error.includes("adapter type"))).toBe(
      true,
    );
    const badFlavor = fixtureRule("http://127.0.0.1:1", {
      adapter: { type: "jira", jiraFlavor: "solaris" as never },
    });
    expect(
      validateRule(badFlavor, 0).some((error: string) =>
        error.includes("jiraFlavor"),
      ),
    ).toBe(true);
  });
});
