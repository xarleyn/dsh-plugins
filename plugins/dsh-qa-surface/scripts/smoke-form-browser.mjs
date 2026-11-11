import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rpc, waitFor } from "./smoke-helpers.mjs";

/** Seed only while every disposable Host using this home is stopped. */
export async function seedFormBrowserFixture(home, sessionId, ownerId) {
  const { QaFormStore } = await import("../lib/forms/store.js");
  const { QaFormService } = await import("../lib/forms/service.js");
  const { DEFAULT_FORM_POLICY } = await import("../lib/forms/schema.js");
  const store = new QaFormStore(join(home, "qa-forms.db"));
  try {
    const service = new QaFormService(
      store,
      () => ({ ...DEFAULT_FORM_POLICY, enabled: true }),
      () => ownerId,
    );
    return service.create(sessionId, "browser-document-intake", {
      schema_version: 1,
      title: "Материалы для оценки проекта",
      description:
        "Опишите задачу, выберите формат работы и приложите документы к нужным пунктам.",
      steps: [
        {
          id: "context",
          title: "1. Задача",
          items: [
            {
              id: "task",
              title: "Что нужно подготовить",
              description: "Кратко опишите ожидаемый результат.",
              answer: {
                type: "textarea",
                required: true,
                min_length: 2,
                max_length: 500,
                placeholder: "Например, оценить объём работ по документу",
              },
              files: { requirement: "none" },
            },
          ],
        },
        {
          id: "format",
          title: "2. Формат работы",
          description: "Выберите удобный формат и состав проверки.",
          items: [
            {
              id: "approach",
              title: "Глубина оценки",
              answer: {
                type: "single_select",
                required: true,
                allow_other: true,
                options: [
                  {
                    value: "brief",
                    label: "Краткий обзор",
                    description: "Основные вопросы и предварительная оценка",
                    recommended: true,
                  },
                  {
                    value: "full",
                    label: "Подробный разбор",
                    description:
                      "Проверка требований и подробный перечень работ",
                  },
                ],
              },
              files: { requirement: "none" },
            },
            {
              id: "areas",
              title: "Что проверить",
              answer: {
                type: "multi_select",
                required: false,
                max_selected: 2,
                options: [
                  { value: "requirements", label: "Требования" },
                  { value: "risks", label: "Риски и ограничения" },
                ],
              },
              files: { requirement: "none" },
            },
          ],
        },
        {
          id: "documents",
          title: "3. Документы",
          description:
            "Файлы привязываются к конкретному пункту и сохраняются вместе с ответами.",
          items: [
            {
              id: "spec",
              title: "Техническое задание",
              description:
                "Основной документ, по которому будет подготовлена оценка.",
              files: {
                requirement: "required",
                min_count: 1,
                max_count: 1,
                accept: [".txt", ".pdf"],
                max_file_size_bytes: 5000000,
              },
            },
            {
              id: "additional",
              title: "Дополнительные материалы",
              files: {
                requirement: "optional",
                max_count: 2,
                accept: [".txt", ".png", ".pdf"],
                max_file_size_bytes: 1000000,
              },
            },
          ],
        },
      ],
    });
  } finally {
    store.close();
  }
}

