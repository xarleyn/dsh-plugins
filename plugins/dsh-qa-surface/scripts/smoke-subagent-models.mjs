import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freePort, rpc, stopProcess, waitFor } from "./smoke-helpers.mjs";

/** Real packed Host, account policy, tool execution and native spawn; only the LLM is scripted. */
export async function runSubagentModelsPass(options) {
  const {
    dshBin,
    dshEnv,
    root,
    workspacePath,
    launchToken,
    authenticateBrowser,
    hostLog,
  } = options;
  const requests = [];
  const failures = [];
  let phase = 0;
  let childCompleted = false;
  let discovered;
  let blocked;
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(body.model);
      let text;
      let tool;
      if (body.model === "worker-demo") {
        childCompleted = true;
        text = "QA child completed on worker-demo.";
      } else if (body.model === "parent-demo") {
        if (
          !body.tools?.some((entry) => entry.function.name === "qa_subagent")
        ) {
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end(
            `data: ${JSON.stringify({ id: "demo-title", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "Demo task" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          );
          return;
        }
        const toolResults = body.messages.filter(
          (message) => message.role === "tool",
        );
        if (phase === 0) {
          const names = body.tools.map((entry) => entry.function.name);
          assert.ok(names.includes("qa_list_subagent_models"));
          assert.ok(names.includes("qa_subagent"));
          tool = { name: "qa_list_subagent_models", arguments: {} };
        } else if (phase === 1) {
          discovered = JSON.parse(toolResults.at(-1).content);
          assert.deepEqual(
            discovered.models.map((entry) => entry.model).sort(),
            ["parent-demo", "worker-demo"],
          );
          tool = {
            name: "qa_subagent",
            arguments: {
              description: "Denied demo",
              prompt: "Do not run.",
              provider: "qa-subagent-demo",
              model: "blocked-demo",
            },
          };
        } else if (phase === 2) {
          blocked = toolResults.at(-1).content;
          assert.match(blocked, /not allowed/u);
          tool = {
            name: "qa_subagent",
            arguments: {
              description: "Selected model demo",
              prompt: "Return one short completion sentence.",
              provider: "qa-subagent-demo",
              model: "worker-demo",
            },
          };
        } else {
          if (phase === 3)
            assert.match(toolResults.at(-1).content, /"kind":"activation"/u);
          text = childCompleted
            ? "QA parent received the selected-model child."
            : "Waiting for the delegated child.";
        }
        phase += 1;
      } else {
        throw new Error(`Unexpected synthetic model: ${body.model}`);
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const delta =
        tool === undefined
          ? { role: "assistant", content: text }
          : {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call-${phase}`,
                  type: "function",
                  function: {
                    name: tool.name,
                    arguments: JSON.stringify(tool.arguments),
                  },
                },
              ],
            };
      const chunk = (value) =>
        response.write(
          `data: ${JSON.stringify({ id: `response-${requests.length}`, object: "chat.completion.chunk", created: 1, model: body.model, ...value })}\n\n`,
        );
      chunk({ choices: [{ index: 0, delta, finish_reason: null }] });
      chunk({
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: tool === undefined ? "stop" : "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
      response.end("data: [DONE]\n\n");
    } catch (error) {
      failures.push(error);
      response.writeHead(500);
      response.end("Synthetic LLM assertion failed.");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const llmPort = server.address().port;
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const patch = join(root, "subagent-models.patch.yml");
  await writeFile(
    patch,
    `- id: dsh-qa-surface
  config:
    accounts:
      enabled: true
      allowRegistration: true
    integration:
      enabled: true
      requestTimeoutMs: 30000
    session:
      agentPreset: minimal
      provider: qa-subagent-demo
      model: parent-demo
    tools:
      dynamicActivation: false
      activationPresets: []
- id: tools
  config:
    mode: native
- id: llm-pi-ai
  config:
    providers:
      qa-subagent-demo:
        displayName: QA subagent demo
        api: openai-completions
        apiKeyEnv: QA_SUBAGENT_SMOKE_KEY
        baseURL: http://127.0.0.1:${llmPort}/v1
        models:
          - id: parent-demo
            name: Parent demo
          - id: worker-demo
            name: Worker demo
          - id: blocked-demo
            name: Blocked demo
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
        env: { ...dshEnv, QA_SUBAGENT_SMOKE_KEY: "synthetic-smoke-key" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    host.stdout.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
    host.stderr.setEncoding("utf8").on("data", (chunk) => log.push(chunk));
    const launch = await waitFor(
      () => launchToken(log),
      "subagent model smoke host",
    );
    const cookie = await authenticateBrowser(port, `127.0.0.1:${port}`, launch);
    const remote = (name, args) =>
      rpc(origin, `qaSurface/${name}`, { args }, cookie);
    const admin = await remote("accountsRegister", {
      email: "model-admin@example.test",
      password: "demo-password-admin",
    });
    const user = await remote("accountsRegister", {
      email: "model-user@example.test",
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
        allowedModels: [{ provider: "qa-subagent-demo", model: "worker-demo" }],
        capabilities: {
          ...general.capabilities,
          tools: {
            ...general.capabilities.tools,
            always: ["qa_list_subagent_models", "qa_subagent"],
          },
        },
      },
    });
    const service = await remote("accountsCreateServiceToken", {
      token: user.token,
      input: { label: "Subagent smoke", scopes: ["ask"] },
    });
    const result = await fetch(`${origin}/qa/api/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${service.token}`,
      },
      body: JSON.stringify({
        message: "Run the synthetic selected-model subagent check.",
      }),
      signal: globalThis.AbortSignal.timeout(45000),
    });
    const body = await result.text();
    assert.equal(failures.length, 0, failures[0]?.message);
    assert.equal(result.status, 200, body);
    await waitFor(
      () => {
        assert.equal(failures.length, 0, failures[0]?.message);
        return childCompleted;
      },
      `native child model request (phase ${phase}; requests ${requests.join(",")}; API ${body})`,
    );
    assert.ok(discovered);
    assert.match(blocked, /not allowed/u);
    assert.ok(requests.includes("worker-demo"));
    assert.ok(!requests.includes("blocked-demo"));
    const owned = await remote("accountsOwnedSessions", { token: user.token });
    assert.equal(owned.ids.length, 1);
    const choices = await remote("accessUserModels", {
      token: user.token,
      sessionId: owned.ids[0],
      subroleId: null,
      adminPreview: false,
    });
    assert.equal(choices.selected.model, "parent-demo");
    console.log(
      "packed QA subagent models: regular-account grants, filtered discovery, rejected model, native child on selected route and unchanged parent selection passed",
    );
  } catch (error) {
    hostLog.push(...log);
    throw error;
  } finally {
    await stopProcess(host);
    await new Promise((resolve) => server.close(resolve));
  }
}
