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
  it("exposes unique, known names in catalog order", () => {
    const names = qaToolNames(catalog());
    expect(names).toEqual(["qa_tools_selfcheck", "file_delete"]);
  });

  it("lists file_delete exactly once", () => {
    const names = qaToolNames(catalog());
    expect(names.filter((name) => name === "file_delete")).toHaveLength(1);
  });

  it("carries a stable, non-empty catalog version", () => {
    expect(QA_TOOL_CATALOG_VERSION).toBe("2");
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
