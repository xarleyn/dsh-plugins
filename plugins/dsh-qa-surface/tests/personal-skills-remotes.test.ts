import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { createQaPersonalSkillRemotes } from "../src/personal-skills/index.js";
import { serviceFor, silentLogger, USER_A } from "./personal-skills.helpers.js";

describe("personal skill remotes", () => {
  function remotesFor(
    workspace: string,
    accounts: {
      readonly user?: string;
    } = {},
  ): ReturnType<typeof createQaPersonalSkillRemotes> {
    const { service } = serviceFor({ workspace });
    const store = {
      requireUser: () => ({ id: accounts.user ?? USER_A }),
    };
    const config = resolveConfig({
      session: { workspaceId: "workspace-1" },
      accounts: { enabled: true, perUserWorkspace: true },
      lockdown: { sandboxMode: "workspace-write" },
      sources: { enabled: false },
    });
    return createQaPersonalSkillRemotes({
      getConfig: () => config,
      logger: silentLogger,
      skills: service,
      accounts: {
        resolve: () => store as never,
        run: (operation: () => unknown) => operation(),
      } as never,
    });
  }

  it("carries a refusal on the shared reason marker", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-skills-remotes-"));
    const remotes = remotesFor(workspace);
    expect(remotes.list("token").skills).toEqual([]);
    const created = remotes.create("token", {
      name: "remote-made",
      description: "Made over the wire.",
      whenToUse: null,
      modelInvocable: true,
      userInvocable: true,
      allowedTools: ["read"],
      body: "Body.",
      expectedRevision: null,
    });
    expect(created.name).toBe("remote-made");
    expect(remotes.get("token", "remote-made").preview).toContain(
      "description: Made over the wire.",
    );
    expect(() => remotes.get("token", "nope")).toThrow(
      /reason: skill-not-found/u,
    );
    expect(() =>
      remotes.update("token", "remote-made", {
        name: "remote-made",
        description: "Stale.",
        whenToUse: null,
        modelInvocable: true,
        userInvocable: true,
        allowedTools: [],
        body: "",
        expectedRevision: "stale",
      }),
    ).toThrow(/reason: skill-conflict/u);
    expect(() =>
      remotes.create("token", {
        name: "Bad Name",
        description: "Invalid.",
        whenToUse: null,
        modelInvocable: true,
        userInvocable: true,
        allowedTools: [],
        body: "",
        expectedRevision: null,
      }),
    ).toThrow(/reason: skill-name-invalid/u);
    expect(remotes.remove("token", "remote-made", null).trashed).toBe(true);
  });
});
