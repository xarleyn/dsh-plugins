import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freePort, rpc, run, stopProcess, waitFor } from "./smoke-helpers.mjs";
import { runImplementerGuidePass } from "./smoke-usage-guide-browser.mjs";

const YES = "Да, провести глубокий поиск";
const NO = "Нет, ответить по найденному";

const lifecycleCandidate = (scenario) =>
  `MODE_${scenario}_DEMO. The synthetic review fixture confirms that Overview and Reports are available in the dashboard catalogue.`;

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

export async function installAnswerModeQuestionPlugins({
  dshBin,
  dshEnv,
  workspacePath,
  dshVersion,
}) {
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
    guideEvidenceDirectory,
  } = options;
  assert.equal(
    typeof workspaceId,
    "string",
    "The fixture needs a registered workspace identity",
  );
  await installAnswerModeQuestionPlugins(options);
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
      tools: { allow: ["qa_list_subagent_models", "qa_subagent"], deny: [] },
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
        unit: { name: "domain_experts", version: 2 },
        global: { domains: [definition] },
        tables: { domains: {}, memory: {} },
      }) + "\n",
    );
  }
  const completed = new Set();
  const failures = [];
  const reviews = new Set();
  const waitingReviews = new Set();
  const closedReviews = new Set();
  const localToolChecks = new Map();
  const inspectedModels = new Set();
  const expertLaunches = new Map();
  let workerReadStarted = false;
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
          /MODE_(ALLOW|DENY|SKIP|AFTER|DEEP|EVIDENCE|CANCEL|TIMEOUT|CURRENT|GUIDE|EXPERT_LOCAL|EXPERT_DENY|EXPERT_ALLOW)_DEMO/gu,
        ),
      ];
      const scenario = scenarios.at(-1)?.[1];
      const phase = phases.get(scenario) ?? 0;
      let text = "Demo research";
      let tool;
      const reviewer = body.tools?.some(
        (entry) => entry.function.name === "structured_output",
      );
      if (reviewer) {
        assert.equal(body.model, expertReview ? "mode-demo" : "review-demo");
      }
      if (
        (reviewer && scenario === "TIMEOUT") ||
        (body.model === "worker-demo" && scenario === "CANCEL")
      ) {
        assert.ok(!waitingReviews.has(scenario), "Review was started twice");
        response.on("close", () => closedReviews.add(scenario));
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(": waiting for review cancellation\n\n");
        waitingReviews.add(scenario);
        return;
      }
      const actor = reviewer
        ? "reviewer"
        : body.model === "worker-demo"
          ? "worker"
          : "parent";
      if (scenario === "CURRENT" && !inspectedModels.has(actor)) {
        inspectedModels.add(actor);
        const inventory = (body.tools ?? [])
          .map((entry) => entry.function.name)
          .sort();
        console.log(
          `packed review inventory (${actor}, ${body.model}): ${inventory.join(", ")}`,
        );
        if (actor === "parent") assert.ok(inventory.includes("write"));
        else {
          assert.ok(inventory.includes("qa_subagent"));
          assert.ok(
            !inventory.includes("write") &&
              !inventory.includes("pwsh") &&
              !inventory.includes("bash"),
          );
        }
      }
      if (localToolChecks.get(actor) === "pending") {
        const last = body.messages
          .filter((message) => message.role === "tool")
          .at(-1);
        assert.match(
          last?.content ?? "",
          /outside the reviewer's configured tool policy/u,
        );
        localToolChecks.set(actor, "denied");
      }
      const expertTask =
        !reviewer &&
        scenario?.startsWith("EXPERT_") &&
        body.messages.some(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message.content).includes(
              "Investigate the following and report the root cause with evidence.",
            ),
        );
      if (expertTask) {
        assert.notEqual(
          scenario,
          "EXPERT_DENY",
          "The rejected expert received its task",
        );
        assert.equal(
          body.model,
          scenario === "EXPERT_LOCAL" ? "mode-demo" : "worker-demo",
        );
        assert.ok(!expertLaunches.has(scenario), "The expert started twice");
        expertLaunches.set(scenario, body.model);
        text = "Synthetic expert completed.";
      } else if (
        !reviewer &&
        scenario?.startsWith("EXPERT_") &&
        body.tools?.some((entry) => entry.function.name === "domain_expert")
      ) {
        if (phase === 0) {
          tool = {
            name: "domain_expert",
            arguments: {
              domain: "demo-answer-reviewer",
              task: `MODE_${scenario}_DEMO`,
              ...(scenario === "EXPERT_LOCAL"
                ? {}
                : { provider: "qa-modes-demo", model: "worker-demo" }),
            },
          };
        } else {
          const last = body.messages
            .filter((message) => message.role === "tool")
            .at(-1);
          assert.match(
            last?.content ?? "",
            scenario === "EXPERT_DENY"
              ? /EXPERT_MODEL_NOT_APPROVED/u
              : /Synthetic expert completed/u,
          );
          completed.add(scenario);
          text = "Expert model check completed.";
        }
        phases.set(scenario, phase + 1);
      } else if (
        scenario === "CURRENT" &&
        actor !== "parent" &&
        !localToolChecks.has(actor) &&
        body.tools?.some((entry) => entry.function.name === "file_delete")
      ) {
        // The QA catalog can advertise this agent-local tool after the mask.
        // Use an uncreated synthetic path and require the policy's own refusal.
        tool = {
          name: "file_delete",
          arguments: { path: "review-probe-never-created.txt" },
        };
        localToolChecks.set(actor, "pending");
      } else if (body.model === "worker-demo") {
        assert.equal(scenario, "CURRENT");
        if (!workerReadStarted) {
          tool = { name: "qa_list_subagent_models", arguments: {} };
          workerReadStarted = true;
        } else {
          const last = body.messages
            .filter((message) => message.role === "tool")
            .at(-1);
          assert.match(last?.content ?? "", /worker-demo/u);
          text = "The delegated catalog check found worker-demo.";
        }
      } else if (reviewer) {
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
          tool =
            scenario === "CURRENT" || scenario === "CANCEL"
              ? {
                  name: "qa_subagent",
                  arguments: {
                    description: "Check the demo catalogue",
                    prompt: `Verify both dashboard entries for MODE_${scenario}_DEMO.`,
                    provider: "qa-modes-demo",
                    model: "worker-demo",
                  },
                }
              : { name: "qa_list_subagent_models", arguments: {} };
        } else {
          const last =
            body.messages.filter((message) => message.role === "tool").at(-1)
              ?.content ?? "";
          assert.match(
            last,
            scenario === "CURRENT"
              ? /delegated catalog check found worker-demo/u
              : /models/u,
          );
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
                  comparisons: [],
                  findings: [],
                  conflicts: [],
                  assumptions: [],
                  followUps: [],
                }
              : {
                  verdict: "pass",
                  summary: "Claims match the supplied evidence.",
                  comparisons: [],
                  issues: [],
                  confidence: "high",
                },
          };
          reviews.add(scenario);
        }
        phases.set(key, reviewPhase + 1);
      } else if (["CANCEL", "TIMEOUT", "CURRENT"].includes(scenario)) {
        text =
          phase === 0 ? lifecycleCandidate(scenario) : "Review unavailable.";
        phases.set(scenario, phase + 1);
      } else if (scenario === "GUIDE") {
        if (phase === 0) {
          tool = {
            name: "docs_read",
            arguments: { path: "dashboard/v2.1/reporting.md" },
          };
        } else {
          const last =
            body.messages.filter((message) => message.role === "tool").at(-1)
              ?.content ?? "";
          assert.match(last, /В версии 2\.1 доступны обзор и отчёты/u);
          text =
            "В версии 2.1 доступны обзор и отчёты. Источник: reporting.md, раздел «Доступные отчёты».";
        }
        phases.set(scenario, phase + 1);
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
                : "RAG Priority overrides earlier source guidance",
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
  const docsRoot = join(root, "guide-docs");
  const docsRootYaml = JSON.stringify(docsRoot.replaceAll("\\", "/"));
  if (guideEvidenceDirectory) {
    const edition = join(docsRoot, "dashboard", "v2.1");
    await mkdir(edition, { recursive: true });
    await writeFile(
      join(edition, "reporting.md"),
      "## Доступные отчёты\n\nВ версии 2.1 доступны обзор и отчёты.\n",
    );
  }
  await mkdir(join(seedRoot, "demo-glossary"), { recursive: true });
  await writeFile(
    join(seedRoot, "demo-glossary", "SKILL.md"),
    "---\nname: demo-glossary\ndescription: Synthetic dashboard terminology.\nmetadata:\n  qa-surface:\n    version: 1\n    audience:\n      type: common\n---\n\nDemo glossary loaded. Use the retrieved source names in your answer.\n",
  );
  await writeFile(
    patch,
    `- insert:
    - id: preset-review-demo
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: review-demo
        plugins:
          - id: search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
- id: dsh-qa-surface
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
      model: ${expertReview && !guideEvidenceDirectory ? "review-demo" : "mode-demo"}
    interaction:
      questions: interactive
      approvals: interactive
    ${guideEvidenceDirectory ? "slashCommands: { commands: { mode: allow-list, allow: [no-review] } }" : ""}
    tools:
      dynamicActivation: false
      activationPresets: []
      ${guideEvidenceDirectory ? "docsRoot: " + docsRootYaml : ""}
    lockdown:
      sandboxMode: workspace-write
      permissionPreset: qa-workspace-write
      ${guideEvidenceDirectory ? "allowSlashCommands: true" : ""}
      ${guideEvidenceDirectory ? "sharedReadOnlyRoots: [" + docsRootYaml + "]" : ""}
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
          - id: worker-demo
            name: Worker demo
- id: subagent
  config:
    maxDepth: 3
- id: dsh-lightrag
  config:
    endpoint: http://127.0.0.1:${server.address().port}
- id: dsh-answer-review-gate
  config:
    failMode: closed
    ${guideEvidenceDirectory ? "waiver: { allowedInClosedMode: true }" : ""}
    reviewer:
      ${expertReview ? "" : "agentPreset: review-demo"}
      enforceAllowedTools: true
      allowedTools: [read, grep, qa_list_subagent_models, qa_subagent]
      roundTimeoutMs: 10000
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
    const login = {
      email: "modes-user@example.test",
      password: "demo-password-user",
    };
    const user = await remote(accountMethod, login);
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
        allowedModels: [
          { provider: "qa-modes-demo", model: "worker-demo" },
          ...(expertReview
            ? [{ provider: "qa-modes-demo", model: "mode-demo" }]
            : []),
        ],
        capabilities: {
          ...general.capabilities,
          skills: ["demo-glossary"],
          tools: {
            ...general.capabilities.tools,
            always: [
              "ask_user_question",
              "qa_list_subagent_models",
              "qa_subagent",
              "write",
              "skill",
              "dsh_lightrag_query",
              ...(expertReview ? ["domain_expert"] : []),
              ...(guideEvidenceDirectory ? ["docs_read"] : []),
            ],
          },
        },
      },
    });
    if (guideEvidenceDirectory) {
      await runImplementerGuidePass({
        origin,
        authenticatedUrl: `${origin}/?token=${encodeURIComponent(launch)}`,
        login,
        remote,
        user,
        admin,
        evidenceDirectory: guideEvidenceDirectory,
      });
      assert.equal(failures.length, 0, failures[0]?.stack);
    }
    const sessionId = await remote("createSession", {
      token: user.token,
      subroleId: null,
      adminPreview: false,
    });
    if (expertReview && !guideEvidenceDirectory) {
      await remote("chatSelectModel", {
        token: user.token,
        request: { sessionId, provider: "qa-modes-demo", model: "mode-demo" },
      });
    }
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
      if (guideEvidenceDirectory && scenario === "DENY") continue;
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
          failures.length > 0 ||
          (await remote("chatList", { token: user.token })).items.find(
            (item) => item.sessionId === sessionId,
          )?.running === false,
        `mode idle ${scenario}`,
      );
      assert.equal(failures.length, 0, failures[0]?.stack);
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
    if (expertReview) {
      for (const scenario of ["EXPERT_LOCAL", "EXPERT_DENY", "EXPERT_ALLOW"]) {
        const requestId = randomUUID();
        await remote("chatPrompt", {
          token: user.token,
          request: {
            sessionId,
            requestId,
            mode: "queue",
            content: [{ type: "text", text: `MODE_${scenario}_DEMO` }],
          },
        });
        if (scenario !== "EXPERT_LOCAL") {
          const pending = await waitFor(async () => {
            if (failures.length) throw failures[0];
            return (
              await remote("pendingApprovals", { token: user.token, sessionId })
            )[0];
          }, `expert model approval ${scenario}`);
          assert.equal(pending.kind, "expert-model-switch");
          assert.match(pending.reason, /mode-demo.*worker-demo/u);
          assert.ok(
            !expertLaunches.has(scenario),
            "The expert received its task before approval",
          );
          assert.equal(
            await remote("answerApproval", {
              token: user.token,
              sessionId,
              requestId: pending.id,
              decision:
                scenario === "EXPERT_ALLOW" ? "allowed-once" : "rejected",
            }),
            true,
          );
        }
        await waitFor(async () => {
          if (failures.length) throw failures[0];
          return (
            completed.has(scenario) &&
            (await remote("chatList", { token: user.token })).items.find(
              (item) => item.sessionId === sessionId,
            )?.running === false
          );
        }, `expert model completion ${scenario}`);
      }
      assert.deepEqual(
        [...expertLaunches],
        [
          ["EXPERT_LOCAL", "mode-demo"],
          ["EXPERT_ALLOW", "worker-demo"],
        ],
      );
      console.log(
        "packed domain experts: inherited the caller's model, withheld the task before approval, and sent it only for the approved launch",
      );
    }
    for (const scenario of ["CANCEL", "TIMEOUT", "CURRENT"]) {
      await remote("chatPrompt", {
        token: user.token,
        request: {
          sessionId,
          requestId: randomUUID(),
          mode: "queue",
          content: [{ type: "text", text: `MODE_${scenario}_DEMO` }],
        },
      });
      if (scenario !== "CURRENT") {
        await waitFor(
          () => waitingReviews.has(scenario),
          `review start ${scenario}`,
        );
        if (scenario === "CANCEL")
          await remote("chatCancel", { token: user.token, sessionId });
        await waitFor(
          () => closedReviews.has(scenario),
          `review provider closed ${scenario}`,
        );
      }
      await waitFor(
        async () =>
          (await remote("chatList", { token: user.token })).items.find(
            (item) => item.sessionId === sessionId,
          )?.running === false &&
          (scenario !== "CURRENT" || reviews.has(scenario)),
        `idle after ${scenario}`,
      );
      assert.equal(failures.length, 0, failures[0]?.stack);
      const history = await remote("chatPage", {
        token: user.token,
        request: { address: { kind: "session", sessionId }, maxMessages: 100 },
      });
      const hash = createHash("sha256")
        .update(lifecycleCandidate(scenario))
        .digest("hex");
      const statuses = history.records
        .filter(
          ({ event }) =>
            event.type === "user/message" &&
            event.data.source?.kind === "answer-review-status",
        )
        .map(({ event }) => event.data.source.receipt)
        .filter((receipt) => receipt.candidateHash === hash)
        .map((receipt) => receipt.status);
      const expected = {
        CANCEL: "cancelled",
        TIMEOUT: "failure",
        CURRENT: "pass",
      }[scenario];
      assert.ok(
        statuses.includes("reviewing"),
        `Missing waiting receipt for ${scenario}: ${statuses}`,
      );
      assert.equal(statuses.at(-1), expected, `Final receipt for ${scenario}`);
      if (scenario !== "CURRENT") assert.ok(!statuses.includes("pass"));
    }
    console.log(
      `packed review lifecycle: ${expertReview ? "domain-expert" : "subagent"} cancelled, timed out, and passed the next candidate`,
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
