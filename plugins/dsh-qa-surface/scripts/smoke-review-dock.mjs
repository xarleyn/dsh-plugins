import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const writingPrompt = "Подготовь подробный план встречи.";
const answer =
  "Начните встречу с цели. Затем обсудите открытые вопросы и определите, кто отвечает за каждый следующий шаг.";

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
    if (control.holdWriting || body.model === "review-demo") return;
    for (const choice of [
      {
        index: 0,
        delta: { role: "assistant", content: answer },
        finish_reason: null,
      },
      { index: 0, delta: {}, finish_reason: "stop" },
    ])
      res.write(
        `data: ${JSON.stringify({ id: "demo", object: "chat.completion.chunk", created: 1, model: "layout-demo", choices: [choice] })}\n\n`,
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
    control.holdWriting = phase === "writing";
    await send(prompt);
    await state(phase).waitFor();
    if (phase === "reviewing") {
      await page.reload();
      await state(phase).waitFor();
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
}
