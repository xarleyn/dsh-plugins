import { describe, expect, it, vi } from "vitest";
import { QaSurface } from "../../src/index.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { slashDraftTarget } from "../../src/slash/draft-target.js";
import { readSourcePrompt } from "../../src/slash/source-prompt.js";
import { harness } from "../access/access-service.helpers.js";
import { readySlash, slashEntry } from "../helpers/slash.js";

const bindings = [
  { skill: "demo-docs", label: "Документация", directory: "demo" },
  { skill: "demo-library", label: "Справочник", directory: "demo-library" },
  { skill: "withheld", label: "Скрытый проект", directory: "withheld" },
  { skill: "own-notes", label: "Личные записи", directory: "own-notes" },
  { skill: "company", label: "Автоматический навык", directory: "company" },
];

async function setup() {
  const h = harness();
  h.tools.add("qa_read_selected_source");
  for (const { skill } of bindings.filter((b) => b.skill !== "company")) {
    h.skills.set(skill, {
      name: skill,
      description: "Demo",
      provider: "demo",
      source: skill === "own-notes" ? "qa-user" : "runtime",
      invocation: { userInvocable: true, modelInvocable: false },
    });
  }
  const role = {
    id: "reader",
    name: "Reader",
    enabled: true,
    capabilities: {
      tools: { always: ["qa_read_selected_source"], skillGrantable: [] },
      skills: ["demo-docs", "demo-library", "company"],
    },
  };
  await h.service.createSubrole(h.admin.token, role);
  await h.service.updateAssignment(h.admin.token, h.user.user.id, {
    allowedSubroles: ["reader"],
    defaultSubrole: "reader",
  });
  const catalog = readySlash(
    bindings
      .filter((b) => b.skill !== "withheld")
      .map((b) =>
        slashEntry("skill", b.skill, { modelInvocable: b.skill === "company" }),
      ),
    { deniedSkills: ["withheld", "ordinary-skill"] },
  );
  const nativeCatalog = vi.fn(async () => catalog);
  const transport = vi.fn(async () => ({}));
  const execute = vi.fn(async () => ({}));
  const config = {
    accounts: { enabled: true, perUserWorkspace: true },
    searchSources: bindings,
  };
  const admit = vi.fn();
  const surface = Object.assign(Object.create(QaSurface.prototype), {
    getConfig: () =>
      resolveConfig({
        ...config,
        slashCommands: { skills: { mode: "all" } },
        accounts: {
          ...config.accounts,
          perUserWorkspace: config.accounts.enabled,
        },
        session: { workspaceId: "demo" },
        lockdown: config.accounts.enabled
          ? {
              enabled: true,
              sandboxMode: "workspace-write",
              allowSlashCommands: true,
            }
          : {},
      }),
    source: () => config,
    access: h.service,
    sourceTurns: {
      admit,
      drop: vi.fn(),
      submit: (
        _session: string,
        _match: unknown,
        run: () => Promise<unknown>,
      ) => run(),
    },
    sharing: () => ({
      owner: (token: string) => ({ actorId: h.accounts.currentUser(token).id }),
    }),
    logger: { debug: vi.fn() },
    slashRemotes: { catalog: nativeCatalog, execute },
    chatTransport: {
      prompt: async (
        _token: string,
        _request: unknown,
        _signal: AbortSignal,
        authorize: () => Promise<void>,
      ) => {
        await authorize();
        return transport();
      },
      updateQueue: async (
        _token: string,
        _request: unknown,
        authorize: () => Promise<void>,
      ) => {
        await authorize();
        return transport();
      },
    },
  }) as QaSurface;
  return { ...h, surface, config, nativeCatalog, transport, execute, admit };
}

