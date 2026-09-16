import { describe, expect, it } from "vitest";
import {
  assertValidDomain,
  errorsOf,
  isValidNamespace,
  normalizeDomainDefinition,
  parseDomainDefinition,
  pathProblem,
  summarizeDomain,
  validateDomainDefinition,
} from "../src/host/schema.js";
import { DomainExpertsError } from "../src/host/errors.js";
import { domainOf } from "./helpers/fakes.js";

describe("schema: definition parsing", () => {
  it("fills every field from a sparse input", () => {
    const parsed = parseDomainDefinition({ id: "payments" }, 5_000);
    expect(parsed.id).toBe("payments");
    expect(parsed.name).toBe("payments");
    expect(parsed.enabled).toBe(true);
    expect(parsed.memory.namespace).toBe("domain/payments");
    expect(parsed.delegation.crossDomainMode).toBe("expert-only");
    expect(parsed.delegation.maxDepth).toBe(3);
    expect(parsed.model.inherit).toBe(true);
    expect(parsed.createdAt).toBe(5_000);
  });

  it("keeps the persisted format version", () => {
    expect(parseDomainDefinition({ id: "alpha" }, 1).formatVersion).toBe(1);
  });

  it("normalizes paths, namespaces and duplicate entries", () => {
    const parsed = parseDomainDefinition(
      {
        id: "beta",
        scope: {
          filesystem: {
            primary: ["./services/beta/", "services//beta", "services/beta"],
            sharedReadOnly: [],
            denied: [],
          },
        },
        memory: {
          namespace: "/shared/product/",
          sharedReadOnly: ["shared/x", "shared/x"],
        },
        tools: { allow: ["bash", "bash"], deny: [] },
      },
      1,
    );
    expect(parsed.scope.filesystem.primary).toEqual(["services/beta"]);
    expect(parsed.memory.namespace).toBe("shared/product");
    expect(parsed.memory.sharedReadOnly).toEqual(["shared/x"]);
    expect(parsed.tools.allow).toEqual(["bash"]);
  });

  it("defaults an unknown cross-domain mode to expert-only", () => {
    const parsed = parseDomainDefinition(
      { id: "alpha", delegation: { crossDomainMode: "wide-open" } },
      1,
    );
    expect(parsed.delegation.crossDomainMode).toBe("expert-only");
  });
});

describe("schema: semantic validation", () => {
  it("accepts a coherent domain", () => {
    expect(errorsOf(validateDomainDefinition(domainOf("payments")))).toEqual(
      [],
    );
  });

  it("rejects a malformed id and a reserved id", () => {
    expect(
      validateDomainDefinition(domainOf("Payments"))
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.field),
    ).toContain("id");
    expect(
      errorsOf(validateDomainDefinition(domainOf("shared")))[0]?.field,
    ).toBe("id");
  });

  it("requires a name", () => {
    const definition = domainOf("alpha", { name: "   " });
    expect(errorsOf(validateDomainDefinition(definition))[0]?.field).toBe(
      "name",
    );
  });

  it("refuses a template sequence in custom instructions", () => {
    const definition = domainOf("alpha", {
      persona: { instructions: "Act like {{domain.name}}." },
    });
    const issue = errorsOf(validateDomainDefinition(definition))[0];
    expect(issue?.field).toBe("persona.instructions");
    expect(issue?.message).toContain("{{");
  });

  it("rejects absolute, traversing and empty paths", () => {
    const definition = domainOf("alpha", {
      scope: {
        ...domainOf("alpha").scope,
        filesystem: {
          primary: ["/etc/passwd"],
          sharedReadOnly: ["../other/repo"],
          denied: ["  "],
        },
      },
    });
    const fields = errorsOf(validateDomainDefinition(definition)).map(
      (issue) => issue.field,
    );
    expect(fields).toContain("scope.filesystem.primary");
    expect(fields).toContain("scope.filesystem.sharedReadOnly");
    expect(fields).toContain("scope.filesystem.denied");
  });

  it("warns when a path is both allowed and denied", () => {
    const definition = domainOf("alpha", {
      scope: {
        ...domainOf("alpha").scope,
        filesystem: {
          primary: ["services/alpha/**"],
          sharedReadOnly: [],
          denied: ["services/alpha/**"],
        },
      },
    });
    const warning = validateDomainDefinition(definition).find(
      (issue) => issue.severity === "warning",
    );
    expect(warning?.message).toContain("denial wins");
  });

  it("rejects a malformed memory namespace", () => {
    const definition = domainOf("alpha", {
      memory: { namespace: "Domain Alpha", sharedReadOnly: [] },
    });
    expect(errorsOf(validateDomainDefinition(definition))[0]?.field).toBe(
      "memory.namespace",
    );
  });

  it("rejects a tool that is both allowed and denied", () => {
    const definition = domainOf("alpha", {
      tools: { allow: ["bash"], deny: ["bash"] },
    });
    expect(errorsOf(validateDomainDefinition(definition))[0]?.field).toBe(
      "tools.deny",
    );
  });

  it("rejects a non-integer delegation cap", () => {
    const definition = domainOf("alpha", {
      delegation: {
        ...domainOf("alpha").delegation,
        maxDepth: -1,
        maxParallel: 0,
      },
    });
    const fields = errorsOf(validateDomainDefinition(definition)).map(
      (issue) => issue.field,
    );
    expect(fields).toContain("delegation.maxDepth");
    expect(fields).toContain("delegation.maxParallel");
  });

  it("requires a route when the model does not inherit", () => {
    const definition = domainOf("alpha", {
      model: {
        inherit: false,
        provider: "",
        model: "",
        reasoningEffort: "",
        maxTokens: 0,
      },
    });
    expect(errorsOf(validateDomainDefinition(definition))[0]?.field).toBe(
      "model",
    );
  });

  it("throws a typed error for an invalid definition", () => {
    expect(() => {
      assertValidDomain(domainOf("alpha", { name: "" }));
    }).toThrowError(DomainExpertsError);
  });
});

describe("schema: helpers", () => {
  it("classifies path problems", () => {
    expect(pathProblem("")).toBe("empty");
    expect(pathProblem("/abs")).toContain("absolute");
    expect(pathProblem("a/../b")).toContain("..");
    expect(pathProblem("a/b")).toBeNull();
  });

  it("validates namespaces", () => {
    expect(isValidNamespace("domain/payments")).toBe(true);
    expect(isValidNamespace("shared/product_2")).toBe(true);
    expect(isValidNamespace("domain//payments")).toBe(false);
    expect(isValidNamespace("../escape")).toBe(false);
  });

  it("is idempotent under normalization", () => {
    const once = normalizeDomainDefinition(domainOf("alpha"));
    expect(normalizeDomainDefinition(once)).toEqual(once);
  });

  it("summarizes list counts without leaking scope details", () => {
    const definition = domainOf("payments", {
      scope: {
        ...domainOf("payments").scope,
        filesystem: {
          primary: ["a/**", "b/**"],
          sharedReadOnly: ["c/**"],
          denied: ["d/**"],
        },
      },
      memory: {
        namespace: "domain/payments",
        sharedReadOnly: ["shared/product"],
      },
      tools: { allow: ["bash", "domain_delegate"], deny: [] },
    });
    const summary = summarizeDomain(definition, 2);
    expect(summary).toMatchObject({
      id: "payments",
      primaryPaths: 2,
      sharedPaths: 1,
      memoryNamespaces: 2,
      // The configured tool count; the service reports the visible one.
      tools: 2,
      degradations: 2,
    });
    expect(summary).not.toHaveProperty("scope");
    expect(summary).not.toHaveProperty("denied");
  });
});
