/**
 * The per-account override document: what one account asked for, how it
 * narrows the deployment's plan, and what happens to a file this version cannot
 * read. The plan arithmetic is the part that matters — an account may switch
 * automatic context off, and may never switch on what its deployment disabled.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { InjectionPlan } from "../src/config.js";
import {
  QA_USER_MEMORY_INHERIT,
  QaUserMemorySettingsStore,
  effectiveInjectionPlan,
  hasQaUserOverrides,
  resolveQaUserSettingsPath,
} from "../src/qa/user-settings.js";

const PLAN: InjectionPlan = {
  startupProfile: true,
  stepProfile: true,
  recall: true,
};

const dirs: string[] = [];

function tempStore(): QaUserMemorySettingsStore {
  const dir = mkdtempSync(join(tmpdir(), "ov-qa-settings-"));
  dirs.push(dir);
  return new QaUserMemorySettingsStore(join(dir, "qa-users.json"));
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("effectiveInjectionPlan", () => {
  it("hands every path to the deployment while the account inherits", () => {
    expect(effectiveInjectionPlan(PLAN, QA_USER_MEMORY_INHERIT)).toEqual(PLAN);
    expect(effectiveInjectionPlan(PLAN, undefined)).toEqual(PLAN);
  });

  it("narrows the deployment's plan", () => {
    expect(
      effectiveInjectionPlan(PLAN, {
        autoInject: null,
        profile: null,
        recall: false,
      }),
    ).toEqual({ startupProfile: true, stepProfile: true, recall: false });
  });

  it("treats the master switch as the one switch that silences both paths", () => {
    expect(
      effectiveInjectionPlan(PLAN, {
        autoInject: false,
        profile: null,
        recall: null,
      }),
    ).toEqual({ startupProfile: false, stepProfile: false, recall: false });
    // The granular switches cannot widen the master one.
    expect(
      effectiveInjectionPlan(PLAN, {
        autoInject: false,
        profile: true,
        recall: true,
      }),
    ).toEqual({ startupProfile: false, stepProfile: false, recall: false });
  });

  it("never turns on a path the deployment disabled", () => {
    const disabled: InjectionPlan = {
      startupProfile: false,
      stepProfile: false,
      recall: false,
    };
    expect(
      effectiveInjectionPlan(disabled, {
        autoInject: true,
        profile: true,
        recall: true,
      }),
    ).toEqual(disabled);
  });
});

describe("QaUserMemorySettingsStore", () => {
  it("answers inherit for an account that changed nothing", () => {
    const store = tempStore();
    expect(store.read("account-a")).toEqual(QA_USER_MEMORY_INHERIT);
    expect(hasQaUserOverrides(store.read("account-a"))).toBe(false);
  });

  it("round-trips an override through the file", () => {
    const store = tempStore();
    store.patch("account-a", { recall: false });

    expect(store.read("account-a").recall).toBe(false);
    expect(store.read("account-b")).toEqual(QA_USER_MEMORY_INHERIT);

    const reread = new QaUserMemorySettingsStore(store.path());
    expect(reread.read("account-a").recall).toBe(false);
  });

  it("clears one knob with null and drops the account when nothing is left", () => {
    const store = tempStore();
    store.patch("account-a", { recall: false, profile: false });
    store.patch("account-a", { recall: null });

    expect(store.read("account-a")).toEqual({
      autoInject: null,
      profile: false,
      recall: null,
    });

    store.patch("account-a", { profile: null });
    expect(store.read("account-a")).toEqual(QA_USER_MEMORY_INHERIT);
    expect(readFileSync(store.path(), "utf-8")).not.toContain("account-a");
  });

  it("drops every override on reset", () => {
    const store = tempStore();
    store.patch("account-a", { autoInject: false });
    expect(store.reset("account-a")).toEqual(QA_USER_MEMORY_INHERIT);
    expect(store.read("account-a")).toEqual(QA_USER_MEMORY_INHERIT);
  });

  it("treats a malformed document as an empty one", () => {
    const store = tempStore();
    writeFileSync(store.path(), "{ not json", "utf-8");
    expect(store.read("account-a")).toEqual(QA_USER_MEMORY_INHERIT);
    store.patch("account-a", { recall: false });
    expect(store.read("account-a").recall).toBe(false);
  });

  it("ignores values this version cannot read", () => {
    const store = tempStore();
    writeFileSync(
      store.path(),
      JSON.stringify({
        version: 1,
        users: { "account-a": { recall: "no", profile: true } },
      }),
      "utf-8",
    );
    expect(store.read("account-a")).toEqual({
      autoInject: null,
      profile: true,
      recall: null,
    });
  });

  it("reports a write it could not persist instead of throwing", () => {
    const store = new QaUserMemorySettingsStore(
      join(tmpdir(), "ov-qa-settings-missing", "nested", "qa-users.json"),
    );
    rmSync(join(tmpdir(), "ov-qa-settings-missing"), {
      recursive: true,
      force: true,
    });
    expect(() => store.patch("account-a", { recall: false })).not.toThrow();
    // The in-memory answer still holds for this process.
    expect(store.read("account-a").recall).toBe(false);
  });
});

describe("resolveQaUserSettingsPath", () => {
  it("uses the configured path when one is given", () => {
    expect(resolveQaUserSettingsPath("/tmp/custom.json", {}, "/cwd")).toBe(
      "/tmp/custom.json",
    );
  });

  it("falls back to the DSH home, then to the working directory", () => {
    expect(resolveQaUserSettingsPath("", { DSH_HOME: "/dsh" }, "/cwd")).toBe(
      join("/dsh", "openviking-memory-qa-users.json"),
    );
    expect(resolveQaUserSettingsPath("", {}, "/cwd")).toBe(
      join("/cwd", "openviking-memory-qa-users.json"),
    );
  });
});
