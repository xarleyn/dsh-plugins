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
import {
  prepareDocumentEvidence,
  type DocumentsReader,
  type FileReference,
} from "../src/document-evidence.js";
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
async function fixture(
  summary: string | ((task: string) => string),
  read = true,
  reader = "review-child",
  textFollowup = false,
  withSource = true,
  deliverable = report,
) {
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
      await writeFile(markdownPath, deliverable);
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
              sha256: hash(deliverable),
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
        content: withSource
          ? [
              {
                type: "file",
                attachment: {
                  attachmentId: "sha256:" + hash(req),
                  name: "requirements.txt",
                  bytes: req.length,
                },
              },
            ]
          : [{ type: "text", text: req }],
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
  if (textFollowup) {
    events.splice(1, 0, {
      type: "user/message",
      seq: 1,
      data: user("Create the final DOCX from the attachment above"),
    });
    events.forEach((event, seq) => {
      event.seq = seq;
    });
  }
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
          if (withSource) expect(task).toContain(JSON.stringify(src));
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
          summary: typeof summary === "function" ? summary(task) : summary,
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

it("compares a new deliverable to uploads retained by a text-only follow-up", async () => {
  const f = await fixture(proof, true, "review-child", true);
  expect(await f.stop()).toBe("pass");
  expect(f.receipts.at(-1)).toMatchObject({
    requestSeq: 1,
    documents: [{ sourceSha256: [hash(req)] }],
  });
});
it("rejects a self-only document pass when a follow-up has retained source files", async () => {
  const f = await fixture(
    `CHECK D1 D1 | ${report} | ${report} | Matches.`,
    true,
    "review-child",
    true,
  );
  expect(await f.stop()).toBe("failure");
  expect(f.receipts.some((r) => r.status === "pass")).toBe(false);
});

it("guides a source-free reviewer with the actual deliverable pair and still requires witnessed quotations", async () => {
  const f = await fixture(
    (task) => {
      expect(task).toContain("Required pairs: D1 D1.");
      expect(task).not.toContain("CHECK S1 D1");
      const example = task
        .split("\n")
        .find((line) => line.startsWith("CHECK "));
      expect(example).toContain("first deliverable passage");
      const pair = example!.split(" | ")[0];
      return `${pair} | ${report} | ${report} | The deliverable states the requested cutoff.`;
    },
    true,
    "review-child",
    false,
    false,
  );
  expect(await f.stop()).toBe("pass");
  expect(f.receipts.at(-1)).toMatchObject({
    status: "pass",
    documents: [{ sourceSha256: [] }],
  });
});

it("rejects an invented source key even when a source-free reviewer read the deliverable", async () => {
  const f = await fixture(
    `CHECK S1 D1 | ${report} | ${report} | Matches.`,
    true,
    "review-child",
    false,
    false,
  );
  expect(await f.stop()).toBe("failure");
  expect(f.receipts.some((receipt) => receipt.status === "pass")).toBe(false);
});

it.each([
  ["«", "»"],
  ["“", "”"],
  ['"', '"'],
  ["`", "`"],
])(
  "verifies quoted Markdown table pipes with %s%s delimiters",
  async (open, close) => {
    const row = "| Pressure requirement | Four bar maximum |";
    const f = await fixture(
      `CHECK S1 D1 | «${req}» | ${open}${row}${close} (document.md:3) | The table records the requirement.`,
      true,
      "review-child",
      false,
      true,
      `# Report\n\n${row}`,
    );
    expect(await f.stop()).toBe("pass");
  },
);

it("accepts an inline deliverable comparison with quoted table cells", async () => {
  const row = "| Pump response | Thirty seconds maximum |";
  const f = await fixture(
    `Verified the deliverable. CHECK D1 D1 | «${row}» | «${row}» | Both quotations state the requested cutoff.`,
    true,
    "review-child",
    false,
    false,
    row,
  );
  expect(await f.stop()).toBe("pass");
});

it.each([
  ["“", "”"],
  ["`", "`"],
  ["[", "]"],
])(
  "rejects a CHECK embedded in a meta example enclosed by %s%s",
  async (open, close) => {
    const f = await fixture(
      `Format example, not a review assertion: ${open}CHECK S1 D1 | «${req}» | «${report}» | Example comparison.${close}`,
    );
    expect(await f.stop()).toBe("failure");
    expect(f.receipts.some((receipt) => receipt.status === "pass")).toBe(false);
  },
);

it.each([false, true])(
  "rejects unwitnessed or fabricated table quotations (read=%s)",
  async (read) => {
    const row = "| Pressure requirement | Four bar maximum |";
    const f = await fixture(
      `Verified. CHECK S1 D1 | «${req}» | «${read ? row.replace("Four", "Forty") : row}» | Matches the requirement.`,
      read,
      "review-child",
      false,
      true,
      row,
    );
    expect(await f.stop()).toBe("failure");
    expect(f.receipts.some((receipt) => receipt.status === "pass")).toBe(false);
  },
);

it("credits every evidence key for a shared cached extraction, only to the child that read it", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "document-cache-"));
  dirs.push(cwd);
  const source = path.join(cwd, "source", "report.docx");
  const target = path.join(cwd, "output", "report.docx");
  const markdownPath = path.join(cwd, "extract", "document.md");
  const manifestPath = path.join(cwd, "extract", "manifest.json");
  const binary = "identical document bytes";
  const digest = hash(binary);
  for (const file of [source, target, markdownPath])
    await mkdir(path.dirname(file), { recursive: true });
  await writeFile(source, binary);
  await writeFile(target, binary);
  await writeFile(markdownPath, report);
  await writeFile(
    path.join(cwd, "output", "manifest.json"),
    JSON.stringify({
      scope: { sessionId: "parent" },
      outputs: [
        {
          format: "docx",
          status: "created",
          path: "report.docx",
          sha256: digest,
        },
      ],
    }),
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      scope: { sessionId: "parent" },
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
  const evidence = await prepareDocumentEvidence({
    sessionId: "parent",
    cwd,
    targets: [
      { path: "output/report.docx", digestPrefix: digest.slice(0, 16) },
    ],
    files: [
      {
        attachmentId: ("sha256:" + digest) as FileReference["attachmentId"],
        name: "report.docx",
        bytes: binary.length,
      },
    ],
    pathFor: () => source,
    documents: {
      async toMarkdown() {
        return { markdownPath, manifestPath };
      },
    },
    signal: new AbortController().signal,
  });
  const proof = `CHECK S1 D1 | ${report} | ${report} | The cached extraction is identical.`;
  await expect(evidence.verify(proof, "reviewer")).rejects.toThrow(
    "review-document-not-read",
  );
  evidence.observeRead("reviewer", markdownPath, [report]);
  await expect(evidence.verify(proof, "reviewer")).resolves.toBeUndefined();
  await expect(evidence.verify(proof, "other-reviewer")).rejects.toThrow(
    "review-document-not-read",
  );
});
