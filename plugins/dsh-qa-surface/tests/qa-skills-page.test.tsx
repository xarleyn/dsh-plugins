// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QaSkillsSettingsPage } from "../src/client/user-settings/SkillsSettingsPage.js";
import { api, skillDocument, summary } from "./qa-skills.helpers.js";

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

  it("tells the owner when an administrator wrote the skill", async () => {
    const rig = api({
      skills: [
        summary({
          adminEdit: { actorId: "admin-1", at: "2026-09-21T09:00:00.000Z" },
        }),
      ],
    });
    render(<QaSkillsSettingsPage api={rig.api} />);
    // The person whose skill it is reads the role that changed it, not the
    // account id: a personal page names nobody's administrator.
    expect(await screen.findByText(/Изменено администратором/u)).toBeTruthy();
  });

  it("shows no mark on a skill its owner wrote", async () => {
    const rig = api({ skills: [summary()] });
    render(<QaSkillsSettingsPage api={rig.api} />);
    expect(await screen.findByText("api-testing")).toBeTruthy();
    expect(screen.queryByText(/Изменено администратором/u)).toBeNull();
  });
});
