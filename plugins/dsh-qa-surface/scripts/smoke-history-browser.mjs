import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Exercise the packed client against the smoke's own disposable DSH instance. */
async function runHistory({ page, choosePalette }) {
  const evidenceDirectory = process.env.DSH_QA_HISTORY_EVIDENCE_DIR;
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const history = page.getByTestId("qa-surface-sidebar");
  await history.waitFor({ state: "visible" });
  const section = (name) => history.getByRole("region", { name, exact: true });
  const rows = (name) => section(name).getByTestId("qa-history-draggable-chat");
  const rowIds = (name) =>
    rows(name).evaluateAll((nodes) => nodes.map((node) => node.dataset.chatId));
  const baseline = await rowIds("Без каталога");
  assert.ok(baseline.length > 0, "fixture must contain real QA history rows");
  const id = baseline[0];
  const row = () => history.locator(`[data-chat-id="${id}"]`);
  const action = async (name) => {
    await row().hover();
    await row()
      .getByRole("button", { name: /^Действия чата/u })
      .click();
    await page
      .getByRole("group", { name: "Действия чата", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
  };
  const addFolder = async (name) => {
    await history.getByTestId("qa-history-create-folder").click();
    await page.getByLabel("Название каталога", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await section(name).waitFor();
  };
  await addFolder("Документы");
  await addFolder("Исследования");
  await row().dragTo(section("Документы"));
  assert.deepEqual(await rowIds("Документы"), [id]);
  await action("Закрепить чат");
  assert.deepEqual(await rowIds("Закреплённые"), [id]);
  await action("Открепить чат");
  assert.deepEqual(await rowIds("Документы"), [id]);
  await row().dragTo(section("Закреплённые"));
  assert.deepEqual(await rowIds("Закреплённые"), [id]);
  await action("Переместить в каталог");
  const destination = page.getByLabel("Каталог", { exact: true });
  await destination.waitFor({ state: "visible" });
  assert.deepEqual(await destination.locator("option").allTextContents(), [
    "Без каталога",
    "Документы",
    "Исследования",
  ]);
  await destination.selectOption({ label: "Исследования" });
  await page.getByRole("button", { name: "Переместить", exact: true }).click();
  assert.deepEqual(await rowIds("Исследования"), [id]);
  assert.deepEqual(await rowIds("Закреплённые"), []);
  await history
    .getByRole("button", {
      name: "Свернуть каталог «Исследования»",
      exact: true,
    })
    .click();
  assert.equal(await row().count(), 0);
  await history
    .getByRole("searchbox", { name: "Поиск по чатам" })
    .fill("Исследования");
  assert.deepEqual(await rowIds("Исследования"), [id]);
  await history.getByRole("searchbox", { name: "Поиск по чатам" }).fill("");
  assert.equal(await row().count(), 0);
  await history
    .getByRole("button", {
      name: "Развернуть каталог «Исследования»",
      exact: true,
    })
    .click();
  const heading = history
    .getByRole("button", {
      name: "Свернуть каталог «Исследования»",
      exact: true,
    })
    .locator("..");
  await heading.dragTo(section("Документы"), {
    targetPosition: { x: 30, y: 4 },
  });
  const folderTitles = () =>
    history
      .locator(".dsh-qa-history__heading button[aria-expanded]")
      .allTextContents();
  assert.ok(
    (await folderTitles())[0].startsWith("Исследования"),
    "folder drag must reorder headers",
  );
  await page.reload();
  await history.waitFor();
  await row().waitFor();
  assert.deepEqual(await rowIds("Исследования"), [id]);
  assert.ok((await folderTitles())[0].startsWith("Исследования"));
  const measurements = [];
  async function measure(label) {
    const data = await history.evaluate((root) => {
      const bounds = root.getBoundingClientRect();
      const overflow = [
        ...root.querySelectorAll(
          ".dsh-qa-history,.dsh-qa-history__section,.dsh-qa-history__heading",
        ),
      ]
        .filter(
          (node) =>
            node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1,
        )
        .map((node) => node.className);
      const overlaps = [
        ...root.querySelectorAll(".dsh-qa-sidebar__item"),
      ].flatMap((item) => {
        const main = item
          .querySelector(".dsh-qa-sidebar__item-main")
          .getBoundingClientRect();
        return [
          ...item.querySelectorAll(
            ".dsh-qa-chat-actions,.dsh-qa-sidebar__item-delete",
          ),
        ]
          .filter((node) => node.getBoundingClientRect().left < main.right - 1)
          .map((node) => node.className);
      });
      return {
        width: bounds.width,
        viewport: globalThis.innerWidth,
        overflow,
        overlaps,
      };
    });
    assert.deepEqual(data.overflow, [], `${label}: history overflow`);
    assert.deepEqual(
      data.overlaps,
      [],
      `${label}: actions overlap chat titles`,
    );
    measurements.push({ label, ...data });
    if (evidenceDirectory)
      await page.screenshot({ path: join(evidenceDirectory, `${label}.png`) });
  }
  await measure("desktop-light");
  await choosePalette("Тёмная тема", true);
  await measure("desktop-dark");
  await choosePalette("Светлая тема", false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "История чатов", exact: true })
    .click();
  await history.waitFor({ state: "visible" });
  await row()
    .getByRole("button", { name: /^Действия чата/u })
    .click();
  const menu = page.getByRole("group", { name: "Действия чата", exact: true });
  const menuBounds = await menu.boundingBox();
  assert.ok(
    menuBounds &&
      menuBounds.x >= 0 &&
      menuBounds.y >= 0 &&
      menuBounds.x + menuBounds.width <= 391 &&
      menuBounds.y + menuBounds.height <= 845,
    "phone menu must fit the viewport",
  );
  await measure("phone-menu");
  await page.keyboard.press("Escape");
  await history
    .getByRole("button", {
      name: "Настроить каталог «Исследования»",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Удалить каталог", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить каталог", exact: true })
    .click();
  assert.ok((await rowIds("Без каталога")).includes(id));
  assert.equal(await section("Исследования").count(), 0);
  await history
    .getByRole("button", { name: "Закрыть историю чатов", exact: true })
    .click();
  await page.setViewportSize({ width: 375, height: 720 });
  if (evidenceDirectory)
    await writeFile(
      join(evidenceDirectory, "measurements.json"),
      `${JSON.stringify({ measurements, menuBounds }, null, 2)}\n`,
    );
  console.log(
    "packed QA history: folder CRUD, native drag/drop, pin/unpin, search, reload and desktop/phone geometry passed",
  );
}

export async function runHistoryBrowserPass(input) {
  try {
    await runHistory(input);
  } catch (error) {
    const directory = process.env.DSH_QA_HISTORY_EVIDENCE_DIR;
    if (directory) {
      await mkdir(directory, { recursive: true });
      await input.page.screenshot({ path: join(directory, "failure.png") });
      // This pass runs only on the disposable smoke's synthetic fixture.
      await writeFile(
        join(directory, "failure.json"),
        JSON.stringify(
          {
            dialogs: await input.page.getByRole("dialog").allTextContents(),
            selections: await input.page
              .locator("select")
              .evaluateAll((nodes) =>
                nodes.map((node) => ({
                  label: node.closest("label")?.textContent,
                  options: [...node.options].map((option) => option.text),
                })),
              ),
            history: await input.page
              .locator(".dsh-qa-history")
              .allTextContents(),
          },
          null,
          2,
        ),
      );
    }
    throw error;
  }
}
