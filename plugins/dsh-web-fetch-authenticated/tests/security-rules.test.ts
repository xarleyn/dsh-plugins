/**
 * Security suite (SPEC §26.2): SSRF targets, lookalike hosts, mixed DNS,
 * redirect credential boundaries, and redaction guarantees. The provider must
 * fail closed in every case; secrets must never appear in thrown errors.
 */

import { describe, expect, test } from "vitest";
import { resolveConfig } from "../src/config.js";
import { validateFetchUrl } from "../src/policy/url.js";
import { matchRules } from "../src/policy/match.js";
import { validateConfig } from "../src/rule-validation.js";
import { configWith, fixtureRule } from "./helpers.js";
import {
  SECRET,
  errorText,
  expectWebError,
  newProvider,
} from "./security.helpers.js";

describe("rule matching fails closed", () => {
  test("substring hostnames never match", () => {
    const rule = fixtureRule("http://127.0.0.1:1", {
      match: { schemes: ["http"], hosts: ["jira.example.corp"] },
    });
    const resolved = resolveConfig(configWith([rule]));
    for (const hostile of [
      "http://jira.example.corp.attacker.com/",
      "http://foojira.example.corp/",
      "http://jira.example.corp.invalid/",
    ]) {
      const url = validateFetchUrl(hostile, 2048);
      expect(matchRules(resolved.rules, url)).toHaveLength(0);
    }
  });

  test("disabled rules do not match", () => {
    const rule = fixtureRule("http://127.0.0.1:1", { enabled: false });
    const resolved = resolveConfig(configWith([rule]));
    const url = validateFetchUrl("http://127.0.0.1:1/secure/x", 2048);
    expect(matchRules(resolved.rules, url)).toHaveLength(0);
  });

  test("no matching rule rejects with AUTH_FETCH_NO_MATCHING_RULE and leaks no credential", async () => {
    const rule = fixtureRule("http://127.0.0.1:1", {
      match: { schemes: ["http"], hosts: ["127.0.0.1"], ports: [1] },
    });
    const { provider } = newProvider(configWith([rule]));
    const error = await expectWebError("AUTH_FETCH_NO_MATCHING_RULE", () =>
      provider.fetch({ url: "http://localhost:1/open" }),
    );
    expect(errorText(error)).not.toContain(SECRET);
  });

  test("ambiguous matches reject with AUTH_FETCH_AMBIGUOUS_MATCH", async () => {
    const rules = [
      fixtureRule("http://127.0.0.1:1", { id: "a" }),
      fixtureRule("http://127.0.0.1:1", { id: "b" }),
    ];
    const { provider } = newProvider(configWith(rules));
    await expectWebError("AUTH_FETCH_AMBIGUOUS_MATCH", () =>
      provider.fetch({ url: "http://127.0.0.1:1/open" }),
    );
  });

  test("rules sharing a host but split by allowPaths stay unambiguous", () => {
    // The configuration warning for a shared host is an over-approximation:
    // path globs are what decide the router at request time (SPEC §24).
    const rules = [
      fixtureRule("http://127.0.0.1:1", {
        id: "browse",
        match: {
          schemes: ["http"],
          hosts: ["127.0.0.1"],
          ports: [1],
          allowPaths: ["/browse/**"],
        },
      }),
      fixtureRule("http://127.0.0.1:1", {
        id: "wiki",
        match: {
          schemes: ["http"],
          hosts: ["127.0.0.1"],
          ports: [1],
          allowPaths: ["/wiki/**"],
        },
      }),
    ];
    const { warnings } = validateConfig(configWith(rules));
    expect(
      warnings.some((text) => text.includes("AUTH_FETCH_AMBIGUOUS_MATCH")),
    ).toBe(true);
    const resolved = resolveConfig(configWith(rules));
    expect(
      matchRules(
        resolved.rules,
        validateFetchUrl("http://127.0.0.1:1/wiki/x", 2048),
      ).map((rule) => rule.source.id),
    ).toEqual(["wiki"]);
    expect(
      matchRules(
        resolved.rules,
        validateFetchUrl("http://127.0.0.1:1/browse/x", 2048),
      ).map((rule) => rule.source.id),
    ).toEqual(["browse"]);
  });
});

describe("configuration validation", () => {
  test("wildcard hosts are rejected in v1", () => {
    const rule = fixtureRule("http://127.0.0.1:1", {
      match: { schemes: ["http"], hosts: ["*.example.corp"] },
    });
    const { errors } = validateConfig(configWith([rule]));
    expect(errors.some((error) => error.includes("wildcard"))).toBe(true);
  });

  test("forbidden header names are rejected", () => {
    const rule = fixtureRule("http://127.0.0.1:1", {
      auth: { type: "header", headerName: "Host", credential: "TEST_TOKEN" },
    });
    const { errors } = validateConfig(configWith([rule]));
    expect(
      errors.some((error) => error.includes("forbidden transport header")),
    ).toBe(true);
  });

  test("malformed CIDRs are rejected", () => {
    const rule = fixtureRule("http://127.0.0.1:1", {
      networkPolicy: { allowLoopback: true, allowedCidrs: ["10.20.0.0/99"] },
    });
    const { errors } = validateConfig(configWith([rule]));
    expect(errors.some((error) => error.includes("CIDR"))).toBe(true);
  });

  test("an ambiguity warning names the shared scope", () => {
    const { warnings } = validateConfig(
      configWith([
        fixtureRule("http://127.0.0.1:1", { id: "a" }),
        fixtureRule("http://127.0.0.1:1", { id: "b" }),
      ]),
    );
    const warning = warnings.find((text) =>
      text.includes("AUTH_FETCH_AMBIGUOUS_MATCH"),
    );
    expect(warning).toBeDefined();
    // The message has to say WHERE the two rules collide: same hosts, same port.
    expect(warning).toContain("127.0.0.1");
    expect(warning).toContain(":1");
  });

  test("disjoint ports on a shared host are not reported as ambiguous", () => {
    const { warnings } = validateConfig(
      configWith([
        fixtureRule("http://127.0.0.1:1", { id: "a" }),
        fixtureRule("http://127.0.0.1:2", { id: "b" }),
      ]),
    );
    expect(
      warnings.some((text) => text.includes("AUTH_FETCH_AMBIGUOUS_MATCH")),
    ).toBe(false);
  });
});
