import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freePort, rpc, stopProcess, waitFor } from "./smoke-helpers.mjs";
import {
  seedFormBrowserFixture,
  runFormBrowserPass,
} from "./smoke-form-browser.mjs";

/** A second disposable host exercises account settings and the real HTTP API. */
export async function runIntegrationFolderBrowserPass(options) {
  const {
    dshBin,
    dshEnv,
    root,
    workspacePath,
    launchToken,
    authenticateBrowser,
    hostLog,
    modelSelection = false,
  } = options;
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const patch = join(root, "integration-folder.patch.yml");
  const modelPass = modelSelection || process.env.DSH_QA_MODEL_SMOKE === "1";
  const stableCode = join(workspacePath, "stable-code");
  const previewCode = join(workspacePath, "preview-code");
  if (modelPass)
    await Promise.all([
      mkdir(stableCode, { recursive: true }),
      mkdir(previewCode, { recursive: true }),
    ]);
  await writeFile(
    patch,
    `- id: dsh-qa-surface
  config:
    accounts:
      enabled: true
      allowRegistration: true
    integration:
      enabled: true
      requestTimeoutMs: 5000
    forms:
      enabled: true
    ui:
      showSessionList: true
${
  modelPass
    ? `    session:
      provider: qa-demo
      model: deepseek-demo
    codeSources:
      defaultSource: stable
      entries:
        - id: stable
          label: Release 2.0
          path: ${JSON.stringify(stableCode.replaceAll("\\", "/"))}
        - id: preview
          label: Development 2.0
          path: ${JSON.stringify(previewCode.replaceAll("\\", "/"))}
    lockdown:
      allowSessionReset: true
- id: llm-pi-ai
  config:
    providers:
      qa-demo:
        displayName: QA demo
        api: openai-completions
        baseURL: https://example.invalid/v1
        models:
          - id: deepseek-demo
            name: DeepSeek demo
          - id: qwen-demo
            name: Qwen demo
          - id: blocked-demo
            name: Unassigned demo
`
    : ""
}`,
  );
  const log = [];
  let host;
  let browser;
  try {
    host = spawn(
      process.execPath,
      [dshBin, "web", "--patch", patch, "--no-open", "--port", String(port)],
      {
        cwd: workspacePath,
        env: dshEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    host.stdout.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
    host.stderr.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
    let launch = await waitFor(
      () => launchToken(log),
      "integration folder host",
    );
    let cookie = await authenticateBrowser(port, `127.0.0.1:${port}`, launch);
    const session = await rpc(
      origin,
      "qaSurface/accountsRegister",
      {
        args: { email: "routing@example.test", password: "demo-password-one" },
      },
      cookie,
    );
    const formSession = await rpc(
      origin,
      "qaSurface/createSession",
      { args: { token: session.token, subroleId: null, adminPreview: false } },
      cookie,
    );
    await stopProcess(host);
    host = undefined;
    const formFixture = await seedFormBrowserFixture(
      dshEnv.DSH_HOME,
      formSession,
      session.user.id,
    );
    log.length = 0;
    host = spawn(
      process.execPath,
      [dshBin, "web", "--patch", patch, "--no-open", "--port", String(port)],
      {
        cwd: workspacePath,
        env: dshEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    host.stdout.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
    host.stderr.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
    launch = await waitFor(() => launchToken(log), "form fixture host restart");
    cookie = await authenticateBrowser(port, `127.0.0.1:${port}`, launch);
    const { chromium } = await import("playwright");
    const { QA_WELCOME_NOTICE_VERSION } =
      await import("../lib/client/components/QaWelcomeNotice.js");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    let page = await context.newPage();
    await context.addInitScript(
      ({ token, noticeVersion, formSession }) => {
        globalThis.localStorage.setItem(
          "dsh-qa-surface.session:v1:/qa:session",
          formSession,
        );
        globalThis.localStorage.setItem(
          "dsh-qa-surface.session:v1:/qa:account-token",
          token,
        );
        globalThis.localStorage.setItem(
          "dsh-qa-surface.session:v1:/qa:welcome-notice",
          noticeVersion,
        );
      },
      {
        token: session.token,
        noticeVersion: QA_WELCOME_NOTICE_VERSION,
        formSession,
      },
    );
    await page.goto(`${origin}/?token=${encodeURIComponent(launch)}`);
    await page.goto(`${origin}/qa`);
    const deferOnboarding = async () => {
      const first = page.getByRole("dialog", {
        name: "Get started",
        exact: true,
      });
      if (await first.isVisible())
        await first
          .getByRole("button", { name: "Add API Key", exact: true })
          .click();
      const key = page.getByRole("dialog", {
        name: "Add an API key to get started",
        exact: true,
      });
      if (await key.isVisible())
        await key
          .getByRole("button", { name: "Configure later", exact: true })
          .click();
    };
    let sidebar = page.getByTestId("qa-surface-sidebar");
    await sidebar.waitFor({ state: "visible", timeout: 30000 });
    await deferOnboarding();
    const notice = page.getByRole("button", {
      name: "Понятно, продолжить",
      exact: true,
    });
    if (await notice.isVisible()) await notice.click();
    await runFormBrowserPass({
      page,
      origin,
      cookie,
      token: session.token,
      sessionId: formSession,
      formId: formFixture.id,
    });
    await sidebar.getByTestId("qa-history-create-folder").click();
    await page
      .getByLabel("Название каталога", { exact: true })
      .fill("Запросы API");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const folderId = await sidebar
      .getByRole("region", { name: "Запросы API", exact: true })
      .getAttribute("data-history-section");
    await sidebar.getByTestId("qa-surface-sidebar-account-name").click();
    await page
      .getByRole("tab", { name: "Интеграционные токены", exact: true })
      .click();
    await page.getByLabel("Название", { exact: true }).fill("Демо API");
    await page
      .getByRole("combobox", { name: "Папка для новых чатов", exact: true })
      .selectOption(folderId);
    await page
      .getByRole("button", { name: "Создать токен", exact: true })
      .click();
    const secret = await page
      .getByLabel("Значение токена", { exact: true })
      .inputValue();
    await page
      .getByRole("button", { name: "Я сохранил токен", exact: true })
      .click();
    const rowSelector = () =>
      page.getByRole("combobox", {
        name: "Папка для новых чатов: Демо API",
        exact: true,
      });
    await waitFor(
      async () => (await rowSelector().inputValue()) === folderId,
      "stored integration folder",
    );
    const listed = await rpc(
      origin,
      "qaSurface/accountsListServiceTokens",
      { args: { token: session.token } },
      cookie,
    );
    assert.deepEqual(listed.tokens[0].historyFolder, {
      id: folderId,
      name: "Запросы API",
    });
    const evidence = process.env.DSH_QA_HISTORY_EVIDENCE_DIR;
    await rowSelector().scrollIntoViewIfNeeded();
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: join(evidence, "integration-folder-setting.png"),
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await rowSelector().scrollIntoViewIfNeeded();
    const bounds = await rowSelector().boundingBox();
    assert.ok(
      bounds &&
        bounds.x >= 0 &&
        bounds.x + bounds.width <= 391 &&
        bounds.width > 0,
      "integration folder picker must fit a phone viewport",
    );
    if (evidence)
      await page.screenshot({
        path: join(evidence, "integration-folder-phone.png"),
      });
    // No QA page remains open while the external service creates its chat.
    await page.close();
    // This host has no model credential. Creation and routing precede the
    // answer, so even a refused/unavailable answer must leave a routed chat.
    const ask = fetch(`${origin}/qa/api/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        message: "Подготовь краткий ответ по документу.",
      }),
      signal: globalThis.AbortSignal.timeout(20000),
    }).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }));
    const routed = await waitFor(
      async () => {
        const result = await rpc(
          origin,
          "qaSurface/accountsOwnedSessions",
          { args: { token: session.token } },
          cookie,
        );
        const entry = Object.entries(result.integrationFolders ?? {}).find(
          ([, folder]) => folder.id === folderId,
        );
        return entry ?? false;
      },
      "API conversation folder snapshot",
      20000,
    );
    assert.deepEqual(routed[1], { id: folderId, name: "Запросы API" });
    await ask;
    page = await context.newPage();
    sidebar = page.getByTestId("qa-surface-sidebar");
    await page.goto(`${origin}/qa`);
    await sidebar.waitFor({ state: "visible" });
    await deferOnboarding();
    const folder = sidebar.getByRole("region", {
      name: "Запросы API",
      exact: true,
    });
    await folder
      .locator(`[data-chat-id="${routed[0]}"]`)
      .waitFor({ state: "visible", timeout: 15000 });
    await sidebar.getByTestId("qa-surface-sidebar-account-name").click();
    await page
      .getByRole("tab", { name: "Интеграционные токены", exact: true })
      .click();
    await rowSelector().selectOption("");
    await waitFor(async () => {
      const tokens = await rpc(
        origin,
        "qaSurface/accountsListServiceTokens",
        { args: { token: session.token } },
        cookie,
      );
      return tokens.tokens[0].historyFolder === undefined;
    }, "cleared token folder");
    const still = await rpc(
      origin,
      "qaSurface/accountsOwnedSessions",
      { args: { token: session.token } },
      cookie,
    );
    assert.deepEqual(still.integrationFolders[routed[0]], {
      id: folderId,
      name: "Запросы API",
    });
    if (modelPass) {
      await page
        .getByRole("button", { name: "Закрыть настройки", exact: true })
        .click();
      await page.setViewportSize({ width: 1280, height: 800 });
      const snapshot = await rpc(
        origin,
        "qaSurface/accessAdminSnapshot",
        { args: { token: session.token } },
        cookie,
      );
      const general = snapshot.config.subroles.find(
        (role) => role.id === "general",
      );
      assert.ok(general);
      await rpc(
        origin,
        "qaSurface/accessUpdateSubrole",
        {
          args: {
            token: session.token,
            id: general.id,
            input: {
              ...general,
              allowedModels: [{ provider: "qa-demo", model: "qwen-demo" }],
            },
          },
        },
        cookie,
      );
      await page.reload();
      await deferOnboarding();
      await page.getByTestId("qa-surface-sidebar-new").click();
      const picker = page.getByTestId("qa-composer-settings-trigger");
      const summary = page.getByTestId("qa-composer-settings-summary");
      assert.equal(
        await picker
          .locator("xpath=ancestor::*[@data-testid='qa-composer']")
          .count(),
        1,
      );
      assert.equal(await page.getByTestId("qa-composer-hint").count(), 0);
      await waitFor(
        async () =>
          (await summary.textContent()).includes("DeepSeek demo · Release 2.0"),
        "default chat model",
      );
      assert.equal(await page.getByTestId("qa-code-source-picker").count(), 0);
      assert.equal(
        await page.getByTestId("qa-model-selector-input").count(),
        0,
      );
      await picker.click();
      await page.getByTestId("qa-composer-settings-code").click();
      await page
        .getByRole("menuitemradio", { name: "Development 2.0", exact: true })
        .click();
      await waitFor(
        async () => (await summary.textContent()).includes("Development 2.0"),
        "draft code version",
      );
      await picker.click();
      await page.getByTestId("qa-composer-settings-model").click();
      assert.equal(await page.getByRole("menuitemradio").count(), 2);
      await page.getByRole("menuitemradio", { name: /Qwen demo/u }).click();
      await waitFor(
        async () => (await summary.textContent()).includes("Qwen demo"),
        "chat-local Qwen selection",
        15000,
      );
      const entries = await rpc(
        origin,
        "qaSurface/accountsOwnedSessions",
        { args: { token: session.token } },
        cookie,
      );
      const active = entries.ids.find((id) => id !== routed[0]);
      assert.ok(active);
      const selected = await rpc(
        origin,
        "qaSurface/accessUserModels",
        {
          args: {
            token: session.token,
            sessionId: active,
            subroleId: null,
            adminPreview: false,
          },
        },
        cookie,
      );
      assert.equal(selected.selected.model, "qwen-demo");
      const source = await rpc(
        origin,
        "qaSurface/chatCodeSources",
        { args: { token: session.token, sessionId: active } },
        cookie,
      );
      assert.equal(source.selectedSource, "preview");
      await assert.rejects(
        () =>
          rpc(
            origin,
            "qaSurface/chatSelectModel",
            {
              args: {
                token: session.token,
                request: {
                  sessionId: active,
                  provider: "qa-demo",
                  model: "blocked-demo",
                },
              },
            },
            cookie,
          ),
        /not allowed/u,
      );
      await page.reload();
      await waitFor(
        async () =>
          (await summary.textContent()).includes("Qwen demo · Development 2.0"),
        "model selection after reload",
      );
      for (const theme of ["dark", "light"]) {
        await page.emulateMedia({ colorScheme: theme });
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 844 });
          await picker.scrollIntoViewIfNeeded();
          const bounds = await picker.boundingBox();
          assert.ok(
            bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
          );
          await picker.focus();
          await page.getByTestId("qa-composer-input").focus();
          if (evidence)
            await page.getByTestId("qa-composer").screenshot({
              path: join(evidence, `model-composer-${theme}-${width}.png`),
            });
          if (evidence)
            await page.screenshot({
              path: join(evidence, `model-picker-${theme}-${width}.png`),
            });
          await picker.click();
          const popup = page.getByTestId("qa-composer-settings-menu");
          const popupBounds = await popup.boundingBox();
          assert.ok(
            popupBounds &&
              popupBounds.x >= 0 &&
              popupBounds.x + popupBounds.width <= width + 1 &&
              popupBounds.y >= 0 &&
              popupBounds.y + popupBounds.height <= 845,
          );
          if (evidence)
            await popup.screenshot({
              path: join(evidence, `settings-menu-${theme}-${width}.png`),
            });
          await page.getByTestId("qa-composer-settings-model").click();
          if (evidence)
            await page.getByTestId("qa-composer-settings-menu").screenshot({
              path: join(evidence, `settings-models-${theme}-${width}.png`),
            });
          await page.keyboard.press("Escape");
          await page.getByTestId("qa-composer-settings-code").click();
          if (evidence)
            await page.getByTestId("qa-composer-settings-menu").screenshot({
              path: join(evidence, `settings-code-${theme}-${width}.png`),
            });
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
        }
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByTestId("qa-surface-sidebar-new").click();
      await waitFor(
        async () =>
          (await summary.textContent()).includes("DeepSeek demo · Release 2.0"),
        "unchanged default of a new chat",
      );
      console.log(
        "packed QA unified settings: nested model/source menus, draft transfer, filtered grants, rejection, reload persistence, new-chat defaults, themes and phone geometry passed",
      );
    }
    console.log(
      "packed QA integration folders: browser setting, server persistence, HTTP API routing, reload and clear passed",
    );
  } catch (error) {
    hostLog.push(...log);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    await stopProcess(host);
  }
}
