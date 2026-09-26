// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QaSkillsSettingsPage } from "../../../src/client/user-settings/SkillsSettingsPage.js";
import { api, skillDocument, summary } from "./qa-skills.helpers.js";

/** The catalog row of one skill, once the page has read the list. */
async function skillRow(name: string): Promise<HTMLElement> {
  await waitFor(() =>
    expect(screen.queryAllByTestId("qa-settings-skills-row")).not.toHaveLength(
      0,
    ),
  );
  const row = screen
    .getAllByTestId("qa-settings-skills-row")
    .find(
      (candidate) =>
        within(candidate).getByTestId("qa-settings-skills-row-title")
          .textContent === name,
    );
  if (row === undefined) throw new Error(`no catalog row for ${name}`);
  return row;
}

describe("skills settings page", () => {
  it("loads the catalog, opens one skill and saves through the API", async () => {
    const rig = api({
      skills: [summary()],
      documents: { "api-testing": skillDocument() },
    });
    render(<QaSkillsSettingsPage api={rig.api} />);
    const row = await skillRow("api-testing");
    expect(
      within(row).getByTestId("qa-settings-skills-row-description").textContent,
    ).toBe("Тестирование REST и GraphQL API");
    fireEvent.click(within(row).getByTestId("qa-settings-skills-row-button"));
    expect(await screen.findByLabelText("Название")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Обновлённое описание." },
    });
    const save = screen.getByTestId("qa-settings-skill-save");
    expect(screen.getByRole("button", { name: "Сохранить" })).toBe(save);
    fireEvent.click(save);
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
    const create = await screen.findByTestId("qa-settings-skills-empty-create");
    expect(screen.getByRole("button", { name: "Создать первый навык" })).toBe(
      create,
    );
    fireEvent.click(create);
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "fresh-skill" },
    });
    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Совсем новый." },
    });
    fireEvent.click(screen.getByTestId("qa-settings-skill-save"));
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
    fireEvent.click(
      within(await skillRow("api-testing")).getByTestId(
        "qa-settings-skills-row-button",
      ),
    );
    const remove = await screen.findByTestId("qa-settings-skill-delete");
    expect(screen.getByRole("button", { name: "Удалить" })).toBe(remove);
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Удалить навык" }));
    await waitFor(() => {
      expect(rig.removed).toHaveLength(1);
    });
    expect(rig.removed[0]).toMatchObject({
      name: "api-testing",
      expectedRevision: "rev-1",
    });
    expect(
      (await screen.findByTestId("qa-settings-skills-empty-title")).textContent,
    ).toBe("У вас пока нет навыков.");
  });

  it("shows the refusal copy when the catalog cannot be read", async () => {
    const rig = api({ listFails: "storage-unavailable" });
    render(<QaSkillsSettingsPage api={rig.api} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Хранилище навыков недоступно",
    );
  });

  it("tells the owner when an administrator wrote the skill", async () => {
    const rig = api({
      skills: [
        summary({
          adminEdit: { actorId: "admin-1", at: "2026-09-21T09:00:00.000Z" },
        }),
      ],
    });
    render(<QaSkillsSettingsPage api={rig.api} />);
    const row = await skillRow("api-testing");
    // The person whose skill it is reads the role that changed it, not the
    // account id: a personal page names nobody's administrator.
    expect(
      within(row).getByTestId("qa-settings-skills-row-note").textContent,
    ).toContain("Изменено администратором");
  });

  it("shows no mark on a skill its owner wrote", async () => {
    const rig = api({ skills: [summary()] });
    render(<QaSkillsSettingsPage api={rig.api} />);
    const row = await skillRow("api-testing");
    expect(within(row).queryByTestId("qa-settings-skills-row-note")).toBeNull();
  });
});
