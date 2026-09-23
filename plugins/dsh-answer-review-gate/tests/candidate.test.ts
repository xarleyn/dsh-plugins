import { describe, expect, it } from "vitest";

import {
  candidateHash,
  collectCandidate,
  declinesAnswerReview,
  normalizeCandidateText,
  type CandidateSession,
} from "../src/candidate.js";

describe("declinesAnswerReview", () => {
  it.each([
    "Сделай без ревью",
    "Ревью не нужно, сразу отдай результат",
    "Не запускайте автоматическое ревью",
    "No automatic review, please",
    "Don't run the auto review",
    "Review is not required",
  ])("recognises an explicit opt-out: %s", (request) => {
    expect(declinesAnswerReview(request)).toBe(true);
  });

  it.each([
    "Проведи ревью перед ответом",
    "Объясни, почему ревью не запустилось вчера",
    "Review the implementation",
    null,
  ])("does not infer an opt-out from: %s", (request) => {
    expect(declinesAnswerReview(request)).toBe(false);
  });
});

interface FakeEvent {
  readonly type: string;
  readonly data: unknown;
}

function makeSession(events: readonly FakeEvent[]): CandidateSession {
  return {
    surface: { nodes: events.map((_, seq) => seq) },
    eventAt: (seq) => events[seq],
  };
}

function userMessage(text: string, kind = "user"): FakeEvent {
  return {
    type: "user/message",
    data: { source: { kind }, content: [{ type: "text", text }] },
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
