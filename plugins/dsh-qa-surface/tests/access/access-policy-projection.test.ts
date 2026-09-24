import { describe, expect, it } from "vitest";
import { resolveSkillAccess } from "../../src/access/model.js";
import type { QaSkillDescriptor } from "../../src/types.js";
import {
  config,
  descriptor,
  INSTALLED_TOOLS,
} from "./access-policy.helpers.js";

describe("administration skill projection", () => {
  const rows = [
    {
      type: "skill" as const,
      id: "browser-research",
      title: "browser-research",
      source: { kind: "filesystem" as const, name: "skill-filesystem" },
      status: "available" as const,
    },
  ];

  function access(overrides = config.skillOverrides) {
    return resolveSkillAccess({
      config: { ...config, skillOverrides: overrides },
      descriptors: new Map<string, QaSkillDescriptor>([
        [
          "browser-research",
          descriptor("browser-research", {
            version: 1,
            audience: { type: "subroles", include: ["analyst"] },
            tools: {
              requires: ["browser_open", "shell"],
              grant: { lifecycle: "session", requireAll: true },
            },
          }),
        ],
      ]),
      rows,
      installedTools: INSTALLED_TOOLS,
    });
  }

  it("reports the declared audience next to the effective one", () => {
    const [skill] = access();
    expect(skill?.visibleTo).toEqual(["analyst"]);
    expect(
      skill?.roles.find(({ roleId }) => roleId === "analyst"),
    ).toMatchObject({
      declared: true,
      visible: true,
      grantableTools: ["browser_open"],
      unavailableTools: ["shell"],
    });
  });

  it("blocks a strict skill whose required tool is unavailable", () => {
    const [skill] = access();
    expect(skill?.health).toBe("blocked");
    expect(skill?.tools.find(({ id }) => id === "shell")).toMatchObject({
      installed: false,
      grantableBy: [],
      blockedFor: ["analyst"],
    });
  });

  it("marks an administrator overlay as overriding", () => {
    const [skill] = access([
      { skillName: "browser-research", addToSubroles: ["developer"] },
    ]);
    expect(skill?.overridden).toBe(true);
    expect(skill?.visibleTo).toEqual(["analyst", "developer"]);
    expect(
      skill?.roles.find(({ roleId }) => roleId === "developer")?.addedByAdmin,
    ).toBe(true);
  });
});
