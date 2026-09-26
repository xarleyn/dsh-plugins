// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaSkillEditor } from "../../../src/client/user-settings/SkillEditor.js";
import {
  onDraftChange,
  skillDocument,
  TOOLS,
  validation,
} from "./qa-skills.helpers.js";

/** What the editor says about the draft for one severity. */
function diagnosticCopy(severity: "error" | "warning"): string[] {
  return screen
    .getAllByTestId(`qa-settings-skill-diagnostic-${severity}`)
    .map((node) => node.textContent ?? "");
}

/** The row of one tool of the picker, found by the handle of its name. */
function toolRow(name: string): HTMLElement {
  const row = screen
    .getAllByTestId("qa-settings-toolpicker-row")
    .find(
      (candidate) =>
        within(candidate).getByTestId("qa-settings-toolpicker-row-name")
          .textContent === name,
    );
  if (row === undefined) throw new Error(`no tool row for ${name}`);
  return row;
}

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
    expect(
      screen.getByTestId("qa-settings-skill-tools-count").textContent,
    ).toBe("2 выбрано");
    // A declared tool the session cannot reach stays visible and flagged.
    expect(
      diagnosticCopy("warning").some((text) =>
        text.includes("Инструмент write сейчас недоступен"),
      ),
    ).toBe(true);
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
    const save = screen.getByTestId("qa-settings-skill-save");
    expect(screen.getByRole("button", { name: "Сохранить" })).toBe(save);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(diagnosticCopy("error")).toContain("Укажите название навыка.");
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Новый Навык" },
    });
    expect(
      diagnosticCopy("error").some((text) =>
        text.includes("только строчные латинские"),
      ),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "brand-new" },
    });
    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Что делает навык." },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
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
    // A complete document needs no acknowledgement to save.
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty(
      "confirmPartialOverwrite",
    );
  });

  it("asks before saving over a file the Host only read partly", () => {
    const onSave = vi.fn();
    render(
      <QaSkillEditor
        mode="edit"
        document={skillDocument({
          truncated: true,
          diagnostics: [
            {
              code: "skill-file-truncated",
              severity: "error",
              field: null,
              detail: "307246",
            },
          ],
        })}
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
    // The user is told plainly that the copy in front of them is not the file.
    expect(
      diagnosticCopy("error").some((text) =>
        text.includes("редактор прочитал только его начало"),
      ),
    ).toBe(true);
    fireEvent.click(screen.getByTestId("qa-settings-skill-save"));
    // The first click only asks.
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Стереть непрочитанное и сохранить",
      }),
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: "rev-1",
        confirmPartialOverwrite: true,
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
    expect(
      screen.getByTestId("qa-settings-skill-frontmatter-preview").textContent,
    ).toContain('"license": "MIT"');
    const preview = screen.getByTestId("qa-settings-skill-preview-file");
    expect(preview.textContent).toContain("description: Тестирование.");
    expect(preview.textContent).toContain("name: api-testing");
    expect(
      screen.getByTestId("qa-settings-skill-source").textContent,
    ).toContain("/workspace/.dsh/skills/api-testing/SKILL.md");
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
    fireEvent.click(screen.getByTestId("qa-settings-skill-back"));
    expect(onBack).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("qa-settings-skill-discard").textContent,
    ).toContain("Есть несохранённые изменения.");
    expect(screen.getByRole("button", { name: "← Навыки" })).toBe(
      screen.getByTestId("qa-settings-skill-back"),
    );
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
    fireEvent.click(screen.getByTestId("qa-settings-skill-delete"));
    expect(
      screen.getByTestId("qa-settings-skill-delete-lead").textContent,
    ).toContain("Его можно будет восстановить вручную из корзины.");
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
    fireEvent.click(screen.getByTestId("qa-settings-skill-tools-add"));
    expect(screen.getByRole("button", { name: "Добавить инструменты" })).toBe(
      screen.getByTestId("qa-settings-skill-tools-add"),
    );
    // The row's description is clamped to two lines by CSS, so the full text
    // has to stay reachable as the row's title.
    const description = within(toolRow("grep")).getByTestId(
      "qa-settings-toolpicker-row-description",
    );
    expect(description.getAttribute("title")).toBe("Search files");
    expect(description.textContent).toBe("Search files");
    fireEvent.click(screen.getByRole("checkbox", { name: /grep/u }));
    fireEvent.click(screen.getByTestId("qa-settings-toolpicker-apply"));
    expect(
      screen.getByTestId("qa-settings-skill-tools-count").textContent,
    ).toBe("2 выбрано");
  });
});
