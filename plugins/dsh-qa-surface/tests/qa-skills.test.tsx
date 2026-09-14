// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaSkillCatalog } from "../src/client/user-settings/SkillCatalog.js";
import { QaSkillEditor } from "../src/client/user-settings/SkillEditor.js";
import { QaSkillToolPicker } from "../src/client/user-settings/SkillToolPicker.js";
import type { QaSkillValidationState } from "../src/client/user-settings/SkillEditor.js";
import { QaSkillsSettingsPage } from "../src/client/user-settings/SkillsSettingsPage.js";
import {
  diagnosticMessage,
  skillFailureCopy,
} from "../src/client/user-settings/copy.js";
import {
  draftDiagnostics,
  draftFromDocument,
  draftIsDirty,
  skillMatchesQuery,
  skillMetaLine,
} from "../src/client/user-settings/draft.js";
import type { QaBoundSkillApi } from "../src/client/types.js";
import type {
  QaSkillDocument,
  QaSkillSummary,
  QaSkillToolDescriptor,
} from "../src/types.js";

const TOOLS: readonly QaSkillToolDescriptor[] = [
  { name: "read", description: "Read a file", available: true },
  { name: "grep", description: "Search files", available: true },
  { name: "write", description: "Write a file", available: false },
  { name: "jira_transition", description: "", available: false },
];

/** What the Host answers about the draft; tests set the interesting parts. */
function validation(
  overrides: Partial<QaSkillValidationState> = {},
): QaSkillValidationState {
  return {
    preview: `---
name: api-testing
description: Тестирование.
---

1. Шаг
`,
    diagnostics: [],
    pending: false,
    ...overrides,
  };
}

const onDraftChange = vi.fn();

function summary(overrides: Partial<QaSkillSummary> = {}): QaSkillSummary {
  return {
    name: "api-testing",
    description: "Тестирование REST и GraphQL API",
    whenToUse: null,
    modelInvocable: true,
    userInvocable: true,
    allowedTools: ["read"],
    unavailableTools: [],
    resourceCount: 0,
    valid: true,
    diagnostics: [],
    updatedAt: "2026-09-14T10:00:00.000Z",
    revision: "rev-1",
    ...overrides,
  };
}

function skillDocument(
  overrides: Partial<QaSkillDocument> = {},
): QaSkillDocument {
  return {
    ...summary(),
    body: "1. Шаг",
    extraFrontmatter: { license: "MIT" },
    sourcePath: "/workspace/.dsh/skills/api-testing/SKILL.md",
    preview: "",
    ...overrides,
  };
}

function api(
  options: {
    readonly skills?: readonly QaSkillSummary[];
    readonly documents?: Readonly<Record<string, QaSkillDocument>>;
    readonly tools?: readonly QaSkillToolDescriptor[];
    readonly listFails?: string;
  } = {},
): {
  readonly api: QaBoundSkillApi;
  readonly created: unknown[];
  readonly updated: unknown[];
  readonly removed: unknown[];
  readonly validated: unknown[];
} {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const removed: unknown[] = [];
  const validated: unknown[] = [];
  // The catalog follows the writes, the way the Host's does.
  const state = { skills: [...(options.skills ?? [])] };
  const documents = options.documents ?? {};
  return {
    created,
    updated,
    removed,
    validated,
    api: {
      list: async () =>
        options.listFails === undefined
          ? { ok: true, value: state.skills }
          : { ok: false, error: new Error(`(reason: ${options.listFails})`) },
      get: async (name) =>
        documents[name] === undefined
          ? { ok: false, error: new Error("(reason: skill-not-found)") }
          : { ok: true, value: documents[name] },
      create: async (input) => {
        created.push(input);
        state.skills = [...state.skills, summary({ name: input.name })];
        return { ok: true, value: skillDocument({ name: input.name }) };
      },
      update: async (name, input) => {
        updated.push({ name, input });
        return { ok: true, value: skillDocument({ name: input.name }) };
      },
      remove: async (name, expectedRevision) => {
        removed.push({ name, expectedRevision });
        state.skills = state.skills.filter((skill) => skill.name !== name);
        return { ok: true, value: { name, trashed: true } };
      },
      tools: async () => ({ ok: true, value: options.tools ?? TOOLS }),
      validate: async (_name, input) => {
        validated.push(input);
        return {
          ok: true,
          value: {
            preview: `---
name: ${input.name}
---
`,
            diagnostics: [],
          },
        };
      },
    },
  };
}

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

