import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freePort, rpc, stopProcess, waitFor } from "./smoke-helpers.mjs";
import {
  runReviewDockPass,
  startReviewProvider,
} from "./smoke-review-dock.mjs";
import {
  runChatLayoutPass,
  grantLayoutSearchSource,
  startLayoutProvider,
} from "./smoke-chat-layout.mjs";
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
    chatLayoutOnly = false,
    sourceWorkspace,
    reviewDockOnly = false,
  } = options;
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const patch = join(root, "integration-folder.patch.yml");
  const modelPass =
    !chatLayoutOnly &&
    !reviewDockOnly &&
    (modelSelection || process.env.DSH_QA_MODEL_SMOKE === "1");
  const reviewControl = { answerReady: null, reviewRequested: false };
  const archive = sourceWorkspace
    ? { operations: [], requested: false, env: {}, reader: undefined }
    : undefined;
  if (archive) {
    const { archiveReader, extractArchiveDocument } =
      await import("../lib/search-sources/reader.js");
    const word = await readFile(
      new URL("../tests/fixtures/archive/equipment.docx", import.meta.url),
    );
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const issuer = join(root, "reader-test.pem");
    await writeFile(
      issuer,
      privateKey.export({ format: "pem", type: "pkcs8" }),
    );
    const authPort = await freePort();
    archive.reader = archiveReader(authPort, publicKey, async (op, signal) => {
      archive.operations.push(op);
      return {
        format: "docx",
        fragments: await extractArchiveDocument("docx", word, signal),
        nextOffset: null,
      };
    });
    await new Promise((resolve) =>
      archive.reader.listen(0, "127.0.0.1", resolve),
    );
    archive.env = {
      QA_SOURCE_SIGNING_KEY: issuer,
      QA_SOURCE_AUTH_PORT: String(authPort),
      QA_SOURCE_READER_PORT: String(archive.reader.address().port),
    };
  }
  const layoutProvider = reviewDockOnly
    ? await startReviewProvider(reviewControl)
    : modelPass
      ? undefined
      : await startLayoutProvider(archive);
  const stableCode = join(workspacePath, "stable-code");
  const previewCode = join(workspacePath, "preview-code");
  const searchConfig = sourceWorkspace
    ? `      perUserWorkspace: true
      skills: { enabled: true }
    searchSources:
      - { skill: search-demo-docs, label: Документация, directory: demo }
    lockdown: { enabled: true, sandboxMode: workspace-write, approvalPolicy: never, permissionPreset: qa-layout-workspace, allowSlashCommands: true }
    slashCommands: { skills: { mode: allow-list, allow: [search-demo-docs] } }`
    : "";
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
${searchConfig}
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
    : `    session:
${sourceWorkspace ? "      workspaceId: " + JSON.stringify(sourceWorkspace) : ""}
      provider: qa-layout
      model: layout-demo
${
  sourceWorkspace
    ? `- id: permission
  config:
    defaultPreset: qa-layout-workspace
    presets:
      qa-layout-workspace: { sandbox: workspace-write, approval: never }`
    : ""
}
- id: llm-pi-ai
  config:
    providers:
      qa-layout:
        api: openai-completions
        apiKeyEnv: QA_LAYOUT_DEMO_KEY
        baseURL: http://127.0.0.1:${layoutProvider.address().port}/v1
        models:
          - id: layout-demo
            name: Demo${
              reviewDockOnly
                ? `
          - id: review-demo
            name: Reviewer