describe("search source admission", () => {
  it("projects only manual, granted source metadata for the account's role and the admin role preview", async () => {
    const h = await setup();
    try {
      const target = slashDraftTarget("reader", false);
      const view = await h.surface.slashCatalog(h.user.token, target);
      expect(view.entries.map((e) => e.searchSource)).toEqual([
        { label: "Документация" },
        { label: "Справочник" },
      ]);
      expect(view.deniedSkills).toEqual(["ordinary-skill"]);
      expect(
        (
          await h.surface.slashCatalog(
            h.admin.token,
            slashDraftTarget("reader", true),
          )
        ).entries,
      ).toEqual(view.entries);
      expect(
        (
          await h.surface.slashCatalog(
            h.user.token,
            slashDraftTarget("reader", true),
          )
        ).entries,
      ).toEqual([]);
      await h.service.updateAssignment(h.admin.token, h.user.user.id, {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
      });
      expect(
        (await h.surface.slashCatalog(h.user.token, target)).entries,
      ).toEqual([]);
      h.config.accounts.enabled = false;
      expect(
        (
          await h.surface.slashCatalog(
            h.admin.token,
            slashDraftTarget("reader", true),
          )
        ).entries,
      ).toEqual([]);
      expect(h.surface.getConfig()).not.toHaveProperty("searchSources");
    } finally {
      h.accounts.close();
    }
  });
  it("uses other assigned roles for the source menu and refreshes the grant on each read", async () => {
    const h = await setup();
    try {
      // The chat's native palette never listed the other role's skills.
      h.nativeCatalog.mockResolvedValue(readySlash([]));
      await h.service.updateAssignment(h.admin.token, h.user.user.id, {
        allowedSubroles: ["general", "reader"],
        defaultSubrole: "general",
      });
      h.service.reserveSession(h.user.token, "saved", "general", false);
      for (const target of [slashDraftTarget("general", false), "saved"]) {
        const view = await h.surface.slashCatalog(h.user.token, target);
        expect(view.entries.map(({ name }) => name)).toEqual([
          "demo-docs",
          "demo-library",
        ]);
      }
      expect(
        (
          await h.surface.slashCatalog(
            h.admin.token,
            slashDraftTarget("general", true),
          )
        ).entries,
      ).toEqual([]);
      const prompt = (text: string) =>
        h.surface.chatPrompt(
          h.user.token,
          { sessionId: "saved", content: [{ type: "text", text }] } as never,
          new AbortController().signal,
        );
      await prompt("Обычный вопрос");
      expect(h.admit).not.toHaveBeenCalled();
      const text =
        "/demo-docs\nИсточник поиска: Документация\n\nНайти документ";
      await prompt(text);
      const grant = h.admit.mock.lastCall?.[0];
      expect(grant.role).toBe("general");
      await expect(grant.verify()).resolves.toBeUndefined();
      await h.service.updateAssignment(h.admin.token, h.user.user.id, {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
      });
      expect(
        (await h.surface.slashCatalog(h.user.token, "saved")).entries,
      ).toEqual([]);
      await expect(grant.verify()).rejects.toThrow();
      await expect(prompt(text)).rejects.toThrow("Источник поиска");
    } finally {
      h.accounts.close();
    }
  });
  it("rechecks typed, embedded and Fast gestures on submit, including restored stale receipts", async () => {
    const h = await setup();
    try {
      h.service.reserveSession(h.user.token, "saved", "reader", false);
      const prompt = (text: string) =>
        h.surface.chatPrompt(
          h.user.token,
          { sessionId: "saved", content: [{ type: "text", text }] } as never,
          new AbortController().signal,
        );
      const text =
        "/demo-docs\nИсточник поиска: Документация\n\nНайти документ";
      expect(readSourcePrompt(text)?.question).toBe("Найти документ");
      await prompt(text);
      const grant = h.admit.mock.lastCall?.[0];
      await expect(grant.verify()).resolves.toBeUndefined();
      const shared = h.skills.get("demo-docs")!;
      h.skills.set("demo-docs", { ...shared, source: "qa-user" });
      await expect(prompt(text)).rejects.toThrow("Источник поиска");
      h.skills.set("demo-docs", shared);
      await expect(prompt("Поиск /demo-docs /demo-library")).rejects.toThrow(
        "Источник поиска",
      );
      await expect(
        prompt(text.replace("Документация", "Чужой")),
      ).rejects.toThrow("Источник поиска");
      await h.service.updateAssignment(h.admin.token, h.user.user.id, {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
      });
      await expect(grant.verify()).rejects.toThrow();
      await expect(prompt("Поиск /demo-docs")).rejects.toThrow(
        "Источник поиска",
      );
      await expect(
        h.surface.slashExecute(h.user.token, "saved", "/no-review " + text, []),
      ).rejects.toThrow("Источник поиска");
      expect(h.execute).not.toHaveBeenCalled();
      await expect(
        h.surface.chatUpdateQueue(h.user.token, {
          sessionId: "saved",
          itemId: "queued",
          action: { kind: "edit", content: [{ type: "text", text }] },
        } as never),
      ).rejects.toThrow("Источник поиска");
      h.config.searchSources = [];
      await expect(prompt(text)).rejects.toThrow("Источник поиска");
      await prompt("Обычный вопрос");
      expect(h.transport).toHaveBeenCalledTimes(2);
    } finally {
      h.accounts.close();
    }
  });
});
