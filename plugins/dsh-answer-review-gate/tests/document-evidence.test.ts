import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  AnswerReviewGate,
  ReviewAudit,
  resolveAnswerReviewGateConfig,
} from "../src/index.js";
import type { GateAgent } from "../src/gate.js";
import type { ReviewReceipt } from "../src/receipt.js";
import type { DocumentsReader } from "../src/document-evidence.js";
import type { ExpertRunResult } from "../src/types.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const req = "The pump must stop within thirty seconds";
const report = "The acceptance test records a thirty second cutoff";
const explanation = "Both passages specify the same cutoff for the pump.";
const proof = `CHECK S1 D1 | ${req} | ${report} | ${explanation}`;
async function fixture(summary: string, read = true, reader = "review-child") {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "document-gate-"));
  dirs.push(cwd);
  const src = path.join(cwd, "requirements.txt");
  const output = path.join(cwd, "report.docx");
  await writeFile(src, req);
  await writeFile(output, "fixture binary");
  const digest = hash("fixture binary");
  const manifest = {
    scope: { sessionId: "parent" },
    outputs: [
      {
        format: "docx",
        status: "created",
        path: path.basename(output),
        sha256: digest,
      },
    ],
  };
  await writeFile(path.join(cwd, "manifest.json"), JSON.stringify(manifest));
  const extraction = path.join(cwd, "extract");
  await mkdir(extraction);
  const markdownPath = path.join(extraction, "document.md"),
    manifestPath = path.join(extraction, "manifest.json");
  const documents: DocumentsReader = {
    async toMarkdown({ file }) {
      expect(file).toBe(output);
      await writeFile(markdownPath, report);
      await writeFile(
        manifestPath,
        JSON.stringify({
          scope: manifest.scope,
          input: { sha256: digest },
          outputs: [
            {
              format: "md",
              status: "created",
              path: "document.md",
              sha256: hash(report),
            },
          ],
        }),
      );
      return { markdownPath, manifestPath };
    },
  };
  const user = (text: string) => ({
    source: { kind: "user" },
    content: [{ type: "text", text }],
  });
  const answer = (text: string) => ({
    message: { content: [{ type: "text", text }] },
  });
  const events: { type: string; data: unknown; seq: number }[] = [
    {
      type: "user/message",
      seq: 0,
      data: {
        ...user("deliver"),
        content: [
          {
            type: "file",
            attachment: {
              attachmentId: "sha256:" + hash(req),
              name: "requirements.txt",
              bytes: req.length,
            },
          },
        ],
      },
    },
    {
      type: "tool/call",
      seq: 1,
      data: { callId: "build", name: "document_create" },
    },
    {
      type: "tool/result",
      seq: 2,
      data: {
        message: {
          toolCallId: "build",
          content: [
            {
              type: "text",
              text: `docx: report.docx (12 B, sha256 ${digest.slice(0, 16)}…)`,
            },
          ],
        },
      },
    },
    { type: "assistant/message", seq: 3, data: answer("Done.") },
  ];
  const receipts: ReviewReceipt[] = [];
  const audit = new ReviewAudit(50);
  let calls = 0;
  const gate = new AnswerReviewGate({
    config: () =>
      resolveAnswerReviewGateConfig({
        minCandidateChars: 1,
        maxToolCallsPerRound: 360,
      }),
    domainExperts: () => ({
      async testExpert() {
        throw new Error("unexpected fallback");
      },
      async reviewExpertBounded(_domain, task) {
        calls++;
        if (task.includes("DOCUMENT REVIEW")) {
          expect(task).toContain(JSON.stringify(src));
          expect(task).toContain(JSON.stringify(markdownPath));
          if (read)
            for (const file of [src, markdownPath])
              gate.observeReviewerRead("parent", reader, file, [
                await readFile(file, "utf8"),
              ]);
        }
        const result: ExpertRunResult = {
          childSessionId: "review-child",
          status: "completed",
          structured: true,
          findings: [],
          conflicts: [],
          summary,
        };
        return { ok: true, code: "OK", message: "", result };
      },
    }),
    fileReadPath: () => src,
    documents: () => documents,
    subagents: () => undefined,
    audit,
    now: Date.now,
    logger: { info() {}, warn() {}, error() {} },
    steerMessage() {},
    publishStatus: (_, r) => receipts.push(r),
  });
  const agent = {
    id: "parent",
    session: {
      header: { cwd },
      surface: {
        get nodes() {
          return events.map((e) => e.seq);
        },
      },
      eventAt: (seq: number) => events[seq],
      snapshotEvents: () => events,
    },
    steer() {},
  } as unknown as GateAgent;
  return {
    stop: () => gate.handleTurnStopping(agent, 1, new AbortController().signal),
    calls: () => calls,
    receipts,
    output,
    digest,
    audit,
    followup(text = "Please send your comments.") {
      events.push(
        { type: "user/message", seq: 4, data: user("Show the comments") },
        {
          type: "assistant/message",
          seq: 5,
          data: answer(text),
        },
      );
    },
  };
}
it("binds the accepted DOCX and its source to the receipt and scopes a later text pass to its own request", async () => {
  const f = await fixture(proof);
  expect(await f.stop()).toBe("pass");
  expect(f.receipts.at(-1)).toMatchObject({
    requestSeq: 0,
    candidateSeq: 3,
    documents: [
      { name: "report.docx", sha256: f.digest, sourceSha256: [hash(req)] },
    ],
  });
  expect(await f.stop()).toBeNull();
  expect(f.calls()).toBe(1);
  f.followup();
  expect(await f.stop()).toBe("pass");
  expect(f.receipts.at(-1)).toMatchObject({
    requestSeq: 4,
    candidateSeq: 5,
    status: "pass",
  });
  expect(f.receipts.at(-1)).not.toHaveProperty("documents");
});
it.each([
  [proof, false],
  ["looks fine", true],
  [proof.replace(req, report), true],
] as const)("rejects unsupported pass evidence", async (summary, read) => {
  const f = await fixture(summary, read);
  expect(await f.stop()).toBe("failure");
  expect(f.receipts.some((r) => r.status === "pass")).toBe(false);
});
it("invalidates a cached pass when the file changes under the same answer text", async () => {
  const f = await fixture(proof);
  expect(await f.stop()).toBe("pass");
  await writeFile(f.output, "different binary");
  expect(await f.stop()).toBe("failure");
  expect(f.receipts.at(-1)?.status).toBe("failure");
});
it("rejects quotations obtained by another child", async () => {
  const f = await fixture(proof, true, "different-child");
  expect(await f.stop()).toBe("failure");
});
it("retrieves the original requirements for a later named delivery and verifies annotated citations", async () => {
  const cited = `CHECK S1 D1 | S1 line 7: «${req}» | D1 pages 4–5: «${report}» | ${explanation}`;
  const f = await fixture(cited);
  f.followup("Here is the generated report.docx.");
  expect(await f.stop()).toBe("pass");
  expect(f.receipts.at(-1)).toMatchObject({
    candidateSeq: 5,
    documents: [{ sha256: f.digest, sourceSha256: [hash(req)] }],
  });
});
it("accepts two observed quotations with inline annotations and a comparison after the arrow", async () => {
  const f = await fixture(
    `CHECK S1 D1 | S1 line 7: «${req}» → D1 line 5: «${report}». ${explanation}`,
  );
  expect(await f.stop()).toBe("pass");
});
