import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rpc, waitFor } from "./smoke-helpers.mjs";

/** Exercise the shipped settings card against a disposable Host, without a model. */
export async function runFileWriteSettingsBrowserPass({
  origin,
  authenticatedUrl,
  cookie,
  evidenceDirectory,
}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const measurements = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await mkdir(evidenceDirectory, { recursive: true });
  const section = page.getByTestId("qa-settings-file-writes");
  const extensions = page.getByTestId("qa-settings-file-writes-extensions");
  const message = page.getByTestId("qa-settings-file-writes-message");
  const describe = () =>
    rpc(origin, "qaSurface/describe", { args: {} }, cookie);
  async function openCard() {
    await page.getByRole("button", { name: "Plugins", exact: true }).click();
    const title = page.getByRole("button").filter({ hasText: /^QA Surface$/u });
    await title.click();
    if (!(await section.isVisible())) await title.click();
    await section.waitFor();
    await extensions.waitFor({ state: "visible" });
  }
  async function applied(check) {
    await waitFor(
      async () => check((await describe()).tools.fileWritePolicy),
      "file write policy settings",
    );
  }
  async function capture(name) {
    await section.scrollIntoViewIfNeeded();
    const measurement = await section.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const fields = [...element.querySelectorAll("textarea")];
      return {
        width: bounds.width,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        fieldWidths: fields.map((field) => field.getBoundingClientRect().width),
        fieldOverflow: fields.some((field) => {
          const rect = field.getBoundingClientRect();
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
        }),
        focusOutline: element.ownerDocument.defaultView.getComputedStyle(
          element.ownerDocument.activeElement,
        ).outlineStyle,
      };
    });
    assert.ok(
      measurement.scrollWidth <= measurement.clientWidth + 1,
      `${name}: section overflow`,
    );
    assert.equal(measurement.fieldOverflow, false, `${name}: field overflow`);
    measurements.push({ name, ...measurement });
    await section.screenshot({ path: join(evidenceDirectory, `${name}.png`) });
  }
  try {
    await page.goto(authenticatedUrl);
    const notice = page.getByText("Internal Testing Notice", { exact: true });
    if (
      await notice
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => true)
        .catch(() => false)
    )
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openCard();
    assert.equal(await extensions.inputValue(), ".py\n.pyw");
    const defaultMessage = await message.inputValue();
    assert.ok(defaultMessage.includes("Не создавайте"));
    await extensions.focus();
    await capture("file-writes-light-1440");

    await extensions.fill(".PY, pyw\nPS1");
    await message.click();
    await applied(
      (policy) => policy.blockedExtensions.join(",") === ".py,.pyw,.ps1",
    );
    const customMessage =
      "Python недоступен. Используйте инструменты документов и таблиц.";
    await message.fill(customMessage);
    await section.getByRole("heading").click();
    await applied((policy) => policy.message === customMessage);
    await page.reload();
    await openCard();
    assert.equal(await message.inputValue(), customMessage);
    assert.deepEqual(
      (await describe()).tools.fileWritePolicy.blockedExtensions,
      [".py", ".pyw", ".ps1"],
    );

    await extensions.fill("");
    await message.click();
    await applied((policy) => policy.blockedExtensions.length === 0);
    await capture("file-writes-empty");
    await message.fill(" ");
    await section.getByRole("heading").click();
    await page.getByTestId("qa-settings-write-error").waitFor();
    assert.equal(
      (await describe()).tools.fileWritePolicy.message,
      customMessage,
    );
    await capture("file-writes-refused");
    await page.getByTestId("qa-settings-file-writes-reset").click();
    await applied(
      (policy) =>
        policy.message === defaultMessage &&
        policy.blockedExtensions.join(",") === ".py,.pyw",
    );

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: theme });
        await extensions.focus();
        await capture(`file-writes-${theme}-${width}`);
      }
    }
    assert.deepEqual(errors, []);
    await writeFile(
      join(evidenceDirectory, "verification.json"),
      `${JSON.stringify(
        {
          result: "PASS",
          checks: [
            "defaults",
            "save",
            "normalization",
            "reload",
            "empty-list",
            "invalid-message",
            "reset",
            "themes",
            "geometry",
          ],
          errors,
          measurements,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      "packed QA file write settings: defaults, save/reload, empty list, schema refusal, reset, light/dark and 390/1440 geometry passed",
    );
  } catch (error) {
    await page
      .screenshot({
        path: join(evidenceDirectory, "failure.png"),
        fullPage: true,
      })
      .catch(() => undefined);
    await writeFile(
      join(evidenceDirectory, "failure.txt"),
      `${String(error)}\n${await page
        .locator("body")
        .innerText()
        .catch(() => "")}`,
    );
    throw error;
  } finally {
    await browser.close();
  }
}
