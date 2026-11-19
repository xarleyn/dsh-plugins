import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rpc } from "./smoke-helpers.mjs";

const demoTitle = "Подготовка к встрече";
const demoPrompt = "Что стоит обсудить на первой встрече по проекту?";
const demoReply = `## ${demoTitle}

Назначьте на встречу три решения. Для каждого заранее укажите участника, который сможет его принять.

| Вопрос | Что зафиксировать |
| --- | --- |
| Какой результат нужен? | Один пример готовой работы |
| Что входит в первую версию? | Обязательные задачи и то, что подождёт |
| Как проверить результат? | Критерии приёмки и дату проверки |

### После встречи

Отправьте участникам список решений. Для открытых вопросов запишите ответственного и срок.`;

// A deterministic local provider gives the browser a real persisted turn
// (and therefore real resize handles) without an account at an LLM provider.
export async function startLayoutProvider() {
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const choice of [
      {
        index: 0,
        delta: { role: "assistant", content: demoReply },
        finish_reason: null,
      },
      { index: 0, delta: {}, finish_reason: "stop" },
    ]) {
      res.write(
        `data: ${JSON.stringify({ id: "layout", object: "chat.completion.chunk", created: 1, model: "layout-demo", choices: [choice] })}\n\n`,
      );
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  return server;
}

export async function openProfileAppearance(page) {
  const account = page.getByTestId("qa-surface-sidebar-account-name");
  const history = page.getByTestId("qa-surface-header-history");
  if (!(await account.isVisible()) && (await history.isVisible()))
    await history.click();
  await account.click();
  await page.getByRole("tab", { name: "Общие", exact: true }).click();
}

export async function chooseProfileTheme(page, label) {
  await openProfileAppearance(page);
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "Закрыть настройки" }).click();
  const history = page.getByTestId("qa-surface-header-history");
  if (
    (await history.isVisible()) &&
    (await history.getAttribute("aria-expanded")) === "true"
  ) {
    const scrim = page.getByTestId("qa-surface-sidebar-scrim");
    const box = await scrim.boundingBox();
    await scrim.click({ position: { x: box.width - 4, y: box.height / 2 } });
  }
}

/** Provision a shared manual skill and exercise two real role grants. */
export async function grantLayoutSearchSource(origin, cookie, session) {
  const call = (method, args) =>
    rpc(
      origin,
      "qaSurface/" + method,
      { args: { token: session.token, ...args } },
      cookie,
    );
  const name = "search-demo-docs";
  await call("adminSkillSave", {
    scope: { kind: "shared" },
    name: null,
    input: {
      name,
      description: "Look up the demo documentation",
      whenToUse: null,
      modelInvocable: false,
      userInvocable: true,
      allowedTools: [],
      body: "Answer the user's question using the demo documentation.",
      expectedRevision: null,
    },
  });
  const { config } = await call("accessAdminSnapshot", {});
  const general = config.subroles.find((role) => role.id === "general");
  const reader = {
    ...general,
    id: "demo-reader",
    name: "Demo reader",
    capabilities: {
      ...general.capabilities,
      skills: [...general.capabilities.skills, name],
    },
  };
  await call("accessCreateSubrole", { input: reader });
  await call("accessUpdateAssignment", {
    userId: session.user.id,
    input: {
      allowedSubroles: ["general", reader.id],
      defaultSubrole: reader.id,
    },
  });
  for (const role of ["general", reader.id]) {
    const catalog = await call("slashCatalog", {
      sessionId: "qa-slash-draft:" + JSON.stringify([role, false]),
    });
    assert.equal(
      catalog.entries.some(
        (entry) =>
          entry.name === name && entry.searchSource?.label === "Документация",
      ),
      role === reader.id,
    );
    if (role === "general") assert.ok(!JSON.stringify(catalog).includes(name));
  }
}