describe("skill catalog", () => {
  it("renders rows with their invocation, command and tool count", () => {
    render(
      <QaSkillCatalog
        skills={[
          summary(),
          summary({
            name: "jira-investigation",
            description: "Поиск и анализ Jira-задач",
            modelInvocable: false,
            userInvocable: false,
            allowedTools: ["read", "grep", "write"],
            unavailableTools: ["write"],
          }),
        ]}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("api-testing")).toBeTruthy();
    expect(screen.getByText("Авто · /api-testing · 1 инструмент")).toBeTruthy();
    expect(screen.getByText("Только вручную · 3 инструмента")).toBeTruthy();
    expect(screen.getByText("1 инструмент недоступен сейчас")).toBeTruthy();
  });

  it("offers the empty state and the first-skill action", () => {
    const onCreate = vi.fn();
    render(
      <QaSkillCatalog
        skills={[]}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onCreate={onCreate}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("У вас пока нет навыков.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Создать первый навык" }),
    );
    expect(onCreate).toHaveBeenCalled();
  });

  it("filters by the search box and says when nothing matches", () => {
    render(
      <QaSkillCatalog
        skills={[summary(), summary({ name: "jira-investigation" })]}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Поиск навыков"), {
      target: { value: "jira" },
    });
    expect(screen.queryByText("api-testing")).toBeNull();
    expect(screen.getByText("jira-investigation")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Поиск навыков"), {
      target: { value: "nothing" },
    });
    expect(screen.getByText(/Ничего не найдено/u)).toBeTruthy();
  });

  it("marks a skill the Host could not parse", () => {
    render(
      <QaSkillCatalog
        skills={[
          summary({
            valid: false,
            diagnostics: [
              {
                code: "frontmatter-missing",
                severity: "error",
                field: null,
                detail: null,
              },
            ],
          }),
        ]}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText(/нет блока frontmatter/u)).toBeTruthy();
  });

  it("shows a load failure with a way to retry", () => {
    const onReload = vi.fn();
    render(
      <QaSkillCatalog
        skills={[]}
        loading={false}
        error="Хранилище навыков недоступно."
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onReload={onReload}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Хранилище навыков недоступно.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(onReload).toHaveBeenCalled();
  });
});

