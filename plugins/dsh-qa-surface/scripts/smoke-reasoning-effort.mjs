import assert from "node:assert/strict";
import { join } from "node:path";
import { rpc, waitFor } from "./smoke-helpers.mjs";

export async function runReasoningEffortPass({
  browser,
  origin,
  launch,
  cookie,
  adminToken,
  general,
  evidence,
}) {
  const remote = (method, args) =>
    rpc(origin, `qaSurface/${method}`, { args }, cookie);
  const low = {
    provider: "qa-demo",
    model: "effort-demo",
    reasoningEffort: "low",
  };
  const high = { ...low, reasoningEffort: "high" };
  await remote("accessUpdateSubrole", {
    token: adminToken,
    id: general.id,
    input: { ...general, model: low, allowedModels: [low, high] },
  });
  const { user, token } = await remote("accountsRegister", {
    email: "efforts@example.test",
    password: "demo-password-efforts",
  });
  assert.equal(user.role, "user");
  const freshChat = () =>
    remote("createSession", { token, subroleId: null, adminPreview: false });
  const sessionId = await freshChat();
  const options = (id) =>
    remote("accessUserModels", {
      token,
      sessionId: id,
      subroleId: null,
      adminPreview: false,
    });
  const select = (pair) =>
    remote("chatSelectModel", { token, request: { sessionId, ...pair } });
  const initial = await options(sessionId);
  assert.deepEqual(initial.defaultModel, low);
  assert.equal(initial.models.length, 1);
  assert.ok(initial.choices.some((p) => p.reasoningEffort === "high"));
  assert.ok(initial.models[0].reasoningEfforts.includes("medium"));
  for (const pair of [high, low]) {
    assert.deepEqual((await select(pair)).selected, pair);
    assert.deepEqual((await options(sessionId)).selected, pair);
  }
  await assert.rejects(
    () => select({ ...low, reasoningEffort: "medium" }),
    /not allowed/u,
  );
  console.log(
    "packed QA efforts: the role saved low and high; both native selections succeeded; medium was denied",
  );
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  try {
    await page.goto(`${origin}/?token=${encodeURIComponent(launch)}`);
    await page.evaluate(
      ({ token, sessionId }) => {
        const prefix = "dsh-qa-surface.session:v1:/qa:";
        globalThis.localStorage.setItem(prefix + "account-token", token);
        globalThis.localStorage.setItem(prefix + "session", sessionId);
      },
      { token, sessionId },
    );
    await page.goto(`${origin}/qa`);
    await page.getByTestId("qa-surface-welcome-continue").click();
    const guide = page.getByRole("dialog", { name: "Как работать с агентом" });
    await guide.getByRole("checkbox").check();
    await guide
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    const summary = page.getByTestId("qa-composer-settings-summary");
    await waitFor(
      async () => (await summary.textContent()).includes("Reasoning demo"),
      "model summary",
    );
    const open = async () => {
      await page.getByTestId("qa-composer-settings-trigger").click();
      const menu = page.getByTestId("qa-composer-settings-model");
      assert.equal(
        await menu.count(),
        1,
        `no reasoning options under composer summary "${await summary.textContent()}"`,
      );
      await menu.click();
      const options = page.getByRole("menuitemradio");
      assert.equal(await options.count(), 2);
      return options;
    };
    const rows = await open();
    const defaultRow = rows.filter({ hasText: "low" });
    const other = rows.filter({ hasText: "high" });
    assert.match(await defaultRow.innerText(), /по умолчанию/u);
    assert.equal(await defaultRow.getAttribute("aria-checked"), "true");
    if (evidence)
      await page
        .getByTestId("qa-composer-settings-menu")
        .screenshot({ path: join(evidence, "reasoning-efforts.png") });
    await other.click();
    await waitFor(
      async () =>
        (await options(sessionId)).selected.reasoningEffort === "high",
      "high effort on this chat",
    );
    assert.deepEqual((await options(await freshChat())).selected, low);
    await page.reload();
    await waitFor(
      async () => (await summary.textContent()).includes("high"),
      "effort after reload",
    );
    const reopened = await open();
    assert.equal(
      await reopened.filter({ hasText: "high" }).getAttribute("aria-checked"),
      "true",
    );
    assert.equal(
      await reopened.filter({ hasText: "low" }).getAttribute("aria-checked"),
      "false",
    );
    assert.match(
      await reopened.filter({ hasText: "low" }).innerText(),
      /по умолчанию/u,
    );
    if (evidence)
      await page
        .getByTestId("qa-composer-settings-menu")
        .screenshot({ path: join(evidence, "reasoning-efforts-high.png") });
    await reopened.filter({ hasText: "low" }).click();
    await waitFor(
      async () => (await options(sessionId)).selected.reasoningEffort === "low",
      "low effort on this chat",
    );
    console.log(
      "packed QA efforts: distinct rows, default, selection, reload and new-chat default passed",
    );
  } finally {
    await page.close();
  }
}
