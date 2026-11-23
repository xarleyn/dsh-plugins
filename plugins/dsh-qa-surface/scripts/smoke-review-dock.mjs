import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "./smoke-helpers.mjs";

const writingPrompt = "Подготовь подробный план встречи.";
const answer =
  "Начните встречу с цели. Затем обсудите открытые вопросы и определите, кто отвечает за каждый следующий шаг.";
const correctedAnswer = `${answer} Запишите сроки действий и опубликуйте список решений в заметках встречи.`;
const reviewedPass = {
  verdict: "pass",
  summary: "В плане указаны сроки и место для итогов встречи.",
  issues: [],
  comparisons: [],
};
const reviewedRevise = {
  verdict: "revise",
  summary: "В плане встречи не хватает деталей о договорённостях.",
  issues: [
    {
      severity: "major",
      category: "missing-qualification",
      claim: "Следующие шаги",
      problem: "Ответственные указаны, но сроки пропущены.",
      requiredFix: "Добавьте срок для каждого действия.",
    },
    {
      severity: "minor",
      category: "missing-qualification",
      claim: "Итог встречи",
      problem: "В плане нет места для списка решений.",
      requiredFix: "Укажите, где будут опубликованы итоги.",
    },
  ],
  comparisons: [],
};

/** Hold a real turn at each cancellable boundary until the browser acts. */
export async function startReviewProvider(control) {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.flushHeaders();
    const reviewing = body.model === "review-demo";
    let delta;
    if (reviewing) {
      control.reviewRequested = true;
      if (!control.verdict) return;
      delta = {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "review-verdict-demo",
            type: "function",
            function: {
              name: "structured_output",
              arguments: JSON.stringify(control.verdict),
            },
          },
        ],
      };
    } else {
      if (!control.answerReady) return;
      await control.answerReady;
      const correcting =
        control.correctionReady &&
        JSON.stringify(body.messages).includes("<review_notes>");
      if (correcting) await control.correctionReady;
      delta = {
        role: "assistant",
        content: correcting ? correctedAnswer : answer,
      };
    }
    for (const choice of [
      { index: 0, delta, finish_reason: null },
      { index: 0, delta: {}, finish_reason: reviewing ? "tool_calls" : "stop" },
    ])
      res.write(
        `data: ${JSON.stringify({ id: "demo", object: "chat.completion.chunk", created: 1, model: body.model, choices: [choice] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  return server;
}

export async function runReviewDockPass(page, control) {
  const evidence = process.env.DSH_QA_LAYOUT_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence, { recursive: true });
  const input = page.getByTestId("qa-composer-input");
  const stop = page.getByTestId("qa-composer-stop");
  const strip = page.getByTestId("qa-composer-status");
  const keep = page.getByTestId("qa-composer-stop-continue");
  const state = (value) => strip.and(page.locator(`[data-state="${value}"]`));
  const send = async (text) => {
    await input.fill(text);
    await page.getByTestId("qa-composer-send").click();
  };
  for (const [prompt, phase, final] of [
    [writingPrompt, "writing", "stopped"],
    ["Как провести короткую рабочую встречу?", "reviewing", "cancelled"],
  ]) {
    const answerGate = phase === "reviewing" ? Promise.withResolvers() : null;
    control.answerReady = answerGate?.promise ?? null;
    control.reviewRequested = false;
    await send(prompt);
    await state("writing").waitFor();
    if (answerGate) {
      await stop.click();
      assert(
        await keep.evaluate((el) => el === el.ownerDocument.activeElement),
      );
      answerGate.resolve();
      await state("reviewing").waitFor();
      assert(
        await stop.evaluate((el) => el === el.ownerDocument.activeElement),
      );
      await page.reload();
      await state(phase).waitFor();
      await waitFor(
        () => control.reviewRequested,
        "independent review request",
      );
      await page.getByText(answer, { exact: true }).first().waitFor();
      if (evidence)
        await page.screenshot({ path: join(evidence, "review.png") });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await input.fill("Следующий вопрос");
    await stop.click();
    assert(await keep.evaluate((el) => el === el.ownerDocument.activeElement));
    await page.keyboard.press("Escape");
    assert(await stop.evaluate((el) => el === el.ownerDocument.activeElement));
    await stop.click();
    await keep.click();
    await strip.waitFor();
    await stop.click();
    if (evidence)
      await page.screenshot({ path: join(evidence, phase + "-confirm.png") });
    await page.getByTestId("qa-composer-stop-confirm").click();
    await state(final).waitFor();
    await stop.waitFor({ state: "detached" });
    assert.equal(await input.inputValue(), "Следующий вопрос");
  }
  console.log(
    "packed QA review dock: preparation, independent review, Escape, continue, cancellation and draft preservation passed",
  );
  await runReviewDetailsPass(page, control, send, evidence);
}

async function runReviewDetailsPass(page, control, send, evidence) {
  const correction = Promise.withResolvers();
  control.answerReady = Promise.resolve();
  control.correctionReady = correction.promise;
  control.verdict = reviewedRevise;
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await send("Уточни план короткой встречи и её итоги.");
  const revised = page.getByRole("button", {
    name: "Нужны исправления",
    exact: true,
  });
  const passed = page.getByRole("button", {
    name: "Ответ проверен",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Заключение рецензента" });
  const close = dialog.getByRole("button", {
    name: "Закрыть заключение рецензента",
  });
  await revised.click();
  await dialog.getByText(reviewedRevise.summary, { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("listitem").count(), 2);
  for (const issue of reviewedRevise.issues) {
    await dialog.getByText(issue.problem, { exact: true }).waitFor();
    await dialog.getByText(issue.requiredFix, { exact: true }).waitFor();
  }
  if (evidence)
    await page.screenshot({ path: join(evidence, "verdict-revise.png") });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  const body = dialog.getByTestId("qa-surface-modal-body");
  assert(await body.evaluate((el) => el.scrollWidth <= el.clientWidth));
  if (evidence)
    await page.screenshot({
      path: join(evidence, "verdict-revise-mobile.png"),
    });
  control.verdict = reviewedPass;
  correction.resolve();
  // Observe the new transcript state while the previous verdict stays open.
  await page
    .getByTestId("qa-answer-review")
    .and(page.locator('[data-status="pass"]'))
    .waitFor();
  await dialog.getByText(reviewedRevise.summary, { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  await passed.focus();
  await page.keyboard.press("Enter");
  await dialog.getByText(reviewedPass.summary, { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("list").count(), 0);
  await page.keyboard.press("Tab");
  assert(await close.evaluate((el) => el === el.ownerDocument.activeElement));
  if (evidence)
    await page.screenshot({ path: join(evidence, "verdict-pass-mobile.png") });
  await page.keyboard.press("Escape");
  assert(await passed.evaluate((el) => el === el.ownerDocument.activeElement));

  await page.reload();
  await passed.click();
  await dialog.getByText(reviewedPass.summary, { exact: true }).waitFor();
  console.log(
    "packed QA review details: revise, pass, live replacement, keyboard and replay passed",
  );
}
