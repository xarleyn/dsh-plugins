/**
 * The window #248 reports: the turn ends, the Host rebuilds the evidence it
 * answers from, and the reader clicks a source the answer just cited. The rail
 * and the Host must name that file the same way, or the detailed view refuses
 * a source the reader can see.
 *
 * Both channels read the same durable tool results, so this pins the seam
 * rather than either end of it: the path the projection puts in the rail is
 * the path the preview is asked for, and the Host's own evidence decides.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  projectTurnSources,
  sourceAnchorRoot,
} from "../../src/client/turn-sources.js";
import {
  QaSourcePreviewError,
  readSourceFilePreview,
} from "../../src/provenance/file-preview.js";
import { QaProvenanceHost } from "../../src/provenance/host-store.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";
import {
  fakeSession,
  harness,
  readEvents,
} from "../provenance-host.helpers.js";

const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function scratch(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

/** The transcript the durable read of one file leaves behind. */
function readNodes(path: string): ConversationNode[] {
  const argsRaw = JSON.stringify({ file_path: path });
  return [
    {
      kind: "assistant",
      turn: 1,
      step: 1,
      seq: 0,
      time: 0,
      blocks: [{ kind: "tool-call", callId: "call-1", name: "read", argsRaw }],
    },
    {
      kind: "tool-result",
      seq: 1,
      time: 1,
      callId: "call-1",
      call: { name: "read", argsRaw },
      callTime: null,
      content: [{ type: "text", text: "# Guide" }],
      isError: false,
      meta: { card: "read", path, lines: [{ number: 1, text: "# Guide" }] },
      subCalls: [],
    },
  ] as unknown as ConversationNode[];
}

/** The Host of one chat, seeded from the journal of the turn it just ran. */
function hostFor(sessionId: string, cwd: string, path: string) {
  const session = fakeSession(sessionId, readEvents(path), undefined, cwd);
  const world = harness([session.session]);
  return {
    world,
    session: session.session,
    host: new QaProvenanceHost(world.ctx, () => resolveConfig()),
  };
}

async function previewOf(
  sourcePath: string,
  cwd: string,
  isEvidence: (canonicalPath: string) => boolean,
): Promise<string> {
  const preview = await readSourceFilePreview({
    sourcePath,
    cwd,
    isEvidence,
    maxBytes: 10_000,
    maxMarkdownRenderBytes: 10_000,
  });
  return preview.content;
}

async function refusalOf(
  sourcePath: string,
  cwd: string,
  isEvidence: (canonicalPath: string) => boolean,
): Promise<string | null> {
  try {
    await previewOf(sourcePath, cwd, isEvidence);
    return null;
  } catch (error) {
    if (!(error instanceof QaSourcePreviewError)) throw error;
    return error.reason;
  }
}

describe("a source clicked in the turn that just ended", () => {
  it("opens when the chat works below the deployment's configured pin", async () => {
    const workspace = await scratch("qa-source-window-");
    const chatCwd = join(workspace, ".qa-users", "account-1");
    const guide = join(chatCwd, "docs", "guide.md");
    await mkdir(join(chatCwd, "docs"), { recursive: true });
    await writeFile(guide, "# Guide", "utf8");

    const { host, world, session } = hostFor("chat-1", chatCwd, guide);
    // The turn ends: `agent/turn-stopping` retires the collector and the
    // plugin-owned snapshot answers for that turn from then on.
    world.emit("agent/turn-stopping", {
      agent: { id: "chat-1", session },
      turn: 1,
    });

    // What the rail shows after that flush: the projection, anchored on the
    // chat's own cwd — the directory the Host recorded the source against.
    const [bundle] = projectTurnSources(
      snapshot(legacy({ nodes: readNodes(guide) })),
      "chat-1",
      sourceAnchorRoot(chatCwd, workspace),
    );
    const shown = bundle?.sources[0];

    expect(shown?.path).toBe("docs/guide.md");
    expect(
      await previewOf(shown?.path ?? "", chatCwd, (canonicalPath) =>
        host.sourceAllowed("chat-1", canonicalPath),
      ),
    ).toBe("# Guide");
    host.dispose();
  });

  it("refuses the configured pin's spelling of that same file", async () => {
    const workspace = await scratch("qa-source-pin-");
    const chatCwd = join(workspace, ".qa-users", "account-1");
    const guide = join(chatCwd, "docs", "guide.md");
    await mkdir(join(chatCwd, "docs"), { recursive: true });
    await writeFile(guide, "# Guide", "utf8");

    const { host, world, session } = hostFor("chat-1", chatCwd, guide);
    world.emit("agent/turn-stopping", {
      agent: { id: "chat-1", session },
      turn: 1,
    });

    // The pin is what the deployment is configured with; the chat's cwd is
    // where it actually works. Anchoring the projection on the pin names the
    // same file in a frame the Host's evidence cannot re-anchor, and the
    // detailed view then refuses a source the reader is looking at.
    const [pinned] = projectTurnSources(
      snapshot(legacy({ nodes: readNodes(guide) })),
      "chat-1",
      sourceAnchorRoot(undefined, workspace),
    );

    expect(pinned?.sources[0]?.path).toBe(".qa-users/account-1/docs/guide.md");
    expect(
      await refusalOf(
        pinned?.sources[0]?.path ?? "",
        chatCwd,
        (canonicalPath) => host.sourceAllowed("chat-1", canonicalPath),
      ),
    ).toBe("not-evidence");
    host.dispose();
  });

  it("still refuses a source this chat's own record does not carry", async () => {
    const workspace = await scratch("qa-source-foreign-");
    const chatCwd = join(workspace, "work");
    const guide = join(chatCwd, "docs", "guide.md");
    await mkdir(join(chatCwd, "docs"), { recursive: true });
    await writeFile(guide, "# Guide", "utf8");

    const { host, world, session } = hostFor("chat-1", chatCwd, guide);
    world.emit("agent/turn-stopping", {
      agent: { id: "chat-1", session },
      turn: 1,
    });

    // The file exists and belongs to the same deployment, but another chat is
    // what read it: the preview is bound to the asked chat's evidence, and
    // that refusal is the honest one.
    expect(
      await refusalOf("docs/guide.md", chatCwd, (canonicalPath) =>
        host.sourceAllowed("chat-2", canonicalPath),
      ),
    ).toBe("not-evidence");
    host.dispose();
  });
});
