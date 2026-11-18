import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { rpc, waitFor } from "./smoke-helpers.mjs";

const deniedModel = "unassigned-fixture";

export async function liveModelEndpoints() {
  const models = [];
  for (const slot of ["A", "B"]) {
    const prefix = `DSH_QA_MODEL_${slot}`;
    const model = process.env[`${prefix}_ID`];
    const url = process.env[`${prefix}_URL`];
    assert.ok(model?.trim() && url, `set ${prefix}_ID and ${prefix}_URL`);
    const endpoint = new URL(url);
    assert.ok(
      endpoint.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname) &&
        !endpoint.username &&
        !endpoint.password &&
        !endpoint.search &&
        !endpoint.hash,
      `${prefix}_URL must be a local model endpoint`,
    );
    const baseURL = endpoint.href.replace(/\/+$/u, "");
    const response = await fetch(`${baseURL}/models`, {
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(10000),
    });
    assert.ok(
      response.ok,
      `${prefix} model catalog returned HTTP ${response.status}`,
    );
    assert.ok(
      (await response.json()).data.some((entry) => entry.id === model),
      `${prefix} does not serve ${model}`,
    );
    models.push({ model, provider: `qa-model-${slot.toLowerCase()}`, baseURL });
  }
  assert.equal(
    new Set([deniedModel, ...models.map((entry) => entry.model)]).size,
    3,
    "use two different served model IDs",
  );
  return models;
}

