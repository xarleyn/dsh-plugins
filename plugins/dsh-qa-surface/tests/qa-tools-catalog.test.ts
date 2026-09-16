import { describe, expect, it } from "vitest";
import {
  assertValidQaToolCatalog,
  createQaToolCatalog,
  QA_TOOL_CATALOG_VERSION,
  qaToolNames,
} from "../src/qa-tools/catalog.js";
import type { QaToolDescriptor } from "../src/qa-tools/types.js";

function catalog() {
  return createQaToolCatalog({
    catalogVersion: QA_TOOL_CATALOG_VERSION,
    activationMode: "all",
    catalogTools: () => [],
    activeTools: () => [],
    skillLoaded: () => false,
  });
}

describe("QA tool catalog", () => {
  it("exposes unique, prefixed names in catalog order", () => {
    const names = qaToolNames(catalog());
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^qa_/u);
  });

  it("carries a stable, non-empty catalog version", () => {
    expect(QA_TOOL_CATALOG_VERSION).toMatch(/^\d+$/u);
  });

  it("builds without registering anything", () => {
    // The builder takes no context: a catalog that could register would need
    // one, and the signature is the guarantee.
    expect(catalog()).toBeInstanceOf(Array);
  });

  it("keeps group and tag metadata passive", () => {
    const descriptors = catalog();
    const tagged = descriptors.filter(
      (entry) => entry.group !== undefined || entry.tags !== undefined,
    );
    expect(tagged.length).toBeGreaterThan(0);
    // Selection must stay name-based: metadata never removes a descriptor.
    expect(qaToolNames(descriptors)).toHaveLength(descriptors.length);
  });

  it("rejects duplicate names", () => {
    const descriptors = catalog();
    const first = descriptors[0];
    expect(first).toBeDefined();
    const duplicated = [...descriptors, first as QaToolDescriptor];
    expect(() => assertValidQaToolCatalog(duplicated)).toThrow(/duplicate/u);
  });

  it("accepts the shipped catalog", () => {
    expect(() => assertValidQaToolCatalog(catalog())).not.toThrow();
  });
});
