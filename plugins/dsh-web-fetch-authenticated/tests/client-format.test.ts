/**
 * Unit tests for the settings card's rule-row formatters (SPEC §6.1).
 *
 * The row is narrow and the host is the part an operator reads, so the scheme
 * is printed as a token rather than spelled out (#242).
 */

import { describe, expect, test } from "vitest";
import { originSummary, schemeSummary } from "../src/client/format.js";
import type { AuthenticatedFetchRule } from "../src/types.js";
import { fixtureRule } from "./helpers.js";

function rule(partial: {
  hosts?: string[];
  schemes?: Array<"https" | "http">;
  ports?: number[];
}): AuthenticatedFetchRule {
  return {
    id: "rule-1",
    name: "Jira",
    enabled: true,
    match: {
      hosts: partial.hosts ?? ["jira.example.corp"],
      ...(partial.schemes === undefined ? {} : { schemes: partial.schemes }),
      ...(partial.ports === undefined ? {} : { ports: partial.ports }),
    },
    auth: { type: "none" },
  };
}

describe("scheme token of a rule row", () => {
  test("an omitted list means https only", () => {
    expect(schemeSummary(rule({}))).toBe("https");
  });

  test("a rule that accepts either scheme prints the compact token", () => {
    expect(schemeSummary(rule({ schemes: ["https", "http"] }))).toBe("http(s)");
    expect(schemeSummary(rule({ schemes: ["http", "https"] }))).toBe("http(s)");
  });

  test("a single scheme keeps its own name", () => {
    expect(schemeSummary(rule({ schemes: ["https"] }))).toBe("https");
    expect(schemeSummary(rule({ schemes: ["http"] }))).toBe("http");
  });
});

describe("origin summary", () => {
  test("hosts and ports follow the scheme token", () => {
    expect(
      originSummary(
        rule({ hosts: ["jira.example.corp"], schemes: ["https", "http"] }),
      ),
    ).toBe("http(s)://jira.example.corp");
    expect(
      originSummary(
        rule({
          hosts: ["jira.example.corp", "jira-backup.example.corp"],
          schemes: ["https"],
          ports: [443, 8443],
        }),
      ),
    ).toBe("https://jira.example.corp, jira-backup.example.corp:443|8443");
  });

  test("the row never spells out both schemes", () => {
    for (const schemes of [["https"], ["http"], ["https", "http"]] as Array<
      Array<"https" | "http">
    >) {
      const text = originSummary(rule({ schemes }));
      expect(text).not.toContain("https/http");
      expect(text).not.toContain("http/https");
    }
  });

  test("a fixture rule keeps its origin readable", () => {
    const fixture = fixtureRule("https://jira.example.corp", {
      match: { schemes: ["https"], hosts: ["jira.example.corp"] },
    });
    expect(originSummary(fixture)).toBe("https://jira.example.corp");
  });
});
