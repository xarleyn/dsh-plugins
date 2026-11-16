import assert from "node:assert/strict";
import { chromium } from "playwright";
import { rpc, waitFor } from "./smoke-helpers.mjs";

/** A real packed QA page and Web Audio; only the list of pending questions is a fixture. */
export async function runQuestionSoundsPass({
  origin,
  cookie,
  authenticatedUrl,
}) {
  const sessionId = await rpc(
    origin,
    "qaSurface/createSession",
    { args: { token: "", subroleId: null, adminPreview: false } },
    cookie,
  );
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(authenticatedUrl);
    // An empty disposable profile can seat these onboarding steps in sequence.
    for (const [name, action] of [
      ["Internal Testing Notice", "Continue"],
      ["Preview Notice", "Continue"],
      ["Get started", "Add API Key"],
      ["Add an API key to get started", "Configure later"],
    ]) {
      const dialog = page.getByRole("dialog", { name, exact: true });
      await page.addLocatorHandler(dialog, () =>
        dialog.getByRole("button", { name: action, exact: true }).click(),
      );
    }
    const field = page.getByTestId("qa-settings-question-timeout");
    const openSettings = async () => {
      await page
        .getByRole("button", { name: "Plugins", exact: true })
        .click({ timeout: 10_000 });
      const row = page.getByRole("button").filter({ hasText: /^QA Surface$/u });
      await row.click();
      if (!(await field.isVisible())) await row.click();
      await field.waitFor();
    };
    await openSettings();
    assert.equal(await field.inputValue(), "30");
    await field.fill("10");
    await field.press("Enter");
    const minutes = await waitFor(async () => {
      const { interaction } = await rpc(
        origin,
        "qaSurface/describe",
        { args: {} },
        cookie,
      );
      return (
        interaction.questionTimeoutMinutes === 10 &&
        interaction.questionTimeoutMinutes
      );
    }, "Host question timeout setting");
    await page.reload();
    await openSettings();
    assert.equal(await field.inputValue(), "10");
    await page.addInitScript((id) => {
      globalThis.localStorage.setItem(
        "dsh-qa-surface.session:v1:/qa:session",
        id,
      );
      globalThis.qaQuestionChimes = 0;
      const nativeStart = globalThis.OscillatorNode.prototype.start;
      globalThis.OscillatorNode.prototype.start = function (...args) {
        nativeStart.apply(this, args);
        if (this.context.state === "running") globalThis.qaQuestionChimes++;
      };
    }, sessionId);
    const start = Date.now();
    await page.clock.install({ time: new Date(start) });
    await page.route("**/api/qaSurface/pendingQuestions", async (route) => {
      const response = await route.fetch();
      const envelope = await response.json();
      assert.deepEqual(envelope.result, { ok: true, value: [] });
      envelope.result.value.push({
        id: "sample-question",
        sessionId,
        createdAt: start,
        expiresAt: start + minutes * 60_000,
        questions: [
          {
            id: "format",
            question: "Какой формат нужен?",
            header: null,
            detail: null,
            multiSelect: false,
            options: [],
          },
        ],
      });
      await route.fulfill({ response, json: envelope });
    });
    await page.goto(origin + "/qa");
    const form = page.getByTestId("qa-question");
    await form.waitFor();
    assert.ok((await form.locator("time").innerText()).includes("Ответить до"));
    // A real user gesture unlocks the audio device even under Chromium's
    // autoplay policy. Inspect oscillator starts without substituting the API.
    await page.keyboard.press("Shift");
    const count = () => page.evaluate(() => globalThis.qaQuestionChimes);
    await waitFor(
      async () => (await count()) === 1,
      "first question chime",
      10_000,
    );
    await page.clock.pauseAt(new Date(start + 60_000));
    await page.clock.fastForward(4 * 60_000 - 1);
    assert.equal(await count(), 1);
    await page.clock.fastForward(1);
    assert.equal(await count(), 2);
    await page.clock.fastForward(5 * 60_000);
    assert.equal(await count(), 2);
    console.log(
      "packed QA question: default 30, saved 10 and verified after reload; deadline displayed; Web Audio sounded on arrival and at 5 minutes, silent at expiry",
    );
  } catch (error) {
    const dialogs = await page.getByRole("dialog").allTextContents();
    throw new Error(
      `Question sound smoke failed; dialogs: ${dialogs.join(" | ").slice(0, 900)}`,
      { cause: error },
    );
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await browser.close();
  }
}