// Forward the real completion stream and retain the routing facts for each
// request. The Harness transcript alone cannot witness the HTTP model field.
export async function observeModelRequests(models) {
  let currentTurn;
  const server = createServer(async (request, response) => {
    const target = models.find(
      ({ provider }) => request.url === `/${provider}/chat/completions`,
    );
    if (request.method !== "POST" || !target) {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const { model, messages } = JSON.parse(body);
      const receipt = { provider: target.provider, model };
      // Harness can append user-role context after the browser's message.
      if (
        currentTurn &&
        !currentTurn.request &&
        messages.some(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message.content)?.includes(currentTurn.marker),
        )
      )
        currentTurn.request = receipt;
      const upstream = await fetch(`${target.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: request.headers.authorization ?? "",
        },
        body,
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(300000),
      });
      receipt.status = upstream.status;
      response.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
      });
      if (upstream.body)
        await pipeline(Readable.fromWeb(upstream.body), response);
      else response.end();
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else response.writeHead(502).end("Local inference forwarding failed");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    beginTurn(marker) {
      currentTurn = { marker };
      return currentTurn;
    },
    models: models.map((m) => ({ ...m, baseURL: `${origin}/${m.provider}` })),
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

export function liveModelPatch(models, workspaceId) {
  const [first] = models;
  return `- insert:
    - id: preset-model-chat
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: model-chat
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: Answer arithmetic questions directly in plain text using mental arithmetic.
              complete: true
              includeRuntimeContext: false
- id: dsh-qa-surface
  config:
    enabled: true
    accounts: { enabled: true, allowRegistration: true }
    session: { workspaceId: ${JSON.stringify(workspaceId)}, agentPreset: model-chat, provider: ${first.provider}, model: ${JSON.stringify(first.model)} }
    tools: { dynamicActivation: false }
    lockdown: { enabled: true, sandboxMode: read-only, approvalPolicy: never, permissionPreset: qa-read-only }
- id: llm-pi-ai
  config:
    providers:
${models
  .map(
    ({ provider, model, baseURL }, index) => `      ${provider}:
        api: openai-completions
        apiKeyEnv: QA_MODEL_FIXTURE_KEY
        baseURL: ${JSON.stringify(baseURL)}
        models: ${JSON.stringify([{ id: model, name: model }, ...(index === 0 ? [{ id: deniedModel, name: deniedModel }] : [])])}`,
  )
  .join("\n")}
`;
}

export async function runLiveModelSelection({
  models,
  origin,
  cookie,
  authenticatedUrl,
  beginTurn,
}) {
  const remote = (method, args) =>
    rpc(origin, `qaSurface/${method}`, { args }, cookie);
  const register = (name) =>
    remote("accountsRegister", {
      email: `${name}@example.test`,
      password: randomUUID(),
    });
  const admin = await register("model-admin");
  const user = await register("model-user");
  assert.equal(user.user.role, "user");
  const snapshot = await remote("accessAdminSnapshot", { token: admin.token });
  const role = snapshot.config.subroles.find((entry) => entry.id === "general");
  assert.ok(role, "missing general role in the disposable profile");
  const pairs = models.map(({ provider, model }) => ({ provider, model }));
  await remote("accessUpdateSubrole", {
    token: admin.token,
    id: role.id,
    input: { ...role, allowedModels: pairs },
  });
  const sessionId = await remote("createSession", {
    token: user.token,
    subroleId: null,
    adminPreview: false,
  });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 850 },
    });
    await page.goto(authenticatedUrl);
    await page.evaluate(
      ({ token, sessionId }) => {
        const prefix = "dsh-qa-surface.session:v1:/qa:";
        globalThis.localStorage.setItem(prefix + "account-token", token);
        globalThis.localStorage.setItem(prefix + "session", sessionId);
      },
      {
        token: user.token,
        sessionId,
      },
    );
    await page.goto(`${origin}/qa`);
    await page.getByTestId("qa-surface-welcome-continue").click();
    const guide = page.getByRole("dialog", { name: "Как работать с агентом" });
    await guide.getByRole("checkbox").check();
    await guide
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    const summary = page.getByTestId("qa-composer-settings-summary");
    const selected = (model) =>
      waitFor(
        async () =>
          (await summary.textContent({ timeout: 1500 })).includes(model),
        `composer selection ${model}`,
      );
    const evidence = process.env.DSH_QA_MODEL_EVIDENCE;
    if (evidence) await mkdir(evidence, { recursive: true });
    await selected(models[0].model);
    const token = user.token;
    const options = () =>
      remote("accessUserModels", {
        token,
        sessionId,
        subroleId: null,
        adminPreview: false,
      });
    const initial = await options();
    assert.deepEqual(
      initial.models
        .map(({ provider, model }) => ({ provider, model }))
        .sort((a, b) => a.provider.localeCompare(b.provider)),
      pairs,
    );
    await assert.rejects(
      () =>
        remote("chatSelectModel", {
          token,
          request: {
            sessionId,
            provider: models[0].provider,
            model: deniedModel,
          },
        }),
      /not allowed/u,
    );
    const history = async () =>
      (
        await remote("chatPage", {
          token,
          request: {
            address: { kind: "session", sessionId },
            maxMessages: 100,
          },
        })
      ).records
        .filter((r) => r.type === "event")
        .map((r) => r.event);
    for (const [index, target] of [models[1], models[0]].entries()) {
      await page.getByTestId("qa-composer-settings-trigger").click();
      await page.getByTestId("qa-composer-settings-model").click();
      const choices = page.getByRole("menuitemradio");
      assert.equal(await choices.count(), 2);
      for (const { model } of models)
        assert.equal(
          await choices.getByText(model, { exact: true }).count(),
          1,
        );
      assert.equal(
        await choices.getByText(deniedModel, { exact: true }).count(),
        0,
      );
      if (evidence && index === 0)
        await page
          .getByTestId("qa-composer-settings-menu")
          .screenshot({ path: join(evidence, "available-models.png") });
      await choices.getByText(target.model, { exact: true }).click();
      await selected(target.model);
      await page.reload();
      await selected(target.model);
      assert.deepEqual(
        (await options()).selected,
        pairs.find((pair) => pair.provider === target.provider),
      );
      const marker = String((index + 1) * 1000000 + randomInt(1000000));
      const turn = beginTurn(marker);
      const before = (await history()).filter(
        (e) => e.type === "turn/end",
      ).length;
      await page
        .getByTestId("qa-composer-input")
        .fill(
          `Какое целое число следует за ${marker}? Посчитай в уме и ответь одним числом.`,
        );
      await page.getByTestId("qa-composer-send").click();
      const events = await waitFor(
        async () => {
          const entries = await history();
          return entries.filter((e) => e.type === "turn/end").length > before
            ? entries
            : undefined;
        },
        `reply from ${target.model}`,
        300000,
      );
      const reply = events.findLast((e) => e.type === "assistant/message")?.data
        .message;
      const sent = turn.request;
      assert.ok(sent, "no upstream request carried the fresh message");
      assert.equal(sent.provider, target.provider);
      assert.equal(sent.model, target.model);
      assert.equal(sent.status, 200);
      assert.equal(reply?.source?.provider, target.provider);
      assert.equal(reply.source.model, target.model);
      const answer = reply.content
        .find((part) => part.type === "text" && part.text.trim())
        ?.text.trim();
      assert.ok(answer, "expected a text reply to the current turn");
      // The Host can finish the turn before the browser has left its running
      // state. Wait for the idle composer before switching back in this tab.
      await page
        .getByTestId("qa-composer")
        .filter({ hasNot: page.getByTestId("qa-composer-stop") })
        .waitFor({ timeout: 60_000 });
      if (index === 1) await page.reload();
      await selected(target.model);
      await page
        .locator(".dsh-qa-message--assistant")
        .filter({ hasText: answer })
        .last()
        .waitFor();
      console.log(
        `packed QA model selection: turn ${index + 1} (${marker}) after reload reached ${sent.provider}/${sent.model} (HTTP ${sent.status}); assistant reply source matched`,
      );
      if (evidence)
        await page.screenshot({
          path: join(evidence, `turn-${index + 1}.png`),
        });
    }
  } finally {
    await browser.close();
  }
}
