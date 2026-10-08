import { describe, expect, it } from "vitest";
import {
  assertModelPairAvailable,
  deploymentModelPair,
  modelPolicySatisfied,
  normalizeModelPair,
  projectModelCatalog,
  resolveModelPolicy,
} from "../../src/access/model-policy.js";
import {
  normalizeSubrole,
  normalizeUserAccess,
} from "../../src/access/model.js";

/**
 * The policy half of the role system, without the stores around it: what one
 * pair may say, which layer of the deployment says it, and what a session is
 * therefore allowed to be running on.
 */
const CATALOG = projectModelCatalog({
  groups: [
    {
      id: "local",
      name: "Local",
      models: [{ id: "small", name: "Small" }],
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      models: [
        {
          id: "chat",
          name: "Chat",
          reasoning: { efforts: [{ id: "low" }, { id: "high" }] },
        },
      ],
    },
  ],
});

describe("one configured model pair", () => {
  it("is no pair at all when it names neither half", () => {
    expect(normalizeModelPair(undefined, "role")).toBeUndefined();
    expect(
      normalizeModelPair({ provider: "", model: "" }, "role"),
    ).toBeUndefined();
  });

  it("refuses a half pair, because the Host does", () => {
    expect(() =>
      normalizeModelPair({ provider: "local", model: "" }, "role"),
    ).toThrow(/set together/u);
  });

  it("trims what the operator typed", () => {
    expect(
      normalizeModelPair(
        { provider: " local ", model: " small ", reasoningEffort: " " },
        "role",
      ),
    ).toEqual({ provider: "local", model: "small" });
  });

  it("keeps the deployment pair beside the role pairs", () => {
    expect(
      deploymentModelPair({
        provider: "deepseek",
        model: "chat",
        reasoningEffort: null,
      }),
    ).toEqual({ provider: "deepseek", model: "chat" });
    expect(
      deploymentModelPair({
        provider: null,
        model: null,
        reasoningEffort: null,
      }),
    ).toBeUndefined();
  });
});

describe("the layers of one session's policy", () => {
  it("asks the account first, then the role, then the stand", () => {
    const account = { provider: "local", model: "small" };
    const role = { provider: "deepseek", model: "chat" };
    const deployment = { provider: "premium", model: "top" };
    expect(
      resolveModelPolicy({ account, subrole: role, deployment }).pair,
    ).toEqual(account);
    expect(resolveModelPolicy({ subrole: role, deployment }).pair).toEqual(
      role,
    );
    expect(resolveModelPolicy({ deployment }).layer).toBe("deployment");
    expect(resolveModelPolicy({}).pair).toBeUndefined();
  });

  it("takes a whole pair rather than halves of two layers", () => {
    const { pair } = resolveModelPolicy({
      account: { provider: "local", model: "small" },
      subrole: { provider: "deepseek", model: "chat", reasoningEffort: "high" },
    });
    expect(pair).toEqual({ provider: "local", model: "small" });
  });
});

describe("the fixed-model check", () => {
  const role = { provider: "deepseek", model: "chat" };
  const policy = resolveModelPolicy({ subrole: role });

  it("holds the session to its own policy's pair, not to the stand's", () => {
    expect(
      modelPolicySatisfied(policy, {
        provider: "deepseek",
        model: "chat",
      }),
    ).toBe(true);
    // The pair a visitor picked, and the pair another role was given, are both
    // outside this policy.
    expect(
      modelPolicySatisfied(policy, { provider: "local", model: "small" }),
    ).toBe(false);
  });

  it("lets effort stand free when the policy names none", () => {
    expect(
      modelPolicySatisfied(policy, {
        provider: "deepseek",
        model: "chat",
        reasoningEffort: "high",
      }),
    ).toBe(true);
  });

  it("holds effort when the policy names it", () => {
    const pinned = resolveModelPolicy({
      subrole: { provider: "deepseek", model: "chat", reasoningEffort: "low" },
    });
    expect(
      modelPolicySatisfied(pinned, {
        provider: "deepseek",
        model: "chat",
        reasoningEffort: "high",
      }),
    ).toBe(false);
  });

  it("constrains nothing where no layer spoke", () => {
    expect(
      modelPolicySatisfied(resolveModelPolicy({}), {
        provider: "whatever",
        model: "ever",
      }),
    ).toBe(true);
  });
});

describe("the catalog a policy is written against", () => {
  it("lists the pairs the Host offers, with what each takes", () => {
    expect(CATALOG).toEqual([
      {
        provider: "local",
        model: "small",
        label: "Small",
        reasoningEfforts: [],
      },
      {
        provider: "deepseek",
        model: "chat",
        label: "Chat",
        reasoningEfforts: ["low", "high"],
      },
    ]);
  });

  it("accepts a pair it offers and refuses one it does not", () => {
    expect(() =>
      assertModelPairAvailable(
        { provider: "deepseek", model: "chat" },
        CATALOG,
      ),
    ).not.toThrow();
    expect(() =>
      assertModelPairAvailable({ provider: "local", model: "smal" }, CATALOG),
    ).toThrow(/does not offer/u);
  });

  it("names the provider that really offers the model", () => {
    expect(() =>
      assertModelPairAvailable(
        { provider: "deepseek", model: "small" },
        CATALOG,
      ),
    ).toThrow(/only offered by local/u);
  });

  it("stays quiet when the Host offered no catalog to check against", () => {
    expect(() =>
      assertModelPairAvailable({ provider: "x", model: "y" }, []),
    ).not.toThrow();
    expect(() =>
      assertModelPairAvailable({ provider: "x", model: "y" }, undefined),
    ).not.toThrow();
    expect(() => assertModelPairAvailable(undefined, CATALOG)).not.toThrow();
  });
});

describe("the role and account stores carry the pair", () => {
  it("keeps a role's pair, and drops one it does not name", () => {
    const base = {
      id: "support",
      name: "Поддержка",
      enabled: true,
      capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
    };
    expect(
      normalizeSubrole({
        ...base,
        model: { provider: "local", model: "small" },
      }).model,
    ).toEqual({ provider: "local", model: "small" });
    expect("model" in normalizeSubrole(base)).toBe(false);
  });

  it("keeps an account's pair beside its assignment", () => {
    const config = {
      version: 1 as const,
      common: { tools: { always: [], skillGrantable: [] }, skills: [] },
      subroles: [
        normalizeSubrole({
          id: "general",
          name: "General",
          enabled: true,
          capabilities: {
            tools: { always: [], skillGrantable: [] },
            skills: [],
          },
        }),
      ],
      skillOverrides: [],
    };
    expect(
      normalizeUserAccess(
        {
          allowedSubroles: ["general"],
          defaultSubrole: "general",
          model: { provider: "deepseek", model: "chat" },
        },
        config,
      ).model,
    ).toEqual({ provider: "deepseek", model: "chat" });
    expect(
      normalizeUserAccess(
        { allowedSubroles: ["general"], defaultSubrole: "general" },
        config,
      ).model,
    ).toBeUndefined();
  });
});
