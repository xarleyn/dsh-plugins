import { GITLAB_OPERATIONS } from "../src/providers/gitlab/catalog.js";
import {
  GitlabProvider,
  groupAllowed,
  projectAllowed,
} from "../src/providers/gitlab/index.js";
import { BOUNDARY, config, stub } from "./gitlab-service.helpers.js";

describe("GitLab boundary matching", () => {
  it("covers an exact id, an exact path and anything under a listed group", () => {
    expect(projectAllowed(BOUNDARY, "1208")).toBe(true);
    expect(projectAllowed(BOUNDARY, "group/product")).toBe(true);
    expect(projectAllowed(BOUNDARY, "group/platform/api")).toBe(true);
    expect(projectAllowed(BOUNDARY, "group/platform")).toBe(true);
  });

  it("refuses a sibling group, a numeric stranger and a prefix lookalike", () => {
    expect(projectAllowed(BOUNDARY, "group/other/api")).toBe(false);
    expect(projectAllowed(BOUNDARY, "1209")).toBe(false);
    expect(projectAllowed(BOUNDARY, "group/platformish/api")).toBe(false);
    expect(groupAllowed(BOUNDARY, "group/other")).toBe(false);
  });

  it("bounds every project-scoped operation and nothing else", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new GitlabProvider(config(), fetcher);
    for (const [operation, definition] of Object.entries(GITLAB_OPERATIONS)) {
      const kind = provider.resourceBoundaryKind?.(operation);
      if (definition.security.requiresResourceBoundary) {
        expect(kind, operation).toBe("projects");
      } else {
        expect(kind, operation).toBeUndefined();
      }
    }
  });
});