- id: dsh-answer-review-gate
  config:
    failMode: open
    reviewer:
      backend: subagent
      provider: spawn
      route: qa-layout
      model: review-demo`
                : ""
            }`
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
        env: { ...dshEnv, ...archive?.env, QA_LAYOUT_DEMO_KEY: "local-demo" },
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
    if (sourceWorkspace) await grantLayoutSearchSource(origin, cookie, session);
    const formSession = await rpc(
      origin,
      "qaSurface/createSession",
      { args: { token: session.token, subroleId: null, adminPreview: false } },
      cookie,
    );
    // Create closed, durable conversations across the same restart as the form.
    const removalExamples = [];
    if (!modelPass && !reviewDockOnly) {
      for (const name of ["keep-history", "erase-history"]) {
        const account = await rpc(
          origin,
          "qaSurface/accountsRegister",
          {
            args: {
              email: name + "@example.test",
              password: "demo-password-two",
            },
          },
          cookie,
        );
        const chat = await rpc(
          origin,
          "qaSurface/createSession",
          {
            args: {
              token: account.token,
              subroleId: null,
              adminPreview: false,
            },
          },
          cookie,
        );
        removalExamples.push({ name, account, chat });
      }
    }
    await stopProcess(host);
    host = undefined;
    const formFixture = reviewDockOnly
      ? undefined
      : await seedFormBrowserFixture(
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
        env: { ...dshEnv, ...archive?.env, QA_LAYOUT_DEMO_KEY: "local-demo" },
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
    const { DEFAULT_USAGE_GUIDE } =
      await import("../lib/shared/usage-guide.js");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    let page = await context.newPage();
    await context.addInitScript(
      ({ token, noticeVersion, guide, formSession }) => {
        // Seed the form only on first entry. Later reloads must reopen the
        // chat the UI persisted, including one created by model selection.
        const sessionKey = "dsh-qa-surface.session:v1:/qa:session";
        if (globalThis.localStorage.getItem(sessionKey) === null)
          globalThis.localStorage.setItem(sessionKey, formSession);
        globalThis.localStorage.setItem(
          "dsh-qa-surface.session:v1:/qa:account-token",
          token,
        );
        globalThis.localStorage.setItem(
          "dsh-qa-surface.session:v1:/qa:welcome-notice",
          noticeVersion,
        );
        globalThis.localStorage.setItem(
          "dsh-qa-surface.session:v1:/qa:usage-guide",
          guide,
        );
      },
      {
        token: session.token,
        noticeVersion: QA_WELCOME_NOTICE_VERSION,
        guide: DEFAULT_USAGE_GUIDE,
        formSession,
      },
    );
    await page.goto(`${origin}/?token=${encodeURIComponent(launch)}`);
    const verifyRemoval = async (adminPage) => {
      await adminPage.getByTestId("qa-surface-header-admin").click();
      await adminPage.getByTestId("qa-admin-nav-users").click();
      for (const { name, account, chat } of removalExamples) {
        const erase = name === "erase-history";
        const row = adminPage
          .getByTestId("qa-admin-users-row")
          .filter({ hasText: account.user.email });
        if (erase) {
          await row.getByRole("button", { name: "Открыть" }).click();
          await adminPage
            .getByRole("button", { name: "Удалить аккаунт…", exact: true })
            .click();
        } else
          await row.getByRole("button", { name: /Удалить аккаунт/u }).click();
        const dialog = adminPage.getByRole("dialog", {
          name: "Удалить аккаунт?",
        });
        assert.equal(await dialog.getByRole("checkbox").isChecked(), false);
        if (erase) await dialog.getByRole("checkbox").check();
        await dialog
          .getByRole("button", {
            name: erase ? "Удалить аккаунт и 1 разговор" : "Удалить аккаунт",
            exact: true,
          })
          .click();
        await adminPage
          .getByRole("status")
          .filter({ hasText: `Аккаунт «${name}» удалён.` })
          .waitFor();
        await row.waitFor({ state: "detached" });
        const who = await rpc(
          origin,
          "qaSurface/accountsWhoami",
          { args: { token: account.token } },
          cookie,
        );
        assert.equal(who.authenticated, false);
        const history = await rpc(
          origin,
          "qaSurface/adminConversations",
          {
            args: {
              token: session.token,
              query: { userId: account.user.id },
              cursor: null,
              limit: 10,
            },
          },
          cookie,
        );
        assert.deepEqual(
          history.items.map((item) => [item.conversationId, item.displayName]),
          erase ? [] : [[chat, "Удалённый пользователь"]],
        );
      }
      for (const { chat } of removalExamples.filter(
        ({ name }) => name === "keep-history",
      )) {
        await adminPage.getByTestId("qa-admin-nav-conversations").click();
        await adminPage
          .getByTestId("qa-admin-conversations-row")
          .filter({ hasText: chat })
          .getByTestId("qa-admin-conversations-open")
          .click();
        await adminPage
          .getByTestId("qa-admin-conversation-transcript")
          .waitFor();
        await adminPage.getByText(/Удалённый пользователь ·/u).waitFor();
        await adminPage.getByTestId("qa-admin-nav-users").click();
      }
      await adminPage.getByTestId("qa-admin-back-to-chat").click();
      console.log(
        "packed QA account removal: both dialog paths, credentials and stored conversation history passed",
      );
    };
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
    if (reviewDockOnly) {
      try {
        await runReviewDockPass(page, reviewControl);
      } catch (error) {
        console.error(
          "Review dock at failure:",
          await page.getByTestId("qa-composer").allInnerTexts(),
        );
        throw error;
      }
      return;
    }
    if (removalExamples.length > 0) await verifyRemoval(page);
    await runFormBrowserPass({
      page,
      origin,
      cookie,
      token: session.token,
      sessionId: formSession,
      formId: formFixture.id,
    });
    if (layoutProvider)
      await runChatLayoutPass(page, {
        origin,
        cookie,
        token: session.token,
        sessionId: formSession,
        ownerName: session.user.displayName,
        withSearchSource: Boolean(sourceWorkspace),
      });
    if (archive) {
      assert.equal(
        archive.delivered,
        true,
        "the selected DOCX value and location reached the model: " +
          JSON.stringify({
            requested: archive.requested,
            operations: archive.operations.length,
            toolResults: archive.selectedResults,
          }),
      );
      assert.ok(
        archive.ordinaryObserved &&
          (!archive.ordinaryRequested || archive.ordinaryRefused),
        "the unselected request could not dispatch the archive reader",
      );
    }
    if (archive) {
      await page.getByText("47.25 kPa — Equipment, table 1, row 1").waitFor();
      assert.deepEqual(archive.operations, [
        {
          action: "read",
          directory: "demo",
          path: "equipment.docx",
          query: "",
          offset: 0,
        },
      ]);
    }
    if (chatLayoutOnly) return;
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
    archive?.reader?.close();
    layoutProvider?.close();
    await browser?.close().catch(() => undefined);
    await stopProcess(host);
  }
}
