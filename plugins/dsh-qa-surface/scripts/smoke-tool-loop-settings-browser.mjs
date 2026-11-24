import assert from "node:assert/strict";
import { rpc, waitFor } from "./smoke-helpers.mjs";

/** Write and read back the rules through the packaged Host's Plugins panel. */
export async function runToolLoopSettingsBrowserPass({
  origin,
  authenticatedUrl,
  cookie,
}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const panel = page.getByTestId("qa-settings-tool-loop");
  const savedRules = async () =>
    (await rpc(origin, "qaSurface/describe", { args: {} }, cookie)).tools
      .loopRules;

  async function openCard() {
    await page.getByRole("button", { name: "Plugins", exact: true }).click();
    const title = page.getByRole("button").filter({ hasText: /^QA Surface$/u });
    await title.click();
    if (!(await panel.isVisible())) await title.click();
    await panel.waitFor();
  }

  try {
    const notice = page.getByText(/^(?:Internal Testing|Preview) Notice$/u);
    await page.addLocatorHandler(notice, async () => {
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    });
    for (const [name, button] of [
      ["Get started", "Add API Key"],
      ["Add an API key to get started", "Configure later"],
    ]) {
      const dialog = page.getByRole("dialog", { name, exact: true });
      await page.addLocatorHandler(dialog, async () => {
        await dialog.getByRole("button", { name: button, exact: true }).click();
      });
    }
    await page.goto(authenticatedUrl);
    await openCard();
    const original = await savedRules();
    assert.equal(original[0]?.tool, "qa_list_subagent_models");
    await panel.getByRole("button", { name: "Добавить правило" }).click();
    await panel
      .getByRole("group", { name: "Новый инструмент" })
      .getByLabel("Имя инструмента", { exact: true })
      .fill("demo_lookup");
    const rule = panel.getByRole("group", { name: "demo_lookup" });
    const messages = rule.locator("textarea");
    await rule.getByLabel(/Допустимое отличие результатов/u).fill("8");
    await messages.first().fill("Reuse the first result.");
    await rule.getByRole("button", { name: "Добавить порог" }).click();
    await rule.getByLabel("Номер вызова", { exact: true }).nth(1).fill("5");
    await rule.getByRole("combobox").nth(1).selectOption("finish");
    await messages.nth(1).fill("Summarize the evidence now.");
    await panel.getByRole("button", { name: "Сохранить правила" }).click();

    const expected = {
      tool: "demo_lookup",
      maxDifferencePercent: 8,
      thresholds: [
        { calls: 2, action: "warn", message: "Reuse the first result." },
        { calls: 5, action: "finish", message: "Summarize the evidence now." },
      ],
    };
    await waitFor(
      async () => (await savedRules()).length === original.length + 1,
      "QA tool loop rules save",
    );
    assert.deepEqual(await savedRules(), [...original, expected]);
    await panel
      .getByRole("button", { name: "Сохранить правила" })
      .waitFor({ state: "hidden" });

    await page.reload();
    await openCard();
    await panel.getByText("demo_lookup", { exact: true }).click();
    assert.equal(
      await rule.getByLabel(/Допустимое отличие результатов/u).inputValue(),
      "8",
    );
    assert.equal(
      await rule.getByRole("combobox").nth(1).inputValue(),
      "finish",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await panel.scrollIntoViewIfNeeded();
    const fits = await panel.evaluate(
      (section) =>
        section.clientWidth > 0 &&
        section.scrollWidth <= section.clientWidth + 1,
    );
    assert.equal(fits, true, "tool loop controls fit the narrow panel");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await panel.getByRole("button", { name: "Сбросить", exact: true }).click();
    await waitFor(
      async () => (await savedRules()).length === original.length,
      "QA tool loop rules reset",
    );
    assert.deepEqual(await savedRules(), original);
    assert.deepEqual(pageErrors, []);
    console.log(
      "packed QA tool loop settings: save, Host readback, reload, narrow layout and reset passed",
    );
  } catch (error) {
    const dialogs = await page
      .getByRole("dialog")
      .getByRole("heading")
      .allTextContents();
    throw new Error(
      `QA tool loop settings browser pass failed. Open dialogs: ${dialogs.join(", ") || "none"}`,
      { cause: error },
    );
  } finally {
    await browser.close();
  }
}