/** Real packed UI -> account upload route -> Host uploads -> durable form bytes. */
export async function runFormBrowserPass({
  page,
  origin,
  cookie,
  token,
  sessionId,
  formId,
}) {
  const capabilities = await rpc(
    origin,
    "qaSurface/formCapabilities",
    { args: {} },
    cookie,
  );
  assert.equal(
    capabilities.upload,
    true,
    "file upload pipeline must be available",
  );
  assert.equal(
    capabilities.enabled,
    true,
    "forms must be enabled in the fixture profile",
  );
  const row = page.locator(
    `[data-testid="qa-history-draggable-chat"][data-chat-id="${sessionId}"]`,
  );
  await row.waitFor({ state: "visible", timeout: 15000 });
  await row.locator("button").first().click();
  const form = page.locator(".dsh-qa-form");
  try {
    await page
      .getByRole("button", { name: "Открыть форму", exact: true })
      .click({ timeout: 10000 });
  } catch (error) {
    const evidence = process.env.DSH_QA_FORM_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: join(evidence, "fixture-open-failure.png"),
      });
    }
    throw new Error(
      `Form fixture did not open: phase=${await page.locator("main.dsh-qa-surface").getAttribute("data-phase")}; alerts=${JSON.stringify(await page.getByRole("alert").allTextContents())}; formCount=${await form.count()}`,
      { cause: error },
    );
  }
  const next = () => form.getByRole("button", { name: "Далее", exact: true });
  const evidence = process.env.DSH_QA_FORM_EVIDENCE_DIR;
  const measurements = [];
  const capture = async (name) => {
    const scrolling = form.locator(".dsh-qa-form__content");
    if (await scrolling.count())
      await scrolling.evaluate((node) => {
        node.scrollTop = 0;
      });
    const result = await form.evaluate((node) => {
      const root = node.getBoundingClientRect();
      const footer = node
        .querySelector(":scope > footer")
        ?.getBoundingClientRect();
      const content = node.querySelector(".dsh-qa-form__content");
      const selected = node.querySelector("nav [aria-current=step]");
      const selectedBounds = selected?.getBoundingClientRect();
      const navBounds = node.querySelector("nav")?.getBoundingClientRect();
      return {
        viewport: {
          width: globalThis.innerWidth,
          height: globalThis.innerHeight,
        },
        root: { x: root.x, y: root.y, width: root.width, bottom: root.bottom },
        overflow:
          globalThis.document.documentElement.scrollWidth >
            globalThis.innerWidth || node.scrollWidth > node.clientWidth,
        footerVisible:
          !footer ||
          (footer.top >= 0 && footer.bottom <= globalThis.innerHeight),
        footer: footer ? { top: footer.top, bottom: footer.bottom } : null,
        contentScrollable:
          !!content && content.scrollHeight > content.clientHeight,
        currentStepBorder: selected
          ? globalThis.getComputedStyle(selected).borderColor
          : null,
        currentStepVisible:
          !selectedBounds ||
          !navBounds ||
          (selectedBounds.left >= navBounds.left &&
            selectedBounds.right <= navBounds.right),
        itemBorder: node.querySelector("fieldset")
          ? globalThis.getComputedStyle(node.querySelector("fieldset"))
              .borderStyle
          : null,
      };
    });
    measurements.push({ name, ...result });
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: join(evidence, `${name}.png`) });
      await writeFile(
        join(evidence, "measurements.json"),
        JSON.stringify(measurements, null, 2),
      );
    }
    assert.equal(
      result.overflow,
      false,
      `${name}: form must not overflow horizontally`,
    );
    assert.equal(
      result.footerVisible,
      true,
      `${name}: navigation must remain visible`,
    );
    assert.equal(
      result.currentStepVisible,
      true,
      `${name}: current step must remain fully visible`,
    );
  };
  await page
    .getByRole("textbox", { name: "Что нужно подготовить", exact: true })
    .fill("Подготовить оценку работ по приложенному документу.");
  await waitFor(() => next().isEnabled(), "valid text answer");
  await next().click();
  await form.getByRole("radio", { name: /Краткий обзор/u }).waitFor();
  assert.equal(
    await form.getByRole("radio", { name: /Краткий обзор/u }).isChecked(),
    false,
    "recommendation must not preselect an answer",
  );
  await capture("choices-desktop-light");
  await form.getByRole("radio", { name: /Краткий обзор/u }).check();
  await next().click();
  const required = form.getByRole("group", { name: /Техническое задание/u });
  await required.waitFor();
  assert.equal(
    await next().isDisabled(),
    true,
    "required attachment must block progression",
  );
  await capture("files-desktop-light");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
  await capture("files-phone-dark");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Светлая тема", exact: true }).click();
  await required
    .getByLabel("Прикрепить файлы: Техническое задание", { exact: true })
    .setInputFiles({
      name: "requirements.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Original requirements"),
    });
  await required.getByText(/Загружен · Версия 1/u).waitFor({ timeout: 15000 });
  await required
    .getByLabel("Заменить requirements.txt", { exact: true })
    .setInputFiles({
      name: "requirements-v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Updated requirements for review"),
    });
  await required.getByText(/Загружен · Версия 2/u).waitFor({ timeout: 15000 });
  const extra = form.getByRole("group", { name: /Дополнительные материалы/u });
  await extra
    .getByLabel("Прикрепить файлы: Дополнительные материалы", { exact: true })
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Optional notes"),
    });
  await extra.getByText(/Загружен · Версия 1/u).waitFor({ timeout: 15000 });
  await extra
    .getByRole("button", { name: "Убрать notes.txt из пункта", exact: true })
    .click();
  await waitFor(
    async () =>
      (await extra.getByText("notes.txt", { exact: true }).count()) === 0,
    "optional attachment removal",
  );
  await capture("files-uploaded-desktop");
  await next().click();
  await form
    .getByRole("heading", { name: "Проверьте данные", exact: true })
    .waitFor();
  await capture("review-desktop");
  await form
    .getByRole("button", { name: "Передать данные", exact: true })
    .click();
  await form.getByText(/Данные переданы агенту/u).waitFor();
  const saved = await rpc(
    origin,
    "qaSurface/getForm",
    { args: { token, sessionId, formId } },
    cookie,
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.value.status, "submitted");
  assert.equal(saved.value.attachments.spec[0].version, 2);
  const file = await rpc(
    origin,
    "qaSurface/readFormAttachment",
    {
      args: {
        token,
        sessionId,
        formId,
        resourceId: saved.value.attachments.spec[0].resource_id,
      },
    },
    cookie,
  );
  assert.equal(file.ok, true);
  assert.equal(
    Buffer.from(file.value.data, "base64").toString(),
    "Updated requirements for review",
  );
  await capture("submitted-desktop");
  assert.equal(
    await form.getByRole("button", { name: "Продолжить подготовку" }).count(),
    0,
  );
  await form
    .getByRole("button", { name: "Скрыть отправленную форму", exact: true })
    .click();
  await form.waitFor({ state: "detached" });
  await page.reload();
  await page.locator("main.dsh-qa-surface").waitFor();
  await waitFor(
    async () =>
      (await page.getByLabel("Задать вопрос", { exact: true }).count()) > 0,
    "composer after hiding completed form",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Скрыть отправленную форму" })
      .count(),
    0,
  );
  if (evidence)
    await writeFile(
      join(evidence, "measurements.json"),
      JSON.stringify(measurements, null, 2),
    );
  console.log(
    "packed QA forms: required/optional uploads, replacement, removal, submit, saved bytes, dismiss/reload and desktop/phone geometry passed",
  );
}
