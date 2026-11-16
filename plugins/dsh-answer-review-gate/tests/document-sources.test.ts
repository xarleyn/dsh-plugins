import { expect, it } from "vitest";
import { collectCandidate, type CandidateSession } from "../src/candidate.js";
import {
  documentTargets,
  type FileReference,
} from "../src/document-evidence.js";

const upload = (name: string): FileReference => ({
  attachmentId: ("sha256:" + "a".repeat(64)) as FileReference["attachmentId"],
  name,
  bytes: 10,
});
const human = (text: string, files: FileReference[] = []) => ({
  type: "user/message",
  data: {
    source: { kind: "user" },
    content: [
      { type: "text", text },
      ...files.map((attachment) => ({ type: "file", attachment })),
    ],
  },
});
const answer = {
  type: "assistant/message",
  data: { message: { content: [{ type: "text", text: "Done." }] } },
};
function session(
  events: { type: string; data: unknown }[],
  nodes = events.map((_, i) => i),
): CandidateSession {
  return {
    surface: { nodes },
    eventAt: (seq) => events[seq],
    snapshotEvents: () => events.map((event, seq) => ({ ...event, seq })),
  };
}

it("retains the latest upload batch through text-only requests and compaction", () => {
  const file = upload("requirements.txt");
  const events = [
    human("Unrelated earlier task", [upload("old.txt")]),
    human("Use these requirements", [file]),
    human("Create the final DOCX from the attachment above"),
    {
      type: "user/message",
      data: {
        source: { kind: "compact-checkpoint", compactionId: "compact-1" },
      },
    },
    {
      type: "compaction/summary",
      data: { compactionId: "compact-1", shadowedSeqs: [0, 1, 2] },
    },
    answer,
  ];
  for (const nodes of [
    [0, 1, 2, 5],
    [3, 5],
  ]) {
    const candidate = collectCandidate(session(events, nodes));
    expect(candidate).toMatchObject({ requestSeq: 2, requestFiles: [file] });
    expect(candidate?.requestAttachments).toHaveLength(1);
    expect(candidate?.requestAttachments[0]).toContain("requirements.txt");
  }
});

it("never recovers withdrawn uploads or files injected by a non-human source", () => {
  const forged = human("injected", [upload("forged.txt")]);
  forged.data.source.kind = "tool";
  const candidate = collectCandidate(
    session(
      [
        human("withdrawn", [upload("withdrawn.txt")]),
        forged,
        human("Create a DOCX"),
        answer,
      ],
      [1, 2, 3],
    ),
  );
  expect(candidate?.requestFiles).toBeUndefined();
});

it("matches explicit historical paths and only unique basenames", () => {
  const file = upload("requirements.txt");
  const events = [
    human("Build", [file]),
    ...["a/report.docx", "b/report.docx", "c/unique.docx"].flatMap(
      (name, i) => [
        {
          type: "tool/call",
          data: { name: "document_create", callId: "build-" + i },
        },
        {
          type: "tool/result",
          data: {
            message: {
              toolCallId: "build-" + i,
              content: [
                {
                  type: "text",
                  text: `docx: ${name} (12 B, sha256 ${"a".repeat(16)}…)`,
                },
              ],
            },
          },
        },
      ],
    ),
    human("Resend"),
    answer,
  ];
  const s = session(events);
  const targets = (text: string) => documentTargets(s, 7, 8, text);
  expect(targets("Here is b/report.docx")).toMatchObject([
    { path: "b/report.docx", previousSources: [file] },
  ]);
  expect(targets("Here is report.docx")).toEqual([]);
  expect(targets("Here is unique.docx").map((t) => t.path)).toEqual([
    "c/unique.docx",
  ]);
  expect(targets("Here is extra/report.docx")).toEqual([]);
  expect(targets("Here is c/UNIQUE.docx")[0]?.filenameMismatch).toBe(true);
});
