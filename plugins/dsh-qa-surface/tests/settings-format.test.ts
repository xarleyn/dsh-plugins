/**
 * Pure helpers of the QA Surface card: status wording, draft parsing, and the
 * override checks the section markers and the reset action both read.
 */

import { describe, expect, it } from "vitest";

import {
  badgeText,
  describeSandbox,
  describeSessionPolicy,
  formatClock,
  formatCount,
  formatIdentityFields,
  isOverridden,
  mutationLanded,
  overriddenKeys,
  parseCommaList,
  parseIdentityFields,
  parseLineList,
  parseNumberDraft,
  perUserWorkspaceGaps,
  pluralRu,
  readPath,
} from "../src/client/settings/format.js";
import { resolveConfig } from "../src/resolve-config.js";

describe("card status copy", () => {
  it("shows the route while the surface is on and the off state otherwise", () => {
    expect(badgeText(true, "/qa")).toBe("/qa");
    expect(badgeText(undefined, "/q")).toBe("/q");
    expect(badgeText(false, "/qa")).toBe("Выключено");
    expect(badgeText(true, undefined)).toBe("/qa");
  });

  it("names every session policy the schema accepts", () => {
    for (const policy of ["browser-persistent", "new-on-load", "fixed"]) {
      const copy = describeSessionPolicy(policy);
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.hint.length).toBeGreaterThan(0);
    }
    // An absent value renders the composition default rather than a blank.
    expect(describeSessionPolicy(undefined)).toEqual(
      describeSessionPolicy("browser-persistent"),
    );
  });

  it("describes both sandbox modes and defaults to read-only", () => {
    expect(describeSandbox("workspace-write").label).toContain("Запись");
    expect(describeSandbox(undefined).label).toContain("Только чтение");
  });

  it("stamps the clock and groups long counters", () => {
    expect(formatClock(undefined)).toBe("—");
    expect(formatClock(Date.UTC(2026, 0, 1, 12, 30, 15))).toMatch(/\d\d:\d\d/u);
    expect(formatCount(2_000_000)).toContain("000");
  });

  it("counts overrides in the right Russian form", () => {
    const forms = ["ключ", "ключа", "ключей"] as const;
    expect(pluralRu(1, forms)).toBe("1 ключ");
    expect(pluralRu(3, forms)).toBe("3 ключа");
    expect(pluralRu(5, forms)).toBe("5 ключей");
    expect(pluralRu(11, forms)).toBe("11 ключей");
    expect(pluralRu(21, forms)).toBe("21 ключ");
  });
});

describe("draft parsing", () => {
  it("rounds into the control's range and refuses non-numbers", () => {
    expect(parseNumberDraft("900", 480, 1600)).toBe(900);
    expect(parseNumberDraft("100", 480, 1600)).toBe(480);
    expect(parseNumberDraft("9000", 480, 1600)).toBe(1600);
    expect(parseNumberDraft("899.6", 480, 1600)).toBe(900);
    expect(parseNumberDraft("", 480, 1600)).toBeNull();
    expect(parseNumberDraft("abc", 480, 1600)).toBeNull();
  });

  it("keeps commas inside a free-text entry", () => {
    expect(parseLineList("Помоги, пожалуйста\nС чего начать?")).toEqual([
      "Помоги, пожалуйста",
      "С чего начать?",
    ]);
    expect(parseCommaList("read, grep\nglob")).toEqual([
      "read",
      "grep",
      "glob",
    ]);
  });

  it("parses declared identity fields and drops unusable keys", () => {
    expect(formatIdentityFields(parseIdentityFields("jira = Jira"))).toBe(
      "jira = Jira",
    );
    // A missing signature falls back to the key, an unusable key disappears.
    expect(parseIdentityFields("confluence\nJira = Jira\n= пусто")).toEqual([
      { key: "confluence", label: "confluence" },
      { key: "jira", label: "Jira" },
    ]);
  });
});

describe("override bookkeeping", () => {
  it("marks a path present in the user layer, whatever its value", () => {
    const user = { enabled: false, ui: { showHeader: true } };
    expect(isOverridden(user, ["enabled"])).toBe(true);
    expect(isOverridden(user, ["ui", "showHeader"])).toBe(true);
    expect(isOverridden(user, ["ui", "showStop"])).toBe(false);
    expect(isOverridden(user, ["route", "path"])).toBe(false);
    expect(isOverridden(undefined, ["enabled"])).toBe(false);
  });

  it("lists the user layer's top-level keys in a stable order", () => {
    expect(overriddenKeys({ ui: {}, branding: {} })).toEqual([
      "branding",
      "ui",
    ]);
    expect(overriddenKeys(null)).toEqual([]);
    expect(overriddenKeys([1, 2])).toEqual([]);
  });

  it("reads a path out of a section, refusing to walk through scalars", () => {
    const section = { ui: { showReset: false }, session: { cwd: null } };
    expect(readPath(section, ["ui", "showReset"])).toBe(false);
    expect(readPath(section, ["session", "cwd"])).toBeNull();
    expect(readPath(section, ["session", "missing"])).toBeUndefined();
    expect(readPath(section, ["ui", "showReset", "deeper"])).toBeUndefined();
    expect(readPath(undefined, ["ui"])).toBeUndefined();
  });
});

describe("settled mutation check", () => {
  const section = { ui: { showHeader: false }, session: { cwd: null } };

  it("accepts a write the section now holds", () => {
    expect(
      mutationLanded([{ path: ["ui", "showHeader"], value: false }], [], {
        value: section,
        user: undefined,
      }),
    ).toBe(true);
  });

  it("reports a write the section does not hold", () => {
    expect(
      mutationLanded([{ path: ["ui", "showHeader"], value: true }], [], {
        value: section,
        user: undefined,
      }),
    ).toBe(false);
  });

  it("treats absent, null, and empty as the same empty value", () => {
    for (const written of [null, undefined, ""]) {
      expect(
        mutationLanded([{ path: ["session", "cwd"], value: written }], [], {
          value: section,
          user: undefined,
        }),
      ).toBe(true);
    }
  });

  it("accepts a clear only once the user layer dropped the path", () => {
    expect(
      mutationLanded([], [["ui"]], {
        value: section,
        user: { branding: { title: "Помощник" } },
      }),
    ).toBe(true);
    expect(
      mutationLanded([], [["ui"]], { value: section, user: { ui: {} } }),
    ).toBe(false);
  });
});

describe("per-user workspace prerequisites", () => {
  it("names what the default configuration is still missing", () => {
    const gaps = perUserWorkspaceGaps(resolveConfig({}));
    expect(gaps.join(" | ")).toContain("включены аккаунты");
    expect(gaps.join(" | ")).toContain("session.workspaceId");
    expect(gaps.join(" | ")).toContain("запись в рабочее пространство");
  });

  it("reports nothing once the whole chain is configured", () => {
    const config = resolveConfig({
      accounts: { enabled: true, perUserWorkspace: true },
      session: { workspaceId: "workspace-1" },
      lockdown: {
        enabled: true,
        enforceFixedWorkspace: true,
        sandboxMode: "workspace-write",
      },
    });
    expect(perUserWorkspaceGaps(config)).toEqual([]);
  });
});
