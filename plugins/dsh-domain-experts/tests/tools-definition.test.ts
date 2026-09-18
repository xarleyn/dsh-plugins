import { describe, expect, it } from "vitest";
import { createDomainExpertTool } from "../src/host/tools/domain-expert.js";
import { createDomainMemoryTool } from "../src/host/tools/domain-memory.js";
import { createListDomainsTool } from "../src/host/tools/list-domains.js";
import { DomainExpertsError } from "../src/host/errors.js";
import { parseDomainDefinition } from "../src/host/schema.js";
import { harnessOf } from "./tools.helpers.js";

describe("tools: definition shape", () => {
  it("gives every tool a name, a description and a render", () => {
    const harness = harnessOf();
    for (const tool of [
      createListDomainsTool(harness.dependencies),
      createDomainExpertTool(harness.dependencies),
      createDomainMemoryTool(harness.dependencies),
    ]) {
      expect(tool.name).toMatch(/^domain_/u);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(typeof tool.output.render).toBe("function");
      expect(tool.output.schema).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("keeps normalizing a definition the tools will receive", () => {
    expect(parseDomainDefinition({ id: "payments" }, 1).memory.namespace).toBe(
      "domain/payments",
    );
  });

  it("raises a typed domain error for a bad definition before any run", async () => {
    const harness = harnessOf();
    await expect(
      harness.dependencies.requireDefinition("ghost"),
    ).rejects.toThrowError(DomainExpertsError);
  });
});
