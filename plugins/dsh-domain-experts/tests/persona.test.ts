import { describe, expect, it } from "vitest";
import { ANSWER_FORMAT, BASE_POLICY, composePersona } from "../src/host/persona.js";
import type { ResolvedExpertProfile } from "../src/types.js";
import { domainOf } from "./helpers/fakes.js";

const REQUEST = {
  task: "Why is the settlement status stale?",
  context: "Reported after the 14:00 batch.",
  output: "root cause and evidence",
  mode: "investigate" as const,
  background: false,
};

function profileOf(overrides: Parameters<typeof domainOf>[1] = {}): {
  readonly definition: ReturnType<typeof domainOf>;
} {
  return { definition: domainOf("payments", overrides) };
}

function compose(
  overrides: Parameters<typeof domainOf>[1] = {},
  extras: Partial<{
    readonly resources: ResolvedExpertProfile["resources"];
    readonly memory: ResolvedExpertProfile["memory"];
    readonly snippets: Parameters<typeof composePersona>[0]["memorySnippets"];
    readonly delegation: ResolvedExpertProfile["delegation"];
  }> = {},
): string {
  const { definition } = profileOf(overrides);
  return composePersona({
    definition,
    resources: extras.resources ?? [],
    memory: extras.memory ?? [
      { namespace: "domain/payments", access: "read-write", enforcement: "enforced", provider: "namespace", note: "" },
    ],
    memorySnippets: extras.snippets ?? [],
    delegation: extras.delegation ?? {
      mode: "expert-only",
      allowCrossDomain: true,
      targets: [],
      maxDepth: 3,
      maxParallel: 3,
      peers: [],
    },
    request: REQUEST,
    callerDomain: null,
    depth: 1,
  });
}

describe("persona: composition", () => {
  it("always starts from the fixed base policy", () => {
    const persona = compose();
    expect(persona.startsWith(BASE_POLICY)).toBe(true);
    expect(persona).toContain('expert for the "payments" domain');
  });

  it("appends custom instructions without letting them replace the policy", () => {
    const persona = compose({ persona: { instructions: "Always cite the ledger table." } });
    expect(persona).toContain("## Domain-specific instructions");
    expect(persona).toContain("Always cite the ledger table.");
    expect(persona).toContain(BASE_POLICY);
  });

  it("orders the sections the design asks for", () => {
    const persona = compose({ description: "Payment processing and settlement." });
    const order = [
      "## Domain",
      "## Scope",
      "## Remembered context",
      "## Delegation",
      "## Task",
      "## Answer format",
    ].map((heading) => persona.indexOf(heading));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("renders the three resource classes and marks advisory entries", () => {
    const persona = compose({}, {
      resources: [
        { path: "services/payments/**", class: "primary", enforcement: "enforced", enforcedBy: ["code_worker"], provider: "filesystem", note: "" },
        { path: "packages/common/**", class: "shared", enforcement: "advisory", enforcedBy: [], provider: "filesystem", note: "" },
        { path: "services/inventory/**", class: "denied", enforcement: "advisory", enforcedBy: [], provider: "filesystem", note: "" },
      ],
    });
    expect(persona).toContain("Owned by this domain:");
    expect(persona).toContain("- services/payments/**");
    expect(persona).toContain("- packages/common/** (preference only)");
    expect(persona).toContain("Outside this domain — do not use:");
  });

  it("includes recalled memory with its namespace and key", () => {
    const persona = compose({}, {
      snippets: [
        {
          namespace: "domain/payments",
          key: "batch-cutoff",
          text: "The 14:00 batch is the settlement cutoff.",
          tags: [],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    expect(persona).toContain("Notes recorded earlier");
    expect(persona).toContain("[domain/payments/batch-cutoff]");
  });

  it("tells an expert with cross-domain access to ask the owning expert", () => {
    const persona = compose();
    expect(persona).toContain("Cross-domain mode: expert-only");
    expect(persona).toContain("domain_delegate");
    expect(persona).toContain("do not read its memory or resources yourself");
  });

  it("states the refusal when cross-domain access is disabled", () => {
    const persona = compose({}, {
      delegation: {
        mode: "disabled",
        allowCrossDomain: false,
        targets: [],
        maxDepth: 3,
        maxParallel: 3,
        peers: [],
      },
    });
    expect(persona).toContain("Cross-domain access is disabled for you");
  });

  it("mentions direct cross-domain reads only in direct-read mode", () => {
    const limited = compose();
    expect(limited).not.toContain("foreign memory namespaces explicitly configured");
    const direct = compose({}, {
      delegation: {
        mode: "direct-read",
        allowCrossDomain: true,
        targets: [],
        maxDepth: 3,
        maxParallel: 3,
        peers: [],
      },
    });
    expect(direct).toContain("foreign memory namespaces explicitly configured");
  });

  it("frames the task according to the requested mode", () => {
    const { definition } = profileOf();
    const review = composePersona({
      definition,
      resources: [],
      memory: [],
      memorySnippets: [],
      delegation: {
        mode: "disabled",
        allowCrossDomain: false,
        targets: [],
        maxDepth: 0,
        maxParallel: 1,
        peers: [],
      },
      request: { ...REQUEST, mode: "review" },
      callerDomain: "inventory",
      depth: 2,
    });
    expect(review).toContain("Review the following");
    expect(review).toContain("asked by the \"inventory\" expert");
  });

  it("never emits a template sequence", () => {
    const persona = compose();
    expect(persona.includes("{{")).toBe(false);
    expect(ANSWER_FORMAT.includes("{{")).toBe(false);
  });

  it("refuses to compose from instructions that carry a template sequence", () => {
    expect(() => compose({ persona: { instructions: "Use {{secret}}" } })).toThrowError(
      /template sequence/u,
    );
  });

  it("clamps an oversized task", () => {
    const { definition } = profileOf();
    const persona = composePersona({
      definition,
      resources: [],
      memory: [],
      memorySnippets: [],
      delegation: {
        mode: "disabled",
        allowCrossDomain: false,
        targets: [],
        maxDepth: 0,
        maxParallel: 1,
        peers: [],
      },
      request: { ...REQUEST, task: "x".repeat(40_000) },
      callerDomain: null,
      depth: 1,
    });
    expect(persona.length).toBeLessThan(70_000);
    expect(persona).toContain("…");
  });
});
