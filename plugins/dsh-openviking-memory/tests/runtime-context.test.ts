/**
 * The runtime's write path, driven through the plugin's own listeners.
 *
 * Capture, commit, flush and dispose decide *what* to send and *when*; the only
 * place that decision is observable is the recorded transport, plus the pending
 * queue the offline path leaves on disk. Every assertion below is therefore
 * about a request, a queue file, or a plugin log record — never about private
 * runtime state, except for the documented `liveSessions` counter.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { afterEach, describe, expect, it } from "vitest";

import type { Config } from "../src/index.js";
import {
  createFakeAgent,
  createFakeSession,
  createHarness,
  emit,
  enterDecision,
  preStepPayload,
  userMessage,
  type Harness,
} from "./helpers/harness.js";
import {
  captureEvent,
  ok,
  ovId,
  ovPath,
  transport,
} from "./runtime.helpers.js";

let harness: Harness | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  for (const dir of tempDirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

describe("workspace peer", () => {
  it("sends the legacy cwd peer for peerSource: cwd and no peer for peerSource: none", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ov-peer-"));
    tempDirs.push(cwd);

    /** Capture one turn and report the headers that reached the wire. */
    const headersForSession = async (
      sessionId: string,
      config: Config,
    ): Promise<Record<string, string>> => {
      const messages = ovPath(ovId(sessionId), "/messages");
      const seen: Record<string, string>[] = [];
      const local = await createHarness(config, {
        fetchImpl: transport({
          [messages]: (init) => {
            seen.push((init?.headers ?? {}) as Record<string, string>);
            return ok({});
          },
        }),
      });

      const session = createFakeSession(sessionId, { cwd });
      await emit(
        local,
        "session/event",
        session,
        captureEvent("A workspace-scoped fact."),
      );
      await emit(local, "session/flush", session);

      expect(local.requestsFor(messages)).toHaveLength(1);
      await local.dispose();
      return seen[0]!;
    };

    const byCwd = await headersForSession("dsh-peer-cwd", {
      peerSource: "cwd",
      workspacePeer: true,
    });
    // The legacy rule: one byte in, one byte out, no collapsing and no trimming.
    expect(byCwd["X-OpenViking-Actor-Peer"]).toBe(
      cwd.replace(/[^A-Za-z0-9]/g, "-"),
    );

    const disabled = await headersForSession("dsh-peer-none", {
      peerSource: "none",
      workspacePeer: true,
    });
    expect("X-OpenViking-Actor-Peer" in disabled).toBe(false);
  });
});

/**
 * A context face that answers with the query it was asked, so two different
 * questions produce two different blocks and one repeated question produces the
 * same block again.
 */
function echoingContextFace() {
  return transport({
    "/api/v1/search/search": (init) => {
      const body = JSON.parse(String(init?.body)) as { query?: unknown };
      return ok({
        rendered: `- decided earlier: ${String(body.query ?? "")}`,
        entries: [],
        digest: "",
        stats: {},
      });
    },
  });
}

/** Run one `pre-step` and report the messages the plugin appended. */
async function recallStep(
  target: Harness,
  agent: Agent,
  messages: readonly UserMessage[],
): Promise<UserMessage[]> {
  const decision = (await emit(
    target,
    "agent/pre-step",
    preStepPayload(agent, messages),
    async () => enterDecision(messages),
  )) as { kind: string; messages: UserMessage[] };
  return decision.messages.filter((message) => !messages.includes(message));
}

/** The text one injected message carries. */
function messageText(message: UserMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

describe("recall injection", () => {
  it("frames the block as background memory above the block's own header", async () => {
    harness = await createHarness({}, { fetchImpl: echoingContextFace() });
    const fake = createFakeAgent({ sessionId: "recall-framed" });

    const appended = await recallStep(harness, fake.agent, [
      userMessage("what did we decide about the recall budget last time?"),
    ]);

    expect(appended).toHaveLength(1);
    const recall = appended[0]!;
    expect(recall.source).toMatchObject({
      kind: "plugin",
      plugin: "openviking-memory",
      form: "recall",
    });
    const text = messageText(recall);
    expect(text).toContain("Background memory from earlier sessions");
    expect(text).toContain("not the source of record");
    // The framing is the first thing under the envelope, ahead of the assembled
    // body: a model that stops after one line still reads it.
    expect(text).toContain(
      "decided earlier: what did we decide about the recall budget last time?",
    );
    expect(text.indexOf("Background memory")).toBeLessThan(
      text.indexOf("Relevant memory from OpenViking"),
    );
  });

  it("delivers an identical block once per session and a new one after it changes", async () => {
    harness = await createHarness({}, { fetchImpl: echoingContextFace() });
    const fake = createFakeAgent({ sessionId: "recall-repeat" });
    const question = [
      userMessage("what did we decide about the recall budget last time?"),
    ];

    expect(await recallStep(harness, fake.agent, question)).toHaveLength(1);
    // Same question, same assembled block: the conversation still carries the
    // first copy, so the second step must add nothing.
    expect(await recallStep(harness, fake.agent, question)).toEqual([]);
    // A different question is a different block and is delivered.
    expect(
      await recallStep(harness, fake.agent, [
        userMessage("where does the pending-queue drainer live?"),
      ]),
    ).toHaveLength(1);
  });
});

describe("startup profile injection", () => {
  const PROFILE = "## Profile\n- prefers terse answers and no emojis";

  function priorStartupProfile(): unknown {
    return createUserMessage({
      content: [{ type: "text", text: "stored profile" }],
      source: {
        kind: "plugin",
        plugin: "openviking-memory",
        form: "instructions",
      },
    });
  }

  it("claims the profile once while idle and leaves it to pre-step after a turn starts", async () => {
    harness = await createHarness(
      {},
      {
        fetchImpl: transport({ "/api/v1/content/read": () => ok(PROFILE) }),
      },
    );

    const idle = createFakeAgent({
      sessionId: "profile-idle",
      cwd: "/workspace/project",
      ownEvents: [],
    });
    await emit(harness, "agent/session-start", {
      agent: idle.agent,
      source: "startup",
    });
    expect(idle.injected).toHaveLength(1);
    expect(idle.injected[0]!.source).toMatchObject({
      kind: "plugin",
      plugin: "openviking-memory",
      form: "instructions",
    });

    // The claim is one-shot: the next step adds the profile a second time only
    // if delivery had not already happened.
    const messages = [
      userMessage("what did we decide about the recall budget last time?"),
    ];
    const decision = await emit(
      harness,
      "agent/pre-step",
      preStepPayload(idle.agent, messages),
      async () => enterDecision(messages),
    );
    expect(decision).toEqual(enterDecision(messages));

    const running = createFakeAgent({
      sessionId: "profile-running",
      cwd: "/workspace/project",
      status: "running",
      ownEvents: [],
    });
    await emit(harness, "agent/session-start", {
      agent: running.agent,
      source: "startup",
    });
    expect(running.injected).toEqual([]);

    const resumed = createFakeAgent({
      sessionId: "profile-resumed",
      cwd: "/workspace/project",
      ownEvents: [{ type: "user/message", data: priorStartupProfile() }],
    });
    await emit(harness, "agent/session-start", {
      agent: resumed.agent,
      source: "startup",
    });
    expect(resumed.injected).toEqual([]);
  });
});
