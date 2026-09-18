import { describe, expect, it } from "vitest";
import { createListDomainsTool } from "../src/host/tools/list-domains.js";
import { domainOf } from "./helpers/fakes.js";
import {
  AGENT,
  PAYMENTS,
  call,
  harnessOf,
  renderText,
} from "./tools.helpers.js";

describe("tools: domain_experts_list", () => {
  it("returns enabled domains and nothing else", async () => {
    const harness = harnessOf([
      PAYMENTS,
      domainOf("platform", { enabled: false }),
    ]);
    const tool = createListDomainsTool(harness.dependencies);
    const value = await call(tool, {}, AGENT);
    expect(value["count"]).toBe(1);
    const domains = value["domains"] as Record<string, unknown>[];
    expect(domains).toHaveLength(1);
    expect(Object.keys(domains[0] ?? {}).sort()).toEqual([
      "description",
      "id",
      "name",
    ]);
    expect(JSON.stringify(value)).not.toContain("scope");
    expect(JSON.stringify(value)).not.toContain("domain/payments");
  });

  it("renders a readable list", async () => {
    const harness = harnessOf([PAYMENTS]);
    const tool = createListDomainsTool(harness.dependencies);
    const value = await call(tool, {}, AGENT);
    expect(renderText(tool, {}, value)).toContain(
      "payments: Payments — Settlement.",
    );
  });

  it("renders an explicit empty state", async () => {
    const harness = harnessOf([]);
    const tool = createListDomainsTool(harness.dependencies);
    const value = await call(tool, {}, AGENT);
    expect(renderText(tool, {}, value)).toBe(
      "No domain experts are enabled in this deployment.",
    );
  });
});
