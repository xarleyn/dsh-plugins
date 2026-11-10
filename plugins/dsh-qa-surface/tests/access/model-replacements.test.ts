import { describe, expect, it } from "vitest";
import {
  normalizeModelReplacements,
  replaceModelPair,
  resolveModelPolicy,
  assertModelPairAvailable,
} from "../../src/access/model-policy.js";
import { resolveConfig } from "../../src/resolve-config.js";

const old = { provider: "local", model: "old-model", reasoningEffort: "high" };
const next = { provider: "local", model: "new-model" };
const rules = [{ from: old, to: next }];

describe("explicit model replacements", () => {
  it.each(["account", "subrole", "deployment"] as const)(
    "redirects an obsolete %s pin while preserving its layer",
    (layer) => {
      expect(resolveModelPolicy({ [layer]: old }, rules)).toEqual({
        pair: next,
        layer,
        redirectedFrom: old,
      });
    },
  );
  it("keeps unrelated explicit pins and does not merge old reasoning effort into the replacement", () => {
    const account = { provider: "premium", model: "dedicated" };
    expect(resolveModelPolicy({ account, deployment: old }, rules)).toEqual({
      pair: account,
      layer: "account",
    });
    expect(replaceModelPair(old, rules)).toEqual(next);
  });
  it("resolves a configured replacement chain, and still validates the terminal target", () => {
    const terminal = { provider: "local", model: "current-model" };
    const pair = replaceModelPair(old, [
      ...rules,
      { from: next, to: terminal },
    ]);
    expect(pair).toEqual(terminal);
    expect(() =>
      assertModelPairAvailable(pair, [
        { ...next, label: "new", reasoningEfforts: [] },
      ]),
    ).toThrow(/does not offer/);
  });
  it("rejects cycles, duplicate sources and incomplete pairs at configuration load", () => {
    for (const modelReplacements of [
      [...rules, { from: next, to: old }],
      [...rules, { from: old, to: { provider: "other", model: "third" } }],
      [{ from: old, to: { provider: "local", model: "" } }],
    ])
      expect(() => resolveConfig({ session: { modelReplacements } })).toThrow();
    expect(() => normalizeModelReplacements([{ from: old, to: old }])).toThrow(
      /cycle/,
    );
  });
  it("preserves safe legacy defaults when no operator defined a replacement", () => {
    expect(resolveConfig({}).session.modelReplacements).toEqual([]);
    expect(replaceModelPair(old, [])).toBe(old);
    expect(replaceModelPair(undefined, rules)).toBeUndefined();
  });
});
