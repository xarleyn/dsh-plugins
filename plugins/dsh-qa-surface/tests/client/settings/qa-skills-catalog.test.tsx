// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaSkillCatalog } from "../../../src/client/user-settings/SkillCatalog.js";
import { QaSkillToolPicker } from "../../../src/client/user-settings/SkillToolPicker.js";
import { summary, TOOLS } from "./qa-skills.helpers.js";

/** The catalog row at one place of the list, addressed by its handle. */
function row(at: number): HTMLElement {
  const found = screen.getAllByTestId("qa-settings-skills-row")[at];
  if (found === undefined) throw new Error(`no catalog row at ${String(at)}`);
  return found;
}

/** One line of one row, read through the handle of the row rather than the copy. */
function lineOf(
  target: HTMLElement,
  part: "title" | "meta" | "warning" | "error",
): string {
  return (
    within(target).getByTestId(`qa-settings-skills-row-${part}`).textContent ??
    ""
  );
}

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
    expect(lineOf(row(0), "title")).toBe("api-testing");
    expect(lineOf(row(0), "meta")).toBe("Авто · /api-testing · 1 инструмент");
    expect(lineOf(row(1), "meta")).toBe("Только вручную · 3 инструмента");
    expect(lineOf(row(1), "warning")).toBe("1 инструмент недоступен сейчас");
    // Every row is opened as a button, which is what a run presses.
    expect(within(row(0)).getAllByRole("button")).toHaveLength(1);
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
    expect(
      screen.getByTestId("qa-settings-skills-empty-title").textContent,
    ).toBe("У вас пока нет навыков.");
    const create = screen.getByTestId("qa-settings-skills-empty-create");
    expect(screen.getByRole("button", { name: "Создать первый навык" })).toBe(
      create,
    );
    fireEvent.click(create);
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
    expect(
      screen
        .getAllByTestId("qa-settings-skills-row")
        .map((candidate) => lineOf(candidate, "title")),
    ).toEqual(["jira-investigation"]);
    fireEvent.change(screen.getByLabelText("Поиск навыков"), {
      target: { value: "nothing" },
    });
    expect(
      screen.getByTestId("qa-settings-skills-no-match").textContent,
    ).toContain("Ничего не найдено");
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
    expect(lineOf(row(0), "error")).toContain("нет блока frontmatter");
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
    const retry = screen.getByTestId("qa-settings-skills-list-reload");
    expect(screen.getByRole("button", { name: "Обновить" })).toBe(retry);
    fireEvent.click(retry);
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
    expect(
      screen
        .getAllByTestId("qa-settings-toolpicker-group")
        .map((group) => group.textContent),
    ).toEqual(["Доступные сейчас", "Недоступные в этой конфигурации"]);
    expect(
      screen.getByTestId("qa-settings-toolpicker-selected").textContent,
    ).toBe("Выбрано: 1");
    fireEvent.change(screen.getByLabelText("Поиск инструментов"), {
      target: { value: "jira" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /jira_transition/u }));
    expect(
      screen.getByTestId("qa-settings-toolpicker-selected").textContent,
    ).toBe("Выбрано: 2");
    const apply = screen.getByTestId("qa-settings-toolpicker-apply");
    expect(screen.getByRole("button", { name: "Применить" })).toBe(apply);
    fireEvent.click(apply);
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
    const apply = screen.getByTestId("qa-settings-toolpicker-apply");
    expect(screen.getByRole("button", { name: "Применить" })).toBe(apply);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(["grep"]);
  });
});
