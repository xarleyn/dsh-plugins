/**
 * The directory the rail's source paths are anchored on. The Host records and
 * previews sources against the chat's own cwd, so a projection anchored on the
 * deployment's configured pin names the same file in a frame the preview
 * cannot match — and refuses a source the answer just cited.
 */

import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";
import { harness } from "../helpers/session-fakes.js";

const CHAT_CWD = "D:/qa-work/.qa-users/account-1";
const GUIDE = `${CHAT_CWD}/docs/guide.md`;
const ARGS = JSON.stringify({ file_path: GUIDE });

const NODES = [
  {
    kind: "assistant",
    seq: 2,
    time: 20,
    turn: 1,
    step: 1,
    blocks: [
      { kind: "text", text: "Ответ со источником" },
      { kind: "tool-call", callId: "call-1", name: "read", argsRaw: ARGS },
    ],
  },
  {
    kind: "tool-result",
    seq: 3,
    time: 30,
    callId: "call-1",
    call: { name: "read", argsRaw: ARGS },
    callTime: null,
    content: [{ type: "text", text: "# Guide" }],
    isError: false,
    meta: {
      card: "read",
      path: GUIDE,
      lines: [{ number: 1, text: "# Guide" }],
    },
    subCalls: [],
  },
] as unknown as ConversationNode[];

describe("QA session controller source anchor", () => {
  it("projects a turn's sources against the chat's own cwd", async () => {
    const world = harness(["chat-1"]);
    const list = world.list.getSnapshot();
    world.list.set({
      ...list,
      byId: {
        ...list.byId,
        "chat-1": {
          id: "chat-1",
          displayTitle: "chat-1",
          running: false,
          blank: false,
          updatedAt: 2,
          cwd: CHAT_CWD,
        },
      } as SessionListState["byId"],
    });
    world.bindings
      .get("chat-1")
      ?.snapshot.set(snapshot(legacy({ nodes: NODES })));
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "chat-1");
    const controller = new QaSessionController({
      ...world,
      // The deployment pins one directory; this chat works in another one.
      config: resolveConfig({ session: { cwd: "D:/qa-work" } }),
    });

    await controller.ensureSession();

    const sources = controller
      .getSnapshot()
      .messages.flatMap((message) =>
        message.role === "assistant" ? (message.sources ?? []) : [],
      );
    expect(sources.map((source) => source.path)).toEqual(["docs/guide.md"]);
    controller.dispose();
  });
});
