import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freePort, rpc, run, stopProcess, waitFor } from "./smoke-helpers.mjs";

const YES = "Да, провести глубокий поиск";
const NO = "Нет, ответить по найденному";

/** Packed Host, native tool guard and actual QA question RPC; scripted local LLM. */
export async function runAnswerModesPass(options) {
  const {
    dshBin,
    dshEnv,
    root,
    workspacePath,
    launchToken,
    authenticateBrowser,
    hostLog,
    dshVersion,
  } = options;
  await run(
    process.execPath,
    [
      dshBin,
      "plugin",
      "--profile",
      "web",
      "add",
      `@deepseek-ai/dsh-user-questions@${dshVersion}`,
    ],
    { cwd: workspacePath, env: dshEnv },
  );
  await run(
    process.execPath,
    [
      dshBin,
      "plugin",
      "--profile",
      "web",
      "add",
      `@deepseek-ai/dsh-tool-ask-user@${dshVersion}`,
    ],
    { cwd: workspacePath, env: dshEnv },
  );
  const phases = new Map();
  const completed = new Set();
  const failures = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const serialized = JSON.stringify(body.messages);
      const scenarios = [
        ...serialized.matchAll(/MODE_(ALLOW|DENY|SKIP|AFTER|DEEP)_DEMO/gu),
      ];
      const scenario = scenarios.at(-1)?.[1];
      const phase = phases.get(scenario) ?? 0;
      let text = "Demo research";
      let tool;
      if (
        scenario &&
        body.tools?.some(
          (entry) => entry.function.name === "qa_list_subagent_models",
        )
      ) {
        const results = body.messages.filter(
          (message) => message.role === "tool",
        );
        const last = results.at(-1)?.content ?? "";
        if (phase === 0) {
          assert.ok(
            body.tools.some(
              (entry) => entry.function.name === "ask_user_question",
            ),
            `The disposable preset must expose ask_user_question; visible tools: ${body.tools.map((entry) => entry.function.name).join(", ")}`,
          );
          assert.ok(
            serialized.includes(
              scenario === "DEEP"
                ? "Deep Thinking:"
                : "For this request RAG Priority overrides",
            ),
            `Expected ${scenario} mode note; received synthetic prompt: ${serialized}`,
          );
          tool = { name: "qa_list_subagent_models", arguments: {} };
        } else if (scenario === "DEEP") {
          assert.match(last, /models/u);
          assert.ok(!last.includes("RAG Priority is active"));
          text = `Completed MODE_${scenario}_DEMO`;
          completed.add(scenario);
        } else if (phase === 1) {
          assert.match(last, /RAG Priority is active/u);
          tool = {
            name: "ask_user_question",
            arguments: {
              questions: [
                {
                  id: "qa-rag-deep-search",
                  question: "Caller text must be replaced",
                  options: [
                    { label: "Unrelated", description: "Synthetic choice" },
                    {
                      label: "Another choice",
                      description: "Synthetic alternative",
                    },
                  ],
                },
              ],
            },
          };
        } else if (phase === 2) {
          if (scenario === "ALLOW")
            assert.ok(
              serialized.includes(
                "The user explicitly approved deep search for this request",
              ),
              `Missing consent receipt; last synthetic tool result: ${last}`,
            );
          tool = { name: "qa_list_subagent_models", arguments: {} };
        } else {
          if (scenario === "ALLOW") {
            assert.match(last, /models/u);
            assert.ok(!last.includes("RAG Priority is active"));
          } else assert.match(last, /RAG Priority is active/u);
          text = `Completed MODE_${scenario}_DEMO`;
          completed.add(scenario);
        }
        phases.set(scenario, phase + 1);
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const delta = tool
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `mode-${scenario}-${phase}`,
                type: "function",
                function: {
                  name: tool.name,
                  arguments: JSON.stringify(tool.arguments),
                },
              },
            ],
          }
        : { role: "assistant", content: text };
      const frame = (choices) =>
        response.write(
          `data: ${JSON.stringify({ id: "answer-mode-demo", object: "chat.completion.chunk", created: 1, model: body.model, choices })}\n\n`,
        );
      frame([{ index: 0, delta, finish_reason: null }]);
      frame([
        { index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
      ]);
      response.end("data: [DONE]\n\n");
    } catch (error) {
      failures.push(error);
      response.writeHead(500);
      response.end("Synthetic mode assertion failed.");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const patch = join(root, "answer-modes.patch.yml");
  await writeFile(
    patch,
    `- id: dsh-qa-surface
  config:
    accounts:
      enabled: true
      allowRegistration: true
    session:
      agentPreset: standard
      provider: qa-modes-demo
      model: mode-demo
    interaction:
      questions: interactive
    tools:
      dynamicActivation: false
      activationPresets: []
- id: tools
  config:
    mode: native
- id: llm-pi-ai
  config:
    providers:
      qa-modes-demo:
        displayName: QA modes demo
        api: openai-completions
        apiKeyEnv: QA_MODES_SMOKE_KEY
        baseURL: http://127.0.0.1:${server.address().port}/v1
        models:
          - id: mode-demo
            name: Mode demo
`,
  );
  let host;
  const log = [];
  try {
    host = spawn(
      process.execPath,
      [dshBin, "web", "--patch", patch, "--no-open", "--port", String(port)],
      {
        cwd: workspacePath,
        env: { ...dshEnv, QA_MODES_SMOKE_KEY: "synthetic-smoke-key" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    host.stdout.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
    host.stderr.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
    const launch = await waitFor(() => launchToken(log), "answer modes Host");
    const cookie = await authenticateBrowser(port, `127.0.0.1:${port}`, launch);
    const remote = (name, args) =>
      rpc(origin, `qaSurface/${name}`, { args }, cookie);
    const admin = await remote("accountsRegister", {
      email: "modes-admin@example.test",
      password: "demo-password-admin",
    });
    const user = await remote("accountsRegister", {
      email: "modes-user@example.test",
      password: "demo-password-user",
    });
    const snapshot = await remote("accessAdminSnapshot", {
      token: admin.token,
    });
    const general = snapshot.config.subroles.find(
      (entry) => entry.id === "general",
    );
    assert.ok(general);
    await remote("accessUpdateSubrole", {
      token: admin.token,
      id: general.id,
      input: {
        ...general,
        capabilities: {
          ...general.capabilities,
          tools: {
            ...general.capabilities.tools,
            always: ["ask_user_question", "qa_list_subagent_models"],
          },
        },
      },
    });
    const sessionId = await remote("createSession", {
      token: user.token,
      subroleId: null,
      adminPreview: false,
    });
    // Anonymous or unrelated callers cannot prepare another user's request.
    await assert.rejects(
      remote("prepareAnswerModes", {
        token: "",
        sessionId,
        requestId: randomUUID(),
        modes: ["rag"],
      }),
    );
    for (const scenario of ["ALLOW", "AFTER", "DENY", "SKIP", "DEEP"]) {
      const requestId = randomUUID();
      await remote("prepareAnswerModes", {
        token: user.token,
        sessionId,
        requestId,
        modes: scenario === "DEEP" ? ["deep"] : ["deep", "rag"],
      });
      await remote("chatPrompt", {
        token: user.token,
        request: {
          sessionId,
          requestId,
          mode: "queue",
          content: [{ type: "text", text: `MODE_${scenario}_DEMO` }],
        },
      });
      if (scenario !== "DEEP") {
        const pending = await waitFor(async () => {
          if (failures.length) return { fixtureError: failures[0].message };
          return (
            await remote("pendingQuestions", { token: user.token, sessionId })
          )[0];
        }, `mode consent ${scenario}`);
        assert.equal(failures.length, 0, failures[0]?.stack);
        assert.match(pending.questions[0].question, /Провести глубокий поиск/u);
        assert.deepEqual(
          pending.questions[0].options.map((option) => option.label),
          [YES, NO],
        );
        await remote("answerQuestion", {
          token: user.token,
          sessionId,
          requestId: pending.id,
          answers: [
            {
              id: "qa-rag-deep-search",
              selected:
                scenario === "ALLOW" ? [YES] : scenario === "SKIP" ? [] : [NO],
            },
          ],
        });
      }
      await waitFor(() => {
        return failures.length > 0 || completed.has(scenario);
      }, `mode completion ${scenario}`);
      assert.equal(failures.length, 0, failures[0]?.stack);
      await waitFor(
        async () =>
          (await remote("chatList", { token: user.token })).items.find(
            (item) => item.sessionId === sessionId,
          )?.running === false,
        `mode idle ${scenario}`,
      );
    }
    assert.equal(failures.length, 0, failures[0]?.message);
    console.log(
      "packed QA answer modes: request metadata, authenticated preparation, blocked deep tools, canonical consent, allow/deny/skip, next-turn consent expiry and default deep tools passed",
    );
  } catch (error) {
    hostLog.push(...log);
    throw error;
  } finally {
    await stopProcess(host);
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Geometry and actual hover/focus styles in the installed, packed browser client. */
export async function runAnswerModesBrowserPass(page, evidenceDirectory) {
  await mkdir(evidenceDirectory, { recursive: true });
  const measurements = [];
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.getByTestId("qa-composer-modes");
    await trigger.click();
    await page.getByRole("checkbox", { name: "Fast", exact: true }).check();
    await page
      .getByRole("checkbox", { name: "RAG Priority", exact: true })
      .check();
    assert.match(
      await trigger.innerText(),
      /Fast \+ Deep Thinking \+ RAG Priority/u,
    );
    const popup = page.getByRole("group", {
      name: "Режимы ответа",
      exact: true,
    });
    const box = await popup.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0);
    assert.equal(
      await popup
        .getByText("Если RAG не даст ответа, спросим, нужен ли глубокий поиск.")
        .count(),
      0,
    );
    await page
      .getByRole("checkbox", { name: "RAG Priority", exact: true })
      .hover();
    const tip = popup.getByRole("tooltip").last();
    await tip.waitFor({ state: "visible" });
    await page.waitForFunction(
      (id) =>
        globalThis.getComputedStyle(globalThis.document.getElementById(id))
          .opacity === "1",
      await tip.getAttribute("id"),
    );
    await page.screenshot({
      path: join(evidenceDirectory, `mode-menu-${width}.png`),
    });
    const tooltipBox = await tip.boundingBox();
    assert.ok(
      tooltipBox &&
        tooltipBox.x >= 0 &&
        tooltipBox.x + tooltipBox.width <= width &&
        tooltipBox.y >= 0,
    );
    measurements.push({ width, popup: box, tooltip: tooltipBox });
    await page.getByRole("checkbox", { name: "Fast", exact: true }).uncheck();
    await page
      .getByRole("checkbox", { name: "RAG Priority", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "Deep Thinking", exact: true })
      .press("Escape");
    await trigger.hover();
    const buttonTip = page.locator(
      ".dsh-qa-modes>.dsh-qa-modes__tooltip-owner>.dsh-qa-modes__tooltip",
    );
    await buttonTip.waitFor({ state: "visible" });
    await page.waitForFunction(
      (id) =>
        globalThis.getComputedStyle(globalThis.document.getElementById(id))
          .opacity === "1",
      await buttonTip.getAttribute("id"),
    );
    assert.match(await buttonTip.textContent(), /Документацию|документацию/u);
  }
  await writeFile(
    join(evidenceDirectory, "measurements.json"),
    `${JSON.stringify(measurements, null, 2)}\n`,
  );
  console.log(
    "packed QA answer mode UI: multi-select, names, Escape and mode/button tooltip bounds passed at 1280/390/320 px",
  );
}
