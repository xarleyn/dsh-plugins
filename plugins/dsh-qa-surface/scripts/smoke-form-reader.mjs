import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { normalize } from "node:path";
import { URLSearchParams } from "node:url";
import { rpc, waitFor } from "./smoke-helpers.mjs";

// Only the file bodies contain the random lines. Names and prompts are identical
// across the two independent conversations.
const marker = () => randomBytes(8).toString("hex");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const modelTimeout = 300_000;
const schema = {
  schema_version: 1,
  title: "Document intake",
  steps: [
    {
      id: "input",
      title: "Files",
      items: ["required", "optional"].map((requirement) => ({
        id: requirement,
        title: requirement,
        files: {
          requirement,
          ...(requirement === "required" ? { min_count: 1 } : {}),
          max_count: 1,
          accept: [".txt"],
          max_file_size_bytes: 1024,
        },
      })),
    },
  ],
};

export function formReaderPatch(baseUrl, model, workspaceId) {
  assert.ok(baseUrl, "set DSH_QA_READER_URL to the local model base URL");
  const endpoint = new URL(baseUrl);
  assert.ok(
    ["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname) &&
      endpoint.protocol === "http:" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash,
    "use a local test model endpoint",
  );
  assert.ok(model?.trim(), "set DSH_QA_READER_MODEL to the served model ID");
  return `- id: dsh-qa-surface
  config:
    enabled: true
    accounts: { enabled: true, allowRegistration: true, perUserWorkspace: true }
    session: { workspaceId: ${JSON.stringify(workspaceId)}, agentPreset: standard, provider: qa-reader-local, model: ${JSON.stringify(model)} }
    tools: { dynamicActivation: false, activationPresets: [standard] }
    forms: { enabled: true }
    lockdown:
      enabled: true
      sandboxMode: workspace-write
      approvalPolicy: never
      permissionPreset: qa-reader-workspace
      toolPolicy: { mode: allow-list, allow: [read, request_user_form] }
- id: permission
  config:
    defaultPreset: qa-reader-workspace
    presets:
      qa-reader-workspace: { sandbox: workspace-write, approval: never }
- id: llm-pi-ai
  config:
    providers:
      qa-reader-local:
        displayName: Local QA reader
        api: openai-completions
        apiKeyEnv: DSH_QA_READER_KEY
        baseURL: ${JSON.stringify(endpoint.href)}
        models: [{ id: ${JSON.stringify(model)}, name: Local reader }]
`;
}

function unwrap(result) {
  assert.equal(result.ok, true, result.error?.message);
  return result.value;
}

function messageText(message) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function resultFor(events, call) {
  const result = events.find(
    (e) =>
      e.type === "tool/result" &&
      e.data.message.toolCallId === call.data.callId,
  );
  assert.ok(
    result && !result.data.error,
    `missing or failed ${call.data.name} result`,
  );
  const message = result.data.message;
  assert.equal(message.isError, false, `unsuccessful ${call.data.name} result`);
  return messageText(message);
}

export async function runFormReaderPass({ origin, cookie, model }) {
  const remote = (name, args) =>
    rpc(origin, `qaSurface/${name}`, { args }, cookie);
  const account = (name) =>
    remote("accountsRegister", {
      email: `${name}@example.test`,
      password: randomUUID(),
    });
  const admin = await account("reader-admin");
  const user = await account("reader-user");
  const snapshot = await remote("accessAdminSnapshot", { token: admin.token });
  const role = snapshot.config.subroles.find((r) => r.id === "general");
  assert.ok(role);
  await remote("accessUpdateSubrole", {
    token: admin.token,
    id: role.id,
    input: {
      ...role,
      capabilities: {
        ...role.capabilities,
        tools: {
          ...role.capabilities.tools,
          always: ["request_user_form", "read"],
        },
      },
    },
  });
  const original = marker(),
    optional = marker(),
    replacement = marker();
  for (const replace of [false, true]) {
    const sessionId = await remote("createSession", {
      token: user.token,
      subroleId: null,
      adminPreview: false,
    });
    const auth = { token: user.token, sessionId };
    const list = async () => unwrap(await remote("listForms", auth));
    const history = async () =>
      (
        await remote("chatPage", {
          token: user.token,
          request: {
            address: { kind: "session", sessionId },
            maxMessages: 100,
          },
        })
      ).records
        .filter((r) => r.type === "event")
        .map((r) => r.event);
    await list();
    const prompt = `Call request_user_form with action=create, request_key=intake and this form: ${JSON.stringify(schema)}. After submission, call read using each exact resources[].read_path. Reply with the text from each submitted file and its item ID. For an empty optional item say absent.`;
    await remote("chatPrompt", {
      token: user.token,
      request: {
        sessionId,
        requestId: randomUUID(),
        mode: "queue",
        content: [{ type: "text", text: prompt }],
      },
    });
    const opening = await waitFor(
      async () => {
        const form = (await list()).find((f) => f.waiting);
        if (form) return { form };
        const events = await history();
        if (events.some((e) => e.type === "turn/end")) return { events };
      },
      "model's waiting form",
      modelTimeout,
    );
    assert.ok(
      opening.form,
      `model finished before opening a form in ${sessionId}`,
    );
    let form = opening.form;
    const mutate = async (command) => {
      form = unwrap(
        await remote("mutateForm", {
          ...auth,
          command: {
            ...command,
            form_id: form.id,
            expected_revision: form.revision,
            mutation_id: randomUUID(),
          },
        }),
      );
    };
    const upload = async (item, text, target) => {
      const bytes = Buffer.from(text);
      await mutate({
        action: "begin_upload",
        item_id: item,
        name: `${item}.txt`,
        size_bytes: bytes.length,
        ...(target && { target }),
      });
      const intent = form.uploads.findLast(
        (u) => u.state === "pending" && u.item_id === item,
      );
      assert.ok(intent);
      const query = new URLSearchParams({ sessionId, formUploadId: intent.id });
      const response = await fetch(`${origin}/api/qa-chat-upload?${query}`, {
        method: "POST",
        headers: {
          cookie,
          authorization: `Bearer ${user.token}`,
          "content-type": "application/octet-stream",
        },
        body: bytes,
      });
      form = unwrap(await response.json());
      assert.ok(response.ok);
      const file = form.attachments[item][0];
      assert.equal(file.sha256, digest(bytes));
      assert.equal(file.size_bytes, bytes.length);
      return file;
    };
    const first = await upload("required", original);
    const extra = await upload("optional", optional);
    assert.equal(first.version, 1);
    let required = first;
    if (replace) {
      required = await upload("required", replacement, {
        attachment_id: first.attachment_id,
        version: first.version,
      });
      assert.equal(required.attachment_id, first.attachment_id);
      assert.equal(required.version, 2);
      assert.notEqual(required.resource_id, first.resource_id);
      await mutate({
        action: "remove",
        item_id: "optional",
        attachment_id: extra.attachment_id,
        version: extra.version,
      });
    }
    await mutate({ action: "submit" });
    const events = await waitFor(
      async () => {
        const entries = await history();
        return entries.some((e) => e?.type === "turn/end")
          ? entries
          : undefined;
      },
      "completed model turn",
      modelTimeout,
    );
    const expected = replace
      ? [[required, replacement]]
      : [
          [first, original],
          [extra, optional],
        ];
    const answer = verifyReads({ events, form, expected, model, sessionId });
    if (replace) {
      assert.ok(!answer.includes(original) && !answer.includes(optional));
      assert.match(answer, /absent/i);
    }
  }
}

function verifyReads({ events, form, expected, model, sessionId }) {
  const calls = events.filter((e) => e.type === "tool/call");
  const formCall = calls.find(
    (c) =>
      c.data.name === "request_user_form" &&
      JSON.parse(c.data.arguments).action === "create",
  );
  assert.ok(formCall);
  const submitted = JSON.parse(resultFor(events, formCall));
  assert.equal(submitted.submission_id, form.submission.submission_id);
  assert.deepEqual(submitted.items, form.submission.items);
  assert.deepEqual(
    submitted.resources.map((r) => r.resource_id).sort(),
    expected.map(([f]) => f.resource_id).sort(),
  );
  assert.deepEqual(
    submitted.empty_optional_item_ids,
    expected.length === 1 ? ["optional"] : [],
  );
  const reads = calls.filter((c) => c.data.name === "read");
  const paths = reads.map((c) =>
    normalize(JSON.parse(c.data.arguments).file_path),
  );
  assert.deepEqual(
    [...new Set(paths)].sort(),
    submitted.resources.map((r) => normalize(r.read_path)).sort(),
  );
  const answer = events.findLast((e) => e.type === "assistant/message").data
    .message;
  assert.equal(answer.source.model, model);
  assert.equal(answer.source.provider, "qa-reader-local");
  const text = messageText(answer);
  for (const [file, content] of expected) {
    const path = submitted.resources.find(
      (r) => r.resource_id === file.resource_id,
    ).read_path;
    const call = reads[paths.indexOf(normalize(path))];
    assert.ok(resultFor(events, call).includes(content));
    assert.ok(
      text.includes(content),
      "model response must quote the file body",
    );
    console.log(
      JSON.stringify({
        model,
        tool: "read",
        sessionId,
        submission: submitted.submission_id,
        file: file.name,
        version: file.version,
        resource: file.resource_id,
        bytes: file.size_bytes,
        sha256: file.sha256,
        call: call.data.callId,
        answer: text,
      }),
    );
  }
  return text;
}