/** Real reload goes through the account gate before it mounts the chat. */
export async function runChatLayoutPass(
  page,
  { origin, cookie, token, sessionId, ownerName, withSearchSource },
) {
  const evidence = process.env.DSH_QA_LAYOUT_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence, { recursive: true });
  const shot = async (name) => {
    if (evidence)
      await page.screenshot({ path: join(evidence, name + ".png") });
  };
  await page.setViewportSize({ width: 1600, height: 900 });
  const chat = page.getByTestId("qa-surface-chat");
  const composer = page.locator(".dsh-qa-footer__inner");
  await page
    .getByRole("button", { name: "Добавить файл или источник" })
    .click();
  if (withSearchSource) {
    await page
      .getByRole("menuitem", { name: "Документация", exact: true })
      .waitFor();
    await shot("composer-source-menu");
    await page
      .getByRole("menuitem", { name: "Документация", exact: true })
      .click();
    await composer.getByText("Документация").waitFor();
    await shot("composer-source-selected");
    await page
      .getByRole("button", { name: "Добавить файл или источник" })
      .click();
  }
  const [picker] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: "Прикрепить файл" }).click(),
  ]);
  assert.ok(picker.isMultiple());
  await picker.setFiles({
    name: "agenda.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Повестка встречи\n\nЦель, объём первой версии и критерии приёмки.",
    ),
  });
  await page.getByTestId("qa-composer-input").fill(demoPrompt);
  await page.getByTestId("qa-composer-send").click();
  const reply = page.getByRole("heading", { name: demoTitle, exact: true });
  await reply.waitFor();
  if (withSearchSource) {
    await page
      .getByTestId("qa-message-content")
      .getByText("Документация")
      .waitFor();
    assert.equal(
      await composer.getByText("Только для этого сообщения").count(),
      0,
    );
  }
  const handle = await page
    .getByTestId("qa-surface-width-handle-right")
    .boundingBox();
  const start = (await composer.boundingBox()).width;
  const x = handle.x + handle.width / 2,
    y = handle.y + 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (960 - start) / 2, y, { steps: 4 });
  await page.mouse.up();
  const selectedWidth = (await composer.boundingBox()).width;
  assert.ok(
    Math.abs(selectedWidth - 960) <= 2,
    "drag chose the requested width",
  );
  await page.reload();
  await chat.waitFor();
  await reply.waitFor();
  const byline = page
    .getByTestId("qa-message")
    .filter({ hasText: demoPrompt })
    .getByTestId("qa-message-author");
  assert.equal(
    await byline.count(),
    0,
    "private prompt has no byline after reload",
  );
  const readingWidth = await composer.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  assert.equal(
    readingWidth,
    selectedWidth,
    "restore width on authenticated reload without moving the pointer",
  );
  const header = page.getByTestId("qa-surface-header");
  assert.equal(
    await header.getByRole("group", { name: "Тема оформления" }).count(),
    0,
  );
  const headerHeight = (await header.boundingBox()).height;
  assert.ok(headerHeight <= 52, "desktop header fits in one row");
  await shot("chat");
  await openProfileAppearance(page);
  await shot("appearance");
  const closeSettings = page.getByRole("button", { name: "Закрыть настройки" });
  await closeSettings.focus();
  await page.keyboard.press("Shift+Tab");
  const settings = page.getByRole("dialog").filter({ has: closeSettings });
  assert.ok(
    await settings.evaluate((el) =>
      el.contains(el.ownerDocument.activeElement),
    ),
    "reverse Tab stays inside settings",
  );
  await page.keyboard.press("Tab");
  assert.ok(
    await closeSettings.evaluate((el) => el === el.ownerDocument.activeElement),
    "forward Tab returns to the close button",
  );
  await page.keyboard.press("Escape");
  assert.ok(
    await page
      .getByTestId("qa-surface-sidebar-account-name")
      .evaluate((el) => el === el.ownerDocument.activeElement),
    "closing settings returns focus to the profile button",
  );
  await page.getByTestId("qa-surface-header-sources").click();
  const separator = page.getByRole("separator", {
    name: "Ширина правой панели",
  });
  await separator.press("End");
  const rail = page.getByTestId("qa-surface-rail");
  const panelWidth = (await rail.boundingBox()).width;
  assert.ok(panelWidth > 720, "wide document pane");
  const chatWidth = (await chat.boundingBox()).width;
  assert.equal(chatWidth, 320, "conversation keeps its reserved width");
  assert.ok(
    (await composer.boundingBox()).width >= 280,
    "composer fills the narrow conversation",
  );
  const headerFits = () =>
    header.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  assert.ok(await headerFits(), "header controls do not spill into the panel");
  await shot("wide-panel");
  await page.getByTestId("qa-surface-rail-tab-files").click();
  await page
    .getByTestId("qa-files-panel")
    .getByRole("button", { name: "Открыть agenda.md", exact: true })
    .click();
  await rail
    .getByText("Цель, объём первой версии и критерии приёмки.", { exact: true })
    .waitFor();
  assert.equal(
    (await rail.boundingBox()).width,
    panelWidth,
    "document preview uses the expanded pane",
  );
  await shot("files");
  await page.getByTestId("qa-surface-rail-close").click();
  await page.getByTestId("qa-surface-header-sources").click();
  assert.equal(
    (await rail.boundingBox()).width,
    panelWidth,
    "panel restores the selected width",
  );
  await page.getByTestId("qa-surface-rail-close").click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await headerFits(), "phone header fits the viewport");
  await shot("phone");
  await page.setViewportSize({ width: 1280, height: 800 });
  const email = "layout-reader@example.test";
  const readerAccount = await rpc(
    origin,
    "qaSurface/accountsRegister",
    { args: { email, password: "demo-password-two" } },
    cookie,
  );
  const setGrant = (mode) =>
    rpc(
      origin,
      "qaSurface/chatSetGrant",
      { args: { token, sessionId, email, mode } },
      cookie,
    );
  await setGrant("read");
  await byline.waitFor();
  assert.equal(
    await byline.textContent(),
    ownerName,
    "sharing adds the owner's byline to the existing prompt",
  );
  await setGrant(null);
  await byline.waitFor({ state: "detached" });
  if (withSearchSource) {
    const catalog = await rpc(
      origin,
      "qaSurface/slashCatalog",
      {
        args: {
          token: readerAccount.token,
          sessionId: "qa-slash-draft:[null,false]",
        },
      },
      cookie,
    );
    assert.ok(
      !JSON.stringify(catalog).includes("search-demo-docs"),
      "another account cannot discover the project",
    );
    await page
      .getByRole("button", { name: "Добавить файл или источник" })
      .click();
    await page
      .getByRole("menuitem", { name: "Документация", exact: true })
      .click();
    const input = page.getByTestId("qa-composer-input");
    await input.fill("Вопрос после отзыва доступа");
    const { config } = await rpc(
      origin,
      "qaSurface/accessAdminSnapshot",
      { args: { token } },
      cookie,
    );
    const role = config.subroles.find(
      (candidate) => candidate.id === "demo-reader",
    );
    await rpc(
      origin,
      "qaSurface/accessUpdateSubrole",
      {
        args: {
          token,
          id: role.id,
          input: {
            ...role,
            capabilities: {
              ...role.capabilities,
              skills: role.capabilities.skills.filter(
                (name) => name !== "search-demo-docs",
              ),
            },
          },
        },
      },
      cookie,
    );
    await page.getByTestId("qa-composer-send").click();
    await composer.getByText("Источник недоступен", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "Вопрос после отзыва доступа");
    await assert.rejects(
      rpc(
        origin,
        "qaSurface/chatPrompt",
        {
          args: {
            token,
            request: {
              sessionId,
              requestId: "revoked-source-check",
              mode: "queue",
              content: [{ type: "text", text: "/search-demo-docs Вопрос" }],
            },
          },
        },
        cookie,
      ),
      /Источник поиска/,
    );
  }
  const metrics = { readingWidth, headerHeight, panelWidth, chatWidth };
  if (evidence)
    await writeFile(
      join(evidence, "layout.json"),
      JSON.stringify(metrics, null, 2),
    );
  console.log("packed QA chat layout:", metrics);
}
