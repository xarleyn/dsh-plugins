// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  diagnosticMessage,
  skillFailureCopy,
} from "../../../src/client/user-settings/copy.js";
import {
  draftDiagnostics,
  draftFromDocument,
  draftIsDirty,
  skillMatchesQuery,
  skillMetaLine,
} from "../../../src/client/user-settings/draft.js";
import { skillDocument, summary } from "./qa-skills.helpers.js";

describe("skill catalog copy", () => {
  it("composes the meta line and the availability warning", () => {
    expect(skillMetaLine(summary())).toBe("Авто · /api-testing · 1 инструмент");
    expect(
      skillMetaLine(
        summary({
          modelInvocable: false,
          userInvocable: false,
          allowedTools: ["read", "grep"],
        }),
      ),
    ).toBe("Только вручную · 2 инструмента");
  });

  it("searches name, description and whenToUse", () => {
    const skill = summary({ whenToUse: "Когда просят проверить API" });
    expect(skillMatchesQuery(skill, "API")).toBe(true);
    expect(skillMatchesQuery(skill, "rest")).toBe(true);
    expect(skillMatchesQuery(skill, "проверить")).toBe(true);
    expect(skillMatchesQuery(skill, "jira")).toBe(false);
    expect(skillMatchesQuery(skill, "  ")).toBe(true);
  });

  it("turns a wire refusal into audience copy", () => {
    expect(
      skillFailureCopy(new Error("nope (reason: skill-conflict)")),
    ).toContain("изменён в другом месте");
    expect(skillFailureCopy(new Error("boom"))).toContain("Попробуйте ещё раз");
    expect(
      diagnosticMessage({
        code: "tool-unavailable",
        severity: "warning",
        field: "tools",
        detail: "bash",
      }),
    ).toContain("bash");
  });
});

describe("skill draft projection", () => {
  it("validates a draft without a Host round trip", () => {
    const draft = { ...draftFromDocument(skillDocument()), name: "Bad Name" };
    const codes = draftDiagnostics(draft, { availableTools: ["read"] }).map(
      (entry) => entry.code,
    );
    expect(codes).toContain("name-invalid");
  });

  it("reports a declared tool the session cannot use", () => {
    const draft = {
      ...draftFromDocument(skillDocument()),
      allowedTools: ["read", "bash"],
    };
    const codes = draftDiagnostics(draft, {
      availableTools: ["read"],
    }).map((entry) => entry.code);
    expect(codes).toContain("tool-unavailable");
  });

  it("knows when the draft differs from the stored skill", () => {
    const stored = skillDocument();
    expect(draftIsDirty(draftFromDocument(stored), stored)).toBe(false);
    expect(
      draftIsDirty({ ...draftFromDocument(stored), description: "x" }, stored),
    ).toBe(true);
    expect(
      draftIsDirty(
        { ...draftFromDocument(stored), allowedTools: ["read", "grep"] },
        stored,
      ),
    ).toBe(true);
  });
});
