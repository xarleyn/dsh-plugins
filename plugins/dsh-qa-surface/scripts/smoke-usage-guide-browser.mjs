import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { rpc, waitFor } from "./smoke-helpers.mjs";

export async function runUsageGuidePass(page, settings) {
  const { QA_WELCOME_NOTICE_VERSION } =
    await import("../lib/client/components/QaWelcomeNotice.js");
  const guide = page.getByRole("dialog", { name: "Как работать с агентом" });
  const stock = page.getByRole("dialog", { name: "Internal Testing Notice" });
  const checkbox = guide.getByRole("checkbox", {
    name: "Ознакомился и все понял",
  });
  const proceed = guide.getByRole("button", {
    name: "Продолжить",
    exact: true,
  });

  // The QA route owns the guide even on a restored, non-blank session.
  const welcome = page.getByRole("dialog", {
    name: "Перед началом тестирования",
  });
  await welcome.waitFor();
  assert.equal(await guide.count(), 0);
  await welcome.getByRole("button", { name: "Понятно, продолжить" }).click();
  await guide.waitFor();
  assert.equal(await welcome.count(), 0);
  assert.equal(await stock.count(), 0);
  assert.equal(await checkbox.isChecked(), false);
  assert.ok(await proceed.isDisabled());

  const evidence = process.env.DSH_QA_GUIDE_EVIDENCE;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    const mobile = page.viewportSize();
    await page.screenshot({ path: join(evidence, "guide-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: join(evidence, "guide-desktop.png") });
    await page.setViewportSize(mobile);
  }

  await page.keyboard.press("Escape");
  await guide.getByText("Как выбрать режим ответа", { exact: true }).click();
  await guide.getByText("Deep Thinking", { exact: true }).waitFor();
  const bounds = await proceed.boundingBox();
  assert.ok(
    bounds &&
      bounds.y >= 0 &&
      bounds.y + bounds.height <= page.viewportSize().height,
    "the guide confirmation must stay within the mobile viewport",
  );
  await checkbox.check();
  await proceed.click();
  assert.equal(
    await page.evaluate(() =>
      globalThis.localStorage.getItem(
        "dsh-qa-surface.session:v1:/qa:welcome-notice",
      ),
    ),
    QA_WELCOME_NOTICE_VERSION,
  );

  await page.reload();
  const opener = page.getByRole("button", { name: "Памятка", exact: true });
  await opener.waitFor();
  assert.equal(await guide.count(), 0);
  assert.equal(await stock.count(), 0);
  await opener.click();
  await guide.getByRole("button", { name: "Закрыть" }).waitFor();
  assert.equal(await checkbox.count(), 0);
  await page.keyboard.press("Escape");
  await guide.waitFor({ state: "hidden" });
  const focusAfterClose = await opener.evaluate((node) => {
    const doc = node.ownerDocument;
    const focused = doc.activeElement;
    return {
      onOpener: node === focused,
      focused: focused?.getAttribute("data-testid") ?? focused?.tagName,
      inert: !!node.closest("[inert]"),
      dialogs: [...doc.querySelectorAll('[role="dialog"]')].map((element) =>
        element.getAttribute("aria-label"),
      ),
    };
  });

  if (settings) {
    const operator = await page.context().newPage();
    try {
      await operator.setViewportSize({ width: 1440, height: 1000 });
      const notice = operator.getByText(
        /^(?:Internal Testing|Preview) Notice$/u,
      );
      await operator.addLocatorHandler(notice, async () => {
        await operator
          .getByRole("button", { name: "Continue", exact: true })
          .click();
      });
      // A fresh model-less operator profile offers account setup before it
      // opens the Plugins panel. Follow the Host's local deferral controls.
      for (const [title, action] of [
        ["Get started", "Add API Key"],
        ["Add an API key to get started", "Configure later"],
      ]) {
        const dialog = operator.getByRole("dialog", {
          name: title,
          exact: true,
        });
        await operator.addLocatorHandler(dialog, () =>
          dialog.getByRole("button", { name: action, exact: true }).click(),
        );
      }
      await operator.goto(settings.origin);
      await operator
        .getByRole("button", { name: "Plugins", exact: true })
        .click();
      const row = operator
        .getByRole("button")
        .filter({ hasText: /^QA Surface$/u });
      await row.click();
      const editor = operator.getByTestId("qa-settings-branding-usage-guide");
      if (!(await editor.isVisible())) await row.click();
      const custom =
        "## Проверка источников\n\nОткройте **приложенный файл** и сверьте итог.";
      assert.match(await editor.inputValue(), /Сравни две версии/u);
      if (evidence)
        await editor
          .locator("..")
          .screenshot({ path: join(evidence, "guide-settings.png") });
      await editor.fill(custom);
      await editor.blur();
      await waitFor(
        async () =>
          (
            await rpc(
              settings.origin,
              "qaSurface/describe",
              { args: {} },
              settings.cookie,
            )
          ).branding.usageGuideMarkdown === custom,
        "guide saved by the plugin settings card",
      );
      await page.reload();
      await guide.waitFor();
      assert.equal(await welcome.count(), 0);
      assert.ok(await proceed.isDisabled());
      await guide.getByText("Проверка источников", { exact: true }).click();
      await guide
        .locator("strong")
        .filter({ hasText: "приложенный файл" })
        .waitFor();
      await checkbox.check();
      await proceed.click();
      await page.reload();
      await opener.waitFor();
      assert.equal(await guide.count(), 0);
    } catch (error) {
      console.error(
        "Operator dialog headings:",
        await operator
          .getByRole("dialog")
          .getByRole("heading")
          .allTextContents(),
      );
      throw error;
    } finally {
      await operator.close();
    }
  }
  assert.ok(focusAfterClose.onOpener, JSON.stringify(focusAfterClose));
}