describe("skill tool picker", () => {
  it("groups availability, searches and applies a selection", () => {
    const onApply = vi.fn();
    render(
      <QaSkillToolPicker
        open
        tools={TOOLS}
        toolsError={null}
        selected={["read"]}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Доступные сейчас")).toBeTruthy();
    expect(screen.getByText("Недоступные в этой конфигурации")).toBeTruthy();
    expect(screen.getByText("Выбрано: 1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Поиск инструментов"), {
      target: { value: "jira" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /jira_transition/u }));
    expect(screen.getByText("Выбрано: 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(onApply).toHaveBeenCalledWith(["read", "jira_transition"]);
  });

  it("clears a tool that was selected", () => {
    const onApply = vi.fn();
    render(
      <QaSkillToolPicker
        open
        tools={TOOLS}
        toolsError={null}
        selected={["read", "grep"]}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /^read/u }));
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(onApply).toHaveBeenCalledWith(["grep"]);
  });
});

describe("skill editor", () => {
  it("seeds every field and reports the tool availability in the chips", () => {
    render(
      <QaSkillEditor
        mode="edit"
        document={skillDocument({ allowedTools: ["read", "write"] })}
        validation={validation()}
        onDraftChange={onDraftChange}
        tools={TOOLS}
        toolsError={null}
        saving={false}
        error={null}
        conflict={false}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe(
      "api-testing",
    );
    expect(
      (screen.getByLabelText("Инструкции") as HTMLTextAreaElement).value,
    ).toBe("1. Шаг");
    expect(screen.getByText("2 выбрано")).toBeTruthy();
    // A declared tool the session cannot reach stays visible and flagged.
    expect(
      screen.getByText(/Инструмент write сейчас недоступен/u),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Убрать инструмент write" }),
    ).toBeTruthy();
  });

  it("blocks a save the Host would refuse and explains why", () => {
    render(
      <QaSkillEditor
        mode="create"
        document={null}
        validation={validation()}
        onDraftChange={onDraftChange}
        tools={TOOLS}
        toolsError={null}
        saving={false}
        error={null}
        conflict={false}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Укажите название навыка.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Новый Навык" },
    });
    expect(screen.getByText(/только строчные латинские/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "brand-new" },
    });
    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Что делает навык." },
    });
    expect(
      (screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("sends the draft with the revision it read", () => {
    const onSave = vi.fn();
    render(
      <QaSkillEditor
        mode="edit"
        document={skillDocument()}
        validation={validation()}
        onDraftChange={onDraftChange}
        tools={TOOLS}
        toolsError={null}
        saving={false}
        error={null}
        conflict={false}
        onBack={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Новое описание." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "api-testing",
        description: "Новое описание.",
        expectedRevision: "rev-1",
      }),
    );
  });

  it("previews the file the serializer would write, preserving foreign fields", () => {
    render(
      <QaSkillEditor
        mode="edit"
        document={skillDocument()}
        validation={validation()}
        onDraftChange={onDraftChange}
        tools={TOOLS}
        toolsError={null}
        saving={false}
        error={null}
        conflict={false}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Показать" }));
    // The panel renders what the Host serialized, byte for byte; the stored
    // foreign frontmatter is shown beside it as preserved.
    expect(screen.getByText(/license/u).textContent).toContain("MIT");
    const preview = screen.getByText(
      (_, element) =>
        element?.tagName === "PRE" &&
        (element.textContent?.includes("description: Тестирование.") ?? false),
    );
    expect(preview.textContent).toContain("name: api-testing");
    expect(
      screen.getByText("/workspace/.dsh/skills/api-testing/SKILL.md"),
    ).toBeTruthy();
  });

  it("asks before leaving with unsaved changes", () => {
    const onBack = vi.fn();
    render(
      <QaSkillEditor
        mode="edit"
        document={skillDocument()}
        validation={validation()}
        onDraftChange={onDraftChange}
        tools={TOOLS}
        toolsError={null}
        saving={false}
        error={null}
        conflict={false}
        onBack={onBack}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    // An untouched editor leaves without a word; an edited one asks first.
    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Правка." },
    });
    fireEvent.click(screen.getByRole("button", { name: "← Навыки" }));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText(/несохранённые изменения/u)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Выйти без сохранения" }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("confirms a delete before removing the skill", () => {
    const onDelete = vi.fn();
    render(
      <QaSkillEditor
        mode="edit"
        document={skillDocument()}
        validation={validation()}
        onDraftChange={onDraftChange}
        tools={TOOLS}
        toolsError={null}
        saving={false}
        error={null}
        conflict={false}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(
      screen.getByText(/Его можно будет восстановить вручную/u),
    ).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Удалить навык" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("offers to reload after a conflict and can add tools through the picker", () => {
    const onReload = vi.fn();
    render(
      <QaSkillEditor
        mode="edit"
        document={skillDocument()}
        validation={validation()}
        onDraftChange={onDraftChange}
        tools={TOOLS}
        toolsError={null}
        saving={false}
        error="Навык был изменён в другом месте."
        conflict
        onBack={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onReload={onReload}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Перезагрузить текущую версию" }),
    );
    expect(onReload).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Добавить инструменты" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /grep/u }));
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(screen.getByText("2 выбрано")).toBeTruthy();
  });
});

describe("skills settings page", () => {
  it("loads the catalog, opens one skill and saves through the API", async () => {
    const rig = api({
      skills: [summary()],
      documents: { "api-testing": skillDocument() },
    });
    render(<QaSkillsSettingsPage api={rig.api} />);
    expect(await screen.findByText("api-testing")).toBeTruthy();
    fireEvent.click(screen.getByText("api-testing"));
    expect(await screen.findByLabelText("Название")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Обновлённое описание." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => {
      expect(rig.updated).toHaveLength(1);
    });
    expect(rig.updated[0]).toMatchObject({
      name: "api-testing",
      input: { description: "Обновлённое описание." },
    });
  });

  it("creates a skill from the catalog action", async () => {
    const rig = api({ skills: [] });
    render(<QaSkillsSettingsPage api={rig.api} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Создать первый навык" }),
    );
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "fresh-skill" },
    });
    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Совсем новый." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => {
      expect(rig.created).toHaveLength(1);
    });
    expect(rig.created[0]).toMatchObject({
      name: "fresh-skill",
      expectedRevision: null,
    });
  });

  it("returns to the catalog after a delete, and reports a list failure", async () => {
    const rig = api({
      skills: [summary()],
      documents: { "api-testing": skillDocument() },
    });
    render(<QaSkillsSettingsPage api={rig.api} />);
    fireEvent.click(await screen.findByText("api-testing"));
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить навык" }));
    await waitFor(() => {
      expect(rig.removed).toHaveLength(1);
    });
    expect(rig.removed[0]).toMatchObject({
      name: "api-testing",
      expectedRevision: "rev-1",
    });
    expect(await screen.findByText("У вас пока нет навыков.")).toBeTruthy();
  });

  it("shows the refusal copy when the catalog cannot be read", async () => {
    const rig = api({ listFails: "storage-unavailable" });
    render(<QaSkillsSettingsPage api={rig.api} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Хранилище навыков недоступно",
    );
  });
});
