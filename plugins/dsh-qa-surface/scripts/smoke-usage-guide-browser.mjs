import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { rpc, waitFor } from "./smoke-helpers.mjs";

async function deferHostModelSetup(page) {
  const handled = [];
  for (const [title, action] of [
    ["Get started", "Add API Key"],
    ["Add an API key to get started", "Configure later"],
  ]) {
    const dialog = page
      .locator("body:not(:has([data-testid='qa-guide-dialog']))")
      .getByRole("dialog", { name: title, exact: true });
    await page.addLocatorHandler(dialog, () =>
      dialog.getByRole("button", { name: action, exact: true }).click(),
    );
    handled.push(dialog);
  }
  return handled;
}

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
  const handledSetup = await deferHostModelSetup(page);
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
      await deferHostModelSetup(operator);
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
  for (const dialog of handledSetup) await page.removeLocatorHandler(dialog);
  assert.ok(focusAfterClose.onOpener, JSON.stringify(focusAfterClose));
}

/** Follow the guide in a real packed chat as an ordinary account. */
export async function runImplementerGuidePass({
  origin,
  authenticatedUrl,
  login,
  remote,
  user,
  admin,
  evidenceDirectory,
}) {
  const { chromium } = await import("playwright");
  await mkdir(evidenceDirectory, { recursive: true });
  const browser = await chromium.launch();
  let page;
  const browserErrors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(error.message));
    const shot = (name) =>
      page.screenshot({ path: join(evidenceDirectory, name) });
    await page.goto(authenticatedUrl);
    await page.goto(origin + "/qa");
    await page.getByTestId("qa-surface-welcome-continue").click();
    const guide = page.getByRole("dialog", { name: "Как работать с агентом" });
    await guide.getByRole("checkbox").check();
    await guide.getByRole("button", { name: "Продолжить" }).click();
    await page.getByTestId("qa-surface-auth-email").fill(login.email);
    await page.getByTestId("qa-surface-auth-password").fill(login.password);
    await page.getByTestId("qa-surface-auth-submit").click();
    await page.getByRole("button", { name: "Памятка", exact: true }).click();
    const filesSection = guide.getByText("Файлы и контекст чата", {
      exact: true,
    });
    await filesSection.click();
    await guide.getByText(/согласованный локальный процесс/u).waitFor();
    await guide.getByText(/разрешённый для этих данных маршрут/u).waitFor();
    await filesSection.click();
    await guide.getByText("Как выбрать режим ответа", { exact: true }).click();
    await guide.getByText(/Обязательная проверка документов/u).waitFor();
    await guide
      .getByText("Как оставить отзыв на ответ", { exact: true })
      .waitFor();
    await shot("implementer-guide.png");
    await guide.getByRole("button", { name: "Закрыть" }).click();
    const modes = page.getByTestId("qa-composer-modes");
    await modes.click();
    const rag = page.getByRole("checkbox", {
      name: "RAG Priority",
      exact: true,
    });
    await rag.check();
    await page.getByRole("checkbox", { name: "Fast", exact: true }).check();
    await shot("implementer-modes.png");
    await modes.click();
    const input = page.getByTestId("qa-composer-input");
    const send = page.getByTestId("qa-composer-send");
    await input.fill("MODE_DENY_DEMO");
    await send.click();
    const question = page.getByTestId("qa-question");
    await question
      .getByText(/Провести глубокий поиск по документации/u)
      .waitFor();
    await question
      .getByText("Нет, ответить по найденному", { exact: true })
      .click();
    await shot("implementer-deep-search-consent.png");
    await question.getByTestId("qa-question-submit").click();
    await page.getByText("Completed MODE_DENY_DEMO", { exact: true }).waitFor();

    await modes.click();
    await rag.uncheck();
    await modes.click();
    await input.fill("MODE_GUIDE_DEMO");
    await send.click();
    const answerStart =
      "В версии 2.1 доступны обзор и отчёты. Источник: reporting.md";
    const answer = page.getByTestId("qa-message").filter({
      hasText: answerStart,
    });
    await answer.getByRole("button", { name: /^Источники \(/u }).click();
    await page
      .getByTestId("qa-sources-item")
      .filter({ hasText: "reporting.md" })
      .click();
    const source = page.getByTestId("qa-source-detail");
    await source.getByText("Доступные отчёты", { exact: true }).waitFor();
    assert.match(
      await source.innerText(),
      /В версии 2\.1 доступны обзор и отчёты/u,
    );
    await shot("implementer-source.png");

    const sessionId = await page.evaluate(() =>
      globalThis.localStorage.getItem("dsh-qa-surface.session:v1:/qa:session"),
    );
    assert.ok(sessionId);
    const identity = await remote("accountsWhoami", { token: user.token });
    const access = await remote("accessSession", {
      token: user.token,
      sessionId,
    });
    assert.equal(identity.user.role, "user");
    assert.equal(access.adminPreview, false);
    assert.equal(access.subrole.id, "general");

    await answer
      .getByRole("button", { name: "Не нравится", exact: true })
      .click();
    const feedback = answer.getByTestId("qa-message-feedback");
    await feedback
      .getByRole("checkbox", { name: "Не хватает информации" })
      .check();
    const comment =
      "Укажите, для какой роли доступны отчёты в разделе руководства.";
    await feedback.getByTestId("qa-message-feedback-comment").fill(comment);
    await shot("implementer-feedback.png");
    await feedback.getByTestId("qa-message-feedback-submit").click();
    const stored = await waitFor(async () => {
      const { items } = await remote("adminFeedback", {
        token: admin.token,
        query: {},
        cursor: null,
        limit: 20,
      });
      return items.find((item) => item.comment === comment);
    }, "the ordinary account's persisted feedback");
    assert.equal(stored.conversationId, sessionId);
    assert.equal(stored.rating, "negative");
    assert.ok(stored.reasons.includes("missing_information"));
    const detail = await remote("adminConversation", {
      token: admin.token,
      conversationId: sessionId,
    });
    const rated = detail.messages.find(
      (message) => message.id === stored.messageId,
    );
    assert.equal(rated?.role, "assistant");
    assert.ok(rated.text.startsWith(answerStart));
    const history = await remote("chatPage", {
      token: user.token,
      request: { address: { kind: "session", sessionId }, maxMessages: 100 },
    });
    assert.ok(
      history.records.some(({ event }) => {
        const source = event.data?.source;
        return (
          source?.kind === "answer-review-status" &&
          source.receipt.candidateSeq === rated.seq &&
          source.receipt.status === "waived"
        );
      }),
      "Fast must waive ordinary answer review for this exact reply",
    );
    console.log(
      "packed QA guide: ordinary-role mode selection, declined escalation, source preview and feedback persisted",
    );
  } catch (error) {
    await page
      ?.screenshot({ path: join(evidenceDirectory, "implementer-failure.png") })
      .catch(() => {});
    if (browserErrors.length) console.error(browserErrors.join("\n"));
    throw error;
  } finally {
    await browser.close();
  }
}
