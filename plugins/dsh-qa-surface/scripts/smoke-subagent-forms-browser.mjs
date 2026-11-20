import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { rpc, waitFor } from "./smoke-helpers.mjs";

/** Real native child navigation; requests to its owner-only form API are forbidden. */
export async function runSubagentFormsBrowserPass({
  origin,
  cookie,
  authenticatedUrl,
  token,
  sessionId,
  childId,
}) {
  assert.equal(
    typeof childId,
    "string",
    "fixture must contain a real native child",
  );
  const denied = await rpc(
    origin,
    "qaSurface/listForms",
    { args: { token, sessionId: childId } },
    cookie,
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "ACCESS_DENIED");
  const { QA_WELCOME_NOTICE_VERSION } =
    await import("../lib/client/components/QaWelcomeNotice.js");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const polls = [];
  const errors = [];
  const evidence = process.env.DSH_QA_FORM_EVIDENCE_DIR;
  try {
    await context.addInitScript(
      ({ token, sessionId, notice }) => {
        const prefix = "dsh-qa-surface.session:v1:/qa:";
        globalThis.localStorage.setItem(`${prefix}account-token`, token);
        globalThis.localStorage.setItem(`${prefix}session`, sessionId);
        globalThis.localStorage.setItem(`${prefix}welcome-notice`, notice);
      },
      { token, sessionId, notice: QA_WELCOME_NOTICE_VERSION },
    );
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/qaSurface/listForms")
        polls.push(request.postDataJSON().payload.args.sessionId);
    });
    await page.goto(authenticatedUrl);
    await page.goto(`${origin}/qa`);
    await page.getByTestId("qa-surface-root").waitFor();
    await waitFor(() => polls.includes(sessionId), "initial parent form poll");
    const openChild = async () => {
      await page.getByTestId("qa-surface-header-agents").click();
      const child = page.getByTestId("qa-surface-agents-item");
      await child.waitFor();
      await child.click();
      await page
        .getByRole("button", { name: "← В чат", exact: true })
        .waitFor();
      // Let several polling intervals and both refresh events pass in this view.
      const baseline = polls.length;
      await page.evaluate(() => {
        globalThis.window.dispatchEvent(new globalThis.Event("focus"));
        globalThis.document.dispatchEvent(
          new globalThis.Event("visibilitychange"),
        );
      });
      await page.waitForTimeout(3400);
      assert.equal(
        polls.length,
        baseline,
        "child view must stop all form polling",
      );
      assert.ok(
        polls.every((id) => id === sessionId),
        "no child form requests",
      );
      assert.equal(
        await page.getByText(/Не удалось загрузить пошаговые формы/u).count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Повторить загрузку форм", exact: true })
          .count(),
        0,
      );
      assert.equal(await page.locator(".dsh-qa-form").count(), 0);
    };
    await openChild();
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: join(evidence, "subagent-no-form-error.png"),
      });
    }
    const beforeReturn = polls.length;
    await page.getByRole("button", { name: "← В чат", exact: true }).click();
    await waitFor(
      () => polls.length > beforeReturn,
      "parent form polling resumes",
    );
    await waitFor(
      () => page.getByTestId("qa-composer-input").isEnabled(),
      "parent composer admission after return",
      15000,
    );
    await page.reload();
    await waitFor(
      () => polls.length > beforeReturn + 1,
      "parent poll after reload",
    );
    await openChild();
    assert.deepEqual(errors, []);
    const summary = {
      nativeChild: true,
      childPolls: 0,
      parentPollingRestored: true,
      reloadPassed: true,
      childAccess: denied.error.code,
      pageErrors: errors,
    };
    if (evidence)
      await writeFile(
        join(evidence, "subagent-form-results.json"),
        JSON.stringify(summary, null, 2),
      );
    console.log(
      "packed QA subagent forms: zero child polls, no error or retry, parent polling restored, reload and owner-only denial passed",
    );
  } finally {
    await browser.close();
  }
}
