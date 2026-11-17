import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freePort, rpc, run, stopProcess, waitFor } from "./smoke-helpers.mjs";

const YES = "Да, провести глубокий поиск";
const NO = "Нет, ответить по найденному";

/** Install the packed review/retrieval collaborators into this disposable Host. */
export async function installAnswerModePlugins({
  repo,
  root,
  dshBin,
  dshEnv,
  workspacePath,
}) {
  for (const name of [
    "dsh-answer-review-gate",
    "dsh-lightrag",
    "dsh-domain-experts",
  ]) {
    const packed = join(root, name);
    await mkdir(packed);
    await run("pnpm", ["pack", "--pack-destination", packed], {
      cwd: join(repo, "..", name),
    });
    const [tarball] = await readdir(packed);
    await run(
      process.execPath,
      [dshBin, "plugin", "--profile", "web", "add", join(packed, tarball)],
      {
        cwd: workspacePath,
        env: dshEnv,
      },
    );
  }
}

/** Packed Host, native tool guard and actual QA question RPC; scripted local LLM. */
export async function runAnswerModesPass(options) {
  const {
    dshBin,
    dshEnv,
    root,
    workspacePath,
    workspaceId,
    launchToken,
    authenticateBrowser,
    hostLog,
    dshVersion,
  } = options;
  assert.equal(
    typeof workspaceId,
    "string",
    "The fixture needs a registered workspace identity",
  );
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
  const expertReview =
    process.env.DSH_QA_RAG_REVIEW_BACKEND === "domain-expert";
  if (expertReview) {
    // Every Host using this disposable home is stopped at this boundary. Seed
    // the deployment record before boot: native operator RPCs are correctly
    // unavailable through the account-only browser connection.
    const { emptyDomainDraft } =
      await import("../../dsh-domain-experts/lib/types.js");
    const draft = emptyDomainDraft("demo-answer-reviewer", Date.now());
    const definition = {
      ...draft,
      enabled: true,
      name: "Demo answer reviewer",
      description: "Review the synthetic answer.",
      tools: { allow: ["qa_list_subagent_models"], deny: [] },
      model: {
        ...draft.model,
        inherit: false,
        provider: "qa-modes-demo",
        model: "review-demo",
      },
    };
    const storage = join(dshEnv.DSH_HOME, "storages");
    await mkdir(storage, { recursive: true });
    await writeFile(
      join(storage, "domain_experts.json"),
      JSON.stringify({
        unit: { name: "domain_experts", version: 1 },
        global: {},
        tables: { domains: { [definition.id]: definition }, memory: {} },
      }) + "\n",
    );
  }
  const completed = new Set();
  const failures = [];
  const reviews = new Set();
  let ragQueries = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (request.url === "/query") {
        assert.equal(body.mode, "hybrid");
        assert.equal(body.include_chunk_content, true);
        ragQueries += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            response:
              "The demo system provides Overview and Reports dashboards.",
            llm_generated: true,
            references: [
              {
                reference_id: "1",
                file_path: "docs/dashboards.md",
                content: [
                  "The demo system provides Overview and Reports dashboards.",
                ],
              },
            ],
          }),
        );
        return;
      }
      const serialized = JSON.stringify(body.messages);
      const scenarios = [
        ...serialized.matchAll(
          /MODE_(ALLOW|DENY|SKIP|AFTER|DEEP|EVIDENCE)_DEMO/gu,
        ),
      ];
      const scenario = scenarios.at(-1)?.[1];
      const phase = phases.get(scenario) ?? 0;
      let text = "Demo research";
      let tool;
      if (body.model === "review-demo") {
        const key = `review-${scenario}`;
        const reviewPhase = phases.get(key) ?? 0;
        if (reviewPhase === 0) {
          if (scenario === "EVIDENCE") {
            assert.ok(
              serialized.includes(
                "independent answer reviewer for a RAG Priority request",
              ),
            );
            assert.ok(!serialized.includes("RAG Priority is active"));
          }
          tool = { name: "qa_list_subagent_models", arguments: {} };
        } else {
          const last =
            body.messages.filter((message) => message.role === "tool").at(-1)
              ?.content ?? "";
          assert.match(last, /models/u);
          assert.ok(!last.includes("RAG Priority is active"));
          assert.equal(
            reviewPhase,
            1,
            "The review must finish after structured output",
          );
          tool = {
            name: "structured_output",
            arguments: expertReview
              ? {
                  summary: "Claims match the supplied evidence.",
                  findings: [],
                  conflicts: [],
                  assumptions: [],
                  followUps: [],
                }
              : {
                  verdict: "pass",
                  summary: "Claims match the supplied evidence.",
                  issues: [],
                  confidence: "high",
                },
          };
          reviews.add(scenario);
        }
        phases.set(key, reviewPhase + 1);
      } else if (scenario === "EVIDENCE") {
        const last =
          body.messages.filter((message) => message.role === "tool").at(-1)
            ?.content ?? "";
        if (phase === 0) {
          assert.ok(serialized.includes("not used a second retrieval mode"));
          tool = { name: "skill", arguments: { name: "demo-glossary" } };
        } else if (phase === 1) {
          assert.match(last, /Demo glossary loaded/u);
          tool = {
            name: "dsh_lightrag_query",
            arguments: {
              question: "Which dashboards does the demo system provide?",
              mode: "hybrid",
              withContent: true,
            },
          };
        } else if (phase === 2) {
          assert.match(last, /Retrieval evidence: sources-found/u);
          assert.match(last, /Overview and Reports/u);
          tool = { name: "qa_list_subagent_models", arguments: {} };
        } else {
          assert.match(last, /RAG Priority is active/u);
          text =
            "MODE_EVIDENCE_DEMO: Overview and Reports dashboards are available [docs/dashboards.md].";
          completed.add(scenario);
        }
        phases.set(scenario, phase + 1);
      } else if (
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
  const seedRoot = join(root, "rag-skills");
  await mkdir(join(seedRoot, "demo-glossary"), { recursive: true });
  await writeFile(
    join(seedRoot, "demo-glossary", "SKILL.md"),
    "---\nname: demo-glossary\ndescription: Synthetic dashboard terminology.\nmetadata:\n  qa-surface:\n    version: 1\n    audience:\n      type: common\n---\n\nDemo glossary loaded. Use the retrieved source names in your answer.\n",
  );
  await writeFile(
    patch,
    `- id: dsh-qa-surface
  config:
    accounts:
      enabled: true
      allowRegistration: true
      perUserWorkspace: true
      skills:
        enabled: true
        sharedSeed:
          root: ${JSON.stringify(seedRoot.replaceAll("\\", "/"))}
          names: [demo-glossary]
    session:
      workspaceId: ${workspaceId}
      agentPreset: standard
      provider: qa-modes-demo
      model: mode-demo
    interaction:
      questions: interactive
    tools:
      dynamicActivation: false
      activationPresets: []
    lockdown:
      sandboxMode: workspace-write
      permissionPreset: qa-workspace-write
- id: permission
  config:
    defaultPreset: qa-workspace-write
    presets:
      qa-workspace-write:
        sandbox: workspace-write
        approval: never
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
          - id: review-demo
            name: Review demo
- id: dsh-lightrag
  config:
    endpoint: http://127.0.0.1:${server.address().port}
- id: dsh-answer-review-gate
  config:
    failMode: closed
    reviewer:
      backend: ${expertReview ? "domain-expert" : "subagent"}
      domain: demo-answer-reviewer
      provider: spawn
      route: qa-modes-demo
      model: review-demo
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
    const accountMethod = options.reuseAccounts
      ? "accountsLogin"
      : "accountsRegister";
    const admin = await remote(accountMethod, {
      email: "modes-admin@example.test",
      password: "demo-password-admin",
    });
    const user = await remote(accountMethod, {
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
          skills: ["demo-glossary"],
          tools: {
            ...general.capabilities.tools,
            always: [
              "ask_user_question",
              "qa_list_subagent_models",
              "skill",
              "dsh_lightrag_query",
            ],
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
    await assert.rejects(
      remote("slashExecute", {
        token: "",
        sessionId,
        line: "/no-review MODE_FAST_DEMO",
        attachments: [],
        modes: ["fast", "rag"],
      }),
    );
    const refused = await remote("slashExecute", {
      token: user.token,
      sessionId,
      line: "/qa_unknown_demo",
      attachments: [],
      modes: ["fast", "rag"],
    });
    assert.equal(refused.kind, "refused");
    for (const scenario of [
      "ALLOW",
      "AFTER",
      "DENY",
      "SKIP",
      "DEEP",
      "EVIDENCE",
    ]) {
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
      if (scenario !== "DEEP" && scenario !== "EVIDENCE") {
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
    assert.equal(ragQueries, 1, "A supported answer needs only one retrieval");
    assert.ok(
      reviews.has("EVIDENCE"),
      "The RAG-backed answer must pass independent review",
    );
    const page = await remote("chatPage", {
      token: user.token,
      request: { address: { kind: "session", sessionId }, maxMessages: 100 },
    });
    assert.match(
      JSON.stringify(page),
      /"status":"pass"/u,
      "The Host must publish a successful review receipt",
    );
    console.log(
      `packed QA answer modes: request metadata, consent allow/deny/skip, expiry, skill loading, one supported RAG retrieval, restricted primary tools and independent ${expertReview ? "domain-expert" : "subagent"} reviewer tools/structured output passed`,
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
  for (const { width, height } of [
    { width: 1280, height: 900 },
    { width: 390, height: 900 },
    { width: 320, height: 900 },
    { width: 640, height: 240 },
    { width: 320, height: 240 },
  ]) {
    await page.setViewportSize({ width, height });
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
    assert.equal(
      await page.locator(".dsh-qa-composer__fast-warning").count(),
      0,
    );
    const popup = page.getByRole("group", {
      name: "Режимы ответа",
      exact: true,
    });
    const box = await popup.boundingBox();
    assert.ok(
      box &&
        box.x >= 0 &&
        box.x + box.width <= width &&
        box.y >= 0 &&
        box.y + box.height <= height,
    );
    assert.equal(
      await popup
        .getByText("Если RAG не даст ответа, спросим, нужен ли глубокий поиск.")
        .count(),
      0,
    );
    const rag = page.getByRole("checkbox", {
      name: "RAG Priority",
      exact: true,
    });
    // A click dismisses its tooltip; deliberately leave before hovering again.
    await page.mouse.move(0, 0);
    await rag.hover();
    const tip = page.locator(
      `[id="${await rag.getAttribute("aria-describedby")}"]`,
    );
    await tip.waitFor({ state: "visible" });
    await page.waitForFunction(
      (id) =>
        globalThis.getComputedStyle(globalThis.document.getElementById(id))
          .opacity === "1",
      await tip.getAttribute("id"),
    );
    await page.screenshot({
      path: join(evidenceDirectory, `mode-menu-${width}x${height}.png`),
    });
    const tooltipBox = await tip.boundingBox();
    assert.ok(
      tooltipBox &&
        tooltipBox.x >= 0 &&
        tooltipBox.x + tooltipBox.width <= width &&
        tooltipBox.y >= 0 &&
        tooltipBox.y + tooltipBox.height <= height,
    );
    measurements.push({ width, height, popup: box, tooltip: tooltipBox });
    await rag.press("Escape");
    await trigger.hover();
    const combined = page.locator(
      `[id="${await trigger.getAttribute("aria-describedby")}"]`,
    );
    await combined.waitFor({ state: "visible" });
    await page.waitForFunction(
      (id) =>
        globalThis.getComputedStyle(globalThis.document.getElementById(id))
          .opacity === "1",
      await combined.getAttribute("id"),
    );
    const combinedBox = await combined.boundingBox();
    assert.ok(
      combinedBox &&
        combinedBox.y >= 0 &&
        combinedBox.y + combinedBox.height <= height,
    );
    const overflow = await combined.evaluate((element) => ({
      scrollable: element.scrollHeight > element.clientHeight,
      overflowY: globalThis.getComputedStyle(element).overflowY,
      pointerEvents: globalThis.getComputedStyle(element).pointerEvents,
    }));
    assert.equal(overflow.overflowY, "auto");
    if (overflow.scrollable) {
      assert.equal(overflow.pointerEvents, "auto");
      await combined.hover();
      await page.mouse.wheel(0, 1000);
      await page.waitForFunction(
        (id) => {
          const element = globalThis.document.getElementById(id);
          return (
            element.scrollTop > 0 &&
            element.scrollTop + element.clientHeight >= element.scrollHeight - 1
          );
        },
        await combined.getAttribute("id"),
      );
      await page.screenshot({
        path: join(evidenceDirectory, `mode-tooltip-${width}x${height}.png`),
      });
    }
    await trigger.click();
    // All three options must remain pointer-reachable after scrolling a short menu.
    const deep = page.getByRole("checkbox", {
      name: "Deep Thinking",
      exact: true,
    });
    await deep.uncheck();
    await deep.check();
    await page.getByRole("checkbox", { name: "Fast", exact: true }).uncheck();
    await page
      .getByRole("checkbox", { name: "RAG Priority", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "Deep Thinking", exact: true })
      .press("Escape");
    await trigger.hover();
    const buttonTip = page.locator(
      `[id="${await trigger.getAttribute("aria-describedby")}"]`,
    );
    await buttonTip.waitFor({ state: "visible" });
    await page.waitForFunction(
      (id) =>
        globalThis.getComputedStyle(globalThis.document.getElementById(id))
          .opacity === "1",
      await buttonTip.getAttribute("id"),
    );
    assert.match(await buttonTip.textContent(), /Документацию|документацию/u);
    // The first option's tooltip must also escape the scroll container.
    await trigger.click();
    const fast = page.getByRole("checkbox", { name: "Fast", exact: true });
    await fast.hover();
    const fastTip = page.locator(
      `[id="${await fast.getAttribute("aria-describedby")}"]`,
    );
    await fastTip.waitFor({ state: "visible" });
    const fastBox = await fastTip.boundingBox();
    assert.ok(
      fastBox && fastBox.y >= 0 && fastBox.y + fastBox.height <= height,
    );
    await fast.press("Escape");
  }
  await writeFile(
    join(evidenceDirectory, "measurements.json"),
    `${JSON.stringify(measurements, null, 2)}\n`,
  );
  console.log(
    "packed QA answer mode UI: multi-select, names, Escape, scrollable options and mode/button tooltip bounds passed at 1280/390/320 px and 640x240/320x240 px",
  );
}
