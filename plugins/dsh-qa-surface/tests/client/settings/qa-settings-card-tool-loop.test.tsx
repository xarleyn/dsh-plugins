// @vitest-environment jsdom
import { act, fireEvent, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { errorPlate, renderCard, section } from "./qa-settings-card.helpers.js";

it("adds a rule and saves all of its thresholds in one Host mutation", async () => {
  const { mutate } = await renderCard();
  const panel = within(section("qa-settings-tool-loop"));
  expect(panel.getByText("qa_list_subagent_models")).toBeTruthy();
  fireEvent.click(panel.getByRole("button", { name: "Добавить правило" }));
  const rule = within(panel.getByRole("group", { name: "Новый инструмент" }));
  fireEvent.change(rule.getByLabelText("Имя инструмента"), {
    target: { value: "demo_lookup" },
  });
  fireEvent.change(rule.getByLabelText(/Допустимое отличие результатов/u), {
    target: { value: "10" },
  });
  fireEvent.change(rule.getByLabelText("Сообщение ассистенту"), {
    target: { value: "Reuse the earlier result." },
  });
  fireEvent.click(rule.getByRole("button", { name: "Добавить порог" }));
  fireEvent.change(rule.getAllByLabelText("Номер вызова")[1]!, {
    target: { value: "4" },
  });
  fireEvent.change(rule.getAllByLabelText("Действие")[1]!, {
    target: { value: "finish" },
  });
  fireEvent.change(rule.getAllByLabelText("Сообщение ассистенту")[1]!, {
    target: { value: "Summarize the evidence." },
  });

  expect(mutate).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(panel.getByRole("button", { name: "Сохранить правила" })),
  );
  expect(mutate).toHaveBeenCalledExactlyOnceWith(
    [
      {
        op: "set",
        path: ["tools", "loopRules"],
        value: [
          expect.objectContaining({ tool: "qa_list_subagent_models" }),
          {
            tool: "demo_lookup",
            maxDifferencePercent: 10,
            thresholds: [
              {
                calls: 2,
                action: "warn",
                message: "Reuse the earlier result.",
              },
              {
                calls: 4,
                action: "finish",
                message: "Summarize the evidence.",
              },
            ],
          },
        ],
      },
    ],
    1,
  );
  expect(panel.queryByRole("button", { name: "Сохранить правила" })).toBeNull();
});

it("validates a draft and retains it if the Host refuses the save", async () => {
  const { mutate } = await renderCard({ refuse: true });
  const panel = within(section("qa-settings-tool-loop"));
  fireEvent.click(panel.getByRole("button", { name: "Добавить правило" }));
  const rule = within(panel.getByRole("group", { name: "Новый инструмент" }));
  const save = panel.getByRole("button", { name: "Сохранить правила" });
  fireEvent.click(save);
  expect(panel.getByRole("alert").textContent).toContain(
    "Укажите точное имя инструмента",
  );
  expect(mutate).not.toHaveBeenCalled();

  fireEvent.change(rule.getByLabelText("Имя инструмента"), {
    target: { value: "demo_lookup" },
  });
  fireEvent.change(rule.getByLabelText("Сообщение ассистенту"), {
    target: { value: "Keep the result." },
  });
  await act(async () => fireEvent.click(save));
  expect(errorPlate()?.textContent).toContain("значение не сохранилось");
  expect(panel.getByRole("button", { name: "Сохранить правила" })).toBe(save);
  expect(
    (rule.getByLabelText("Сообщение ассистенту") as HTMLTextAreaElement).value,
  ).toBe("Keep the result.");
});
