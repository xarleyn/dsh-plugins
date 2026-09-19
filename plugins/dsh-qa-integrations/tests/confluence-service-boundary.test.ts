import { resolveConfig } from "../src/config.js";
import {
  CONFLUENCE_OPERATIONS,
  CONFLUENCE_RESOURCE_KIND,
} from "../src/providers/confluence/catalog.js";
import {
  ConfluenceProvider,
  spaceInBoundary,
} from "../src/providers/confluence/index.js";
import { COMPANY, SANDBOX, config, stub } from "./confluence/shared.js";

/** Two listed spaces, the keys the operations and the CQL address them by. */
const BOUNDARY = Object.freeze({
  spaces: Object.freeze(["ENG", "PROD"]),
});

describe("Confluence service boundary", () => {
  it("covers a listed key in any case, and refuses a stranger", () => {
    expect(spaceInBoundary(BOUNDARY, "ENG")).toBe(true);
    expect(spaceInBoundary(BOUNDARY, "eng")).toBe(true);
    expect(spaceInBoundary(BOUNDARY, " prod ")).toBe(true);
    expect(spaceInBoundary(BOUNDARY, "SECRET")).toBe(false);
    // A prefix lookalike is not a listing.
    expect(spaceInBoundary(BOUNDARY, "ENGX")).toBe(false);
    // A row whose space cannot be read at all fails closed.
    expect(spaceInBoundary(BOUNDARY, undefined)).toBe(false);
    expect(spaceInBoundary(BOUNDARY, "")).toBe(false);
  });

  it("bounds every space-scoped operation and nothing else", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new ConfluenceProvider(config(), fetcher);
    const unscoped = new Set(["connection.get"]);
    for (const [operation, definition] of Object.entries(
      CONFLUENCE_OPERATIONS,
    )) {
      const kind = provider.resourceBoundaryKind?.(operation);
      if (definition.security.requiresResourceBoundary) {
        expect(kind, operation).toBe(CONFLUENCE_RESOURCE_KIND);
      } else {
        expect(kind, operation).toBeUndefined();
        expect(unscoped.has(operation), operation).toBe(true);
      }
    }
  });

  it("asks about its sites the same way the connect form does", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const both = new ConfluenceProvider(config(), fetcher);
    expect(both.instancePortal("company")).toBe(COMPANY.baseUrl);
    expect(both.instancePortal("sandbox")).toBe(SANDBOX.baseUrl);
    expect(both.instancePortal("elsewhere")).toBeUndefined();
    // An empty id means "the only site"; with two there is nothing to default to.
    expect(both.instancePortal("")).toBeUndefined();
    const single = new ConfluenceProvider(
      resolveConfig({ confluence: { instances: [COMPANY] } }),
      fetcher,
    );
    expect(single.instancePortal("")).toBe(COMPANY.baseUrl);
  });
});
