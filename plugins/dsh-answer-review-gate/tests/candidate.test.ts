import { describe, expect, it } from "vitest";

import {
  candidateHash,
  collectCandidate,
  normalizeCandidateText,
  type CandidateSession,
} from "../src/candidate.js";

interface FakeEvent {
  readonly type: string;
  readonly data: unknown;
}

function makeSession(events: readonly FakeEvent[]): CandidateSession {
  return {
    surface: {
      nodes: events.flatMap((event, seq) =>
        event.type === "user/message" || event.type === "assistant/message"
          ? [seq]
          : [],
      ),
    },
    eventAt: (seq) => events[seq],
    snapshotEvents: () => events,
  };
}

function userMessage(
  text: string,
  kind = "user",
  id = `message-${text}`,
): FakeEvent {
  return {
    type: "user/message",
    data: { id, source: { kind }, content: [{ type: "text", text }] },
  };
}

function assistantMessage(
  text: string,
  options: { interrupted?: true } = {},
): FakeEvent {
  return {
    type: "assistant/message",
    data: {
      turn: 1,
      step: 1,
      message: { content: [{ type: "text", text }] },
      stream: [],
      ...options,
    },
  };
}

function waiverLifecycle(
  commandId: string,
  request: FakeEvent,
): readonly FakeEvent[] {
  return [
    {
      type: "command/run",
      data: {
        commandId,
        name: "no-review",
        source: { kind: "user" },
      },
    },
    {
      type: "agent/inbox/spliced",
      data: { target: "next-turn", start: 0, inserted: [request.data] },
    },
    {
      type: "command/done",
      data: { commandId, kind: "success", sourceEventSeq: 1 },
    },
  ];
}

describe("collectCandidate", () => {
  it("collects the latest assistant message and the user request before it", () => {
    const session = makeSession([
      userMessage("What locks does the runtime use?"),
      assistantMessage("A first draft answer that is long enough for review."),
      userMessage("thanks", "tool"),
      assistantMessage("The runtime uses file locks around journal writes."),
    ]);
    expect(collectCandidate(session)).toEqual({
      text: "The runtime uses file locks around journal writes.",
      requestText: "What locks does the runtime use?",
      requestSeq: 0,
      reviewWaiver: null,
    });
  });

  it("reports the surface seq of the user request that owns the candidate", () => {
    const session = makeSession([
      userMessage("first question"),
      assistantMessage("An answer to the first question."),
      userMessage("second question"),
      assistantMessage("An answer to the second question."),
    ]);
    expect(collectCandidate(session)).toMatchObject({
      requestText: "second question",
      requestSeq: 2,
      reviewWaiver: null,
    });
  });

  it("reports no request seq when no real user message was found", () => {
    const session = makeSession([
      userMessage("injected context", "plugin"),
      assistantMessage("A candidate answer of sufficient length."),
    ]);
    expect(collectCandidate(session)).toMatchObject({
      requestText: null,
      requestSeq: null,
      reviewWaiver: null,
    });
  });

  it("skips non-user message sources when locating the request", () => {
    const session = makeSession([
      userMessage("injected context", "plugin"),
      userMessage("the real question"),
      assistantMessage("A candidate answer of sufficient length."),
    ]);
    const candidate = collectCandidate(session);
    expect(candidate?.requestText).toBe("the real question");
  });

  it("treats an interrupted latest message as no candidate", () => {
    const session = makeSession([
      userMessage("the question"),
      assistantMessage("Partial truncated ans", { interrupted: true }),
    ]);
    expect(collectCandidate(session)).toBeNull();
  });

  it("returns null for sessions without assistant output", () => {
    expect(collectCandidate(makeSession([userMessage("hello")]))).toBeNull();
    expect(collectCandidate(makeSession([]))).toBeNull();
  });

  it("accepts only the request linked by a successful command lifecycle", () => {
    const commandId = "cmd-waiver-1";
    const request = userMessage(
      "Ship this answer without review.",
      "user",
      "request-waived",
    );
    const session = makeSession([
      ...waiverLifecycle(commandId, request),
      request,
      assistantMessage(
        "The requested answer is ready and intentionally concise.",
      ),
    ]);

    expect(collectCandidate(session)?.reviewWaiver).toEqual({
      scope: "turn",
      via: "command",
      commandId,
    });
  });

  it("does not let an old command lifecycle waive a later request", () => {
    const commandId = "cmd-waiver-1";
    const original = userMessage(
      "original request",
      "user",
      "request-original",
    );
    const session = makeSession([
      ...waiverLifecycle(commandId, original),
      original,
      assistantMessage("The original answer was waived by the command."),
      userMessage("later request", "user", "request-later"),
      assistantMessage("This later answer must still be reviewed normally."),
    ]);

    expect(collectCandidate(session)?.reviewWaiver).toBeNull();
  });

  it.each([
    ["no lifecycle", []],
    [
      "failed command",
      [
        {
          type: "command/run",
          data: {
            commandId: "cmd-waiver-1",
            name: "no-review",
            source: { kind: "user" },
          },
        },
        {
          type: "command/done",
          data: {
            commandId: "cmd-waiver-1",
            kind: "error",
            sourceEventSeq: 1,
          },
        },
      ],
    ],
    [
      "wrong command",
      [
        {
          type: "command/run",
          data: {
            commandId: "cmd-waiver-1",
            name: "other",
            source: { kind: "user" },
          },
        },
        {
          type: "agent/inbox/spliced",
          data: { target: "next-turn", start: 0, inserted: [] },
        },
        {
          type: "command/done",
          data: {
            commandId: "cmd-waiver-1",
            kind: "success",
            sourceEventSeq: 1,
          },
        },
      ],
    ],
  ] as const)("rejects %s", (label, lifecycle) => {
    const session = makeSession([
      ...lifecycle,
      userMessage(`ordinary request: ${label}`, "user", "request-ordinary"),
      assistantMessage(
        "An answer that would normally be independently reviewed.",
      ),
    ]);
    expect(collectCandidate(session)?.reviewWaiver).toBeNull();
  });

  it.each([
    'Explain why the phrase "review is not needed" must not bypass the gate.',
    "The user did not say that review is not needed.",
    "Do not claim that review is not needed.",
  ])("never infers a waiver from prose: %s", (request) => {
    const candidate = collectCandidate(
      makeSession([
        userMessage(request),
        assistantMessage("An ordinary answer that remains subject to review."),
      ]),
    );
    expect(candidate?.reviewWaiver).toBeNull();
  });
});

describe("normalizeCandidateText", () => {
  it("collapses encoding noise but keeps paragraph structure", () => {
    expect(normalizeCandidateText("  A\r\nB\rC \n\n\n\nD  ")).toBe(
      "A\nB\nC\n\nD",
    );
  });
});

describe("candidateHash", () => {
  it("is stable across cosmetic-only edits", () => {
    const base = candidateHash("Answer one.\n\nAnswer two.");
    expect(candidateHash("Answer one.\r\n\r\n\r\nAnswer two. ")).toBe(base);
  });

  it("changes when the content changes, invalidating a PASS", () => {
    const before = candidateHash("The answer is 42.");
    const after = candidateHash("The answer is 42, within documented limits.");
    expect(before).not.toBe(after);
    expect(before).toMatch(/^[0-9a-f]{64}$/u);
  });
});
