import { describe, expect, it } from "vitest";

import type { ContentBlock } from "@deepseek-ai/dsh-llm";

import { AnswerReviewGate, type GateAgent } from "../src/gate.js";
import type { ReviewAudit } from "../src/audit.js";
import { resolveAnswerReviewGateConfig } from "../src/config.js";
import { attachmentHandleTexts } from "../src/candidate.js";
import {
  renderExpertReviewTask,
  renderSubagentReviewerTask,
} from "../src/prompt.js";
import type {
  ReviewVerdict,
  SubagentRunHandle,
  SubagentRunResult,
  SubagentsFace,
  SubagentStartSpec,
} from "../src/types.js";

/**
 * The uploaded-file regression (`max-rounds` deaths on the production stand).
 *
 * The reviewer never received the attachments the user uploaded, so it read
 * facts sourced from a file as fabrication and refused forever. Option 1 makes
 * the reviewer *aware* an attachment existed — rendered with the host's own
 * `fileHandleText` / `textOnlyImageText` idiom — without pretending it can be
 * opened, and adds the protocol line that an unreadable attachment is not
 * evidence of fabrication.
 */

const FILE_NAME = "PROJ-123-report.pdf";

function fileBlock(): ContentBlock {
  return {
    type: "file",
    attachment: {
      attachmentId: "sha256:0123456789ab" as never,
      name: FILE_NAME,
      bytes: 4096,
    },
  };
}

function imageBlock(): ContentBlock {
  return {
    type: "image",
    attachment: {
      attachmentId: "sha256:cafebabe1234" as never,
      mediaType: "image/png" as never,
      bytes: 2048,
      width: 64,
      height: 64,
    },
  };
}

const PASS: ReviewVerdict = {
  verdict: "pass",
  summary: "All claims check out.",
  issues: [],
  confidence: "high",
};

/** Scripted subagent face: records the reviewer prompt the gate started. */
class ScriptedFace implements SubagentsFace {
  readonly started: SubagentStartSpec[] = [];
  readonly queue: ((result: SubagentRunResult | Error) => void)[] = [];

  start(
    _provider: string,
    request: SubagentStartSpec,
  ): Promise<SubagentRunHandle> {
    this.started.push(request);
    return new Promise((resolve) => {
      this.queue.push((outcome) => {
        resolve({
          result:
            outcome instanceof Error
              ? Promise.reject(outcome)
              : Promise.resolve(outcome),
          dispose: () => {},
        });
      });
    });
  }

  settle(outcome: SubagentRunResult): Promise<void> {
    const next = this.queue.shift();
    if (next === undefined) return Promise.resolve();
    next(outcome);
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  resultOf(verdict: ReviewVerdict): SubagentRunResult {
    return { stopReason: "completed", output: [], structured: verdict };
  }
}

function makeGate(face: ScriptedFace): AnswerReviewGate {
  const audit: ReviewAudit = {
    resize: () => {},
    record: () => {},
    list: () => [],
  } as unknown as ReviewAudit;
  return new AnswerReviewGate({
    config: () =>
      resolveAnswerReviewGateConfig({
        reviewer: { backend: "subagent" },
        minCandidateChars: 10,
      }),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    audit,
    now: (() => {
      let tick = 0;
      return () => (tick += 10);
    })(),
    domainExperts: () => undefined,
    subagents: () => face,
    steerMessage: () => {},
  });
}

/** A surface whose latest user message is text plus one file block. */
function surfaceWithAttachment(
  content: readonly ContentBlock[],
): GateAgent["session"] {
  const events = [
    {
      type: "user/message",
      data: {
        id: "request-0",
        source: { kind: "user" },
        content,
      },
    },
    {
      type: "assistant/message",
      data: {
        message: {
          content: [
            {
              type: "text",
              text: "The report concludes the operating budget rose by 12 percent.",
            },
          ],
        },
      },
    },
  ];
  return {
    header: { origin: "user" },
    surface: { nodes: [0, 1] },
    eventAt: (seq: number) => events[seq],
    snapshotEvents: () => events,
  } as unknown as GateAgent["session"];
}

function promptTextOf(spec: SubagentStartSpec): string {
  return spec.prompt
    .filter((block): block is Extract<ContentBlock, { type: "text" }> =>
      block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

async function reviewerPrompt(
  content: readonly ContentBlock[],
): Promise<string> {
  const face = new ScriptedFace();
  const gate = makeGate(face);
  const agent = {
    id: "session-1",
    session: surfaceWithAttachment(content),
    steer: () => {},
  } as GateAgent;
  const pending = gate.handleTurnStopping(
    agent,
    1,
    new AbortController().signal,
  );
  await face.settle(face.resultOf(PASS));
  expect(await pending).toBe("pass");
  expect(face.started).toHaveLength(1);
  return promptTextOf(face.started[0]!);
}

describe("reviewer sees uploaded attachments", () => {
  it("names the uploaded file in the reviewer prompt the gate started", async () => {
    const prompt = await reviewerPrompt([
      { type: "text", text: "Summarize the quarterly report." },
      fileBlock(),
    ]);
    // The whole point: the reviewer is told a file by this name existed.
    expect(prompt).toContain(FILE_NAME);
    // It is shown inside the user-request section, not invented elsewhere.
    const requestSection = prompt.slice(
      prompt.indexOf("<user_request>"),
      prompt.indexOf("</user_request>"),
    );
    expect(requestSection).toContain(FILE_NAME);
    // ...and it is presented as an attachment the reviewer cannot open.
    expect(requestSection).toContain("cannot access a readable path");
  });

  it("keeps the text request intact while adding the attachment", async () => {
    const prompt = await reviewerPrompt([
      { type: "text", text: "Summarize the quarterly report." },
      fileBlock(),
    ]);
    expect(prompt).toContain("Summarize the quarterly report.");
  });

  it("tells the reviewer an unreadable attachment is not fabrication (subagent + expert)", async () => {
    const lines = attachmentHandleTexts([fileBlock()]);
    const subagent = renderSubagentReviewerTask({
      requestText: "Summarize the quarterly report.",
      candidateText: "The budget rose by 12 percent.",
      requestAttachments: lines,
    });
    const expert = renderExpertReviewTask({
      requestText: "Summarize the quarterly report.",
      candidateText: "The budget rose by 12 percent.",
      requestAttachments: lines,
    });
    for (const prompt of [subagent, expert]) {
      expect(prompt).toContain(FILE_NAME);
      // The added protocol line, in both shipped prompt renderers.
      expect(prompt).toContain("cannot open");
      expect(prompt).toContain("could not verify");
    }
  });

  it("renders a file as the host fileHandleText idiom and an image by kind", () => {
    const fileLines = attachmentHandleTexts([fileBlock()]);
    expect(fileLines).toHaveLength(1);
    const fileLine = fileLines[0]!;
    expect(fileLine).toContain(FILE_NAME);
    expect(fileLine).toContain("4096 bytes");
    expect(fileLine).toContain("cannot access a readable path");

    const imageLines = attachmentHandleTexts([imageBlock()]);
    expect(imageLines).toHaveLength(1);
    expect(imageLines[0]!.toLowerCase()).toContain("image");

    // Text blocks contribute no attachment line.
    expect(attachmentHandleTexts([{ type: "text", text: "hi" }])).toEqual([]);
  });

  it("leaves the request unchanged when the user attached nothing", async () => {
    const prompt = await reviewerPrompt([
      { type: "text", text: "Summarize the quarterly report." },
    ]);
    expect(prompt).toContain("Summarize the quarterly report.");
    expect(prompt).not.toContain(FILE_NAME);
  });
});
