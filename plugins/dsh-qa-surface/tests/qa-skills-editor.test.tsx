// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaSkillEditor } from "../src/client/user-settings/SkillEditor.js";
import {
  onDraftChange,
  skillDocument,
  TOOLS,
  validation,
} from "./qa-skills.helpers.js";

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
    // The row's description is clamped to two lines by CSS, so the full text
    // has to stay reachable as the row's title.
    expect(screen.getByTitle("Search files").textContent).toBe("Search files");
    fireEvent.click(screen.getByRole("checkbox", { name: /grep/u }));
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));
    expect(screen.getByText("2 выбрано")).toBeTruthy();
  });
});
