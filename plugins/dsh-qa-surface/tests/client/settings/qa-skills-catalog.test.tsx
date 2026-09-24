// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaSkillCatalog } from "../../../src/client/user-settings/SkillCatalog.js";
import { QaSkillToolPicker } from "../../../src/client/user-settings/SkillToolPicker.js";
import { summary, TOOLS } from "./qa-skills.helpers.js";

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
