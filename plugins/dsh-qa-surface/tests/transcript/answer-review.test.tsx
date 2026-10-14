// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SessionEventLike } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ChatSnapshot } from "@deepseek-ai/dsh-client-ui-chat/client";
import type {
  ConversationNode,
  ConversationNodeContext,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { QaAnswerReview, QaMessage } from "../../src/types.js";
import {
  readAnswerReview,
  answerReviewConversationDefinition as definition,
  QA_REVIEW_NODE,
} from "../../src/client/answer-review.js";
import { QaAnswerReviewStatus } from "../../src/client/components/QaAnswerReviewStatus.js";
import { sameMessage } from "../../src/client/components/QaMessage.js";
import { projectTranscript } from "../../src/client/QaTranscriptAdapter.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";

afterEach(cleanup);
const review: QaAnswerReview = {
  version: 1,
  candidateSeq: 2,
  candidateHash: "a".repeat(64),
  requestSeq: 1,
  round: 1,
  status: "pass",
  at: 100,
};
const event = (
  receipt: unknown = review,
  kind = "answer-review-status",
  seq = 3,
) =>
  ({
    type: "user/message",
    seq,
    time: 100,
    data: { source: { kind, receipt } },
  }) as unknown as SessionEventLike;

describe("current answer review", () => {
  it("reads producer metadata and refuses human text, unknown statuses and malformed identity", () => {
    expect(readAnswerReview(event())).toEqual(review);
    expect(readAnswerReview(event(review, "user"))).toBeNull();
    for (const malformed of [
      null,
      {},
      { ...review, status: "PASS" },
      { ...review, candidateHash: "fake" },
      { ...review, candidateSeq: -1 },
      { ...review, at: NaN },
    ])
      expect(readAnswerReview(event(malformed))).toBeNull();
    expect(
      readAnswerReview({
        type: "assistant/message",
        data: {
          message: { content: [{ type: "text", text: "VERDICT: PASS" }] },
        },
      } as unknown as SessionEventLike),
    ).toBeNull();
  });

  it("replaces the status for the same request and anchors the latest answer instead of the old failure", () => {
    const first = event({ ...review, status: "failure" });
    const last = event(
      { ...review, candidateSeq: 8, status: "pass" },
      "answer-review-status",
      9,
    );
    expect(definition.match(first)?.id).toBe(definition.match(last)?.id);
    expect(definition.match(event({ ...review, requestSeq: 10 }))?.id).not.toBe(
      definition.match(last)?.id,
    );
    const matches = [first, last].map((e) => ({
      event: e,
      location: { kind: "session" },
    }));
    const context = {
      key: "review:1",
      id: "1",
      state: readAnswerReview(last),
      matches,
      start: matches[0],
    } as unknown as ConversationNodeContext<QaAnswerReview>;
    expect(definition.buildViewNode!(context)).toMatchObject({
      anchorSeq: 9,
      data: { candidateSeq: 8, status: "pass" },
    });
  });

  it("attaches persisted status only to its exact assistant sequence on replay", () => {
    const nodes = [2, 8].map((seq) => ({
      kind: "assistant",
      seq,
      time: seq * 10,
      turn: seq,
      step: 1,
      blocks: [{ kind: "text", text: "Answer version " + seq }],
    })) as ConversationNode[];
    const slice = legacy({ nodes });
    const chat = {
      legacy: slice,
      nodes: {
        values: () => [
          { kind: QA_REVIEW_NODE, data: { ...review, candidateSeq: 8 } },
        ],
      },
    } as unknown as ChatSnapshot;
    const state = {
      ...snapshot(slice),
      views: {
        get: (target: string) => (target === "chat" ? chat : undefined),
        grouped: () => undefined,
      },
    };
    const messages = projectTranscript(state).filter(
      (m) => m.role === "assistant",
    );
    expect(messages.map((m) => m.review?.status)).toEqual([undefined, "pass"]);
    expect(projectTranscript(state)).toEqual(projectTranscript(state));
  });

  it("refreshes a memoized answer when only its review changes", () => {
    const message: QaMessage = {
      id: "answer",
      role: "assistant",
      seq: 2,
      text: "Useful answer",
      status: "committed",
      review,
    };
    expect(sameMessage(message, { ...message, review: { ...review } })).toBe(
      true,
    );
    expect(
      sameMessage(message, {
        ...message,
        review: { ...review, status: "failure" },
      }),
    ).toBe(false);
    expect(sameMessage(message, { ...message, review: undefined })).toBe(false);
  });

  it("shows the recovered PASS as current and keeps failures and waivers distinct", () => {
    const view = render(
      <QaAnswerReviewStatus review={{ ...review, status: "recovering" }} />,
    );
    expect(screen.getByRole("status").textContent).toBe("Повторяем проверку");
    view.rerender(<QaAnswerReviewStatus review={review} />);
    expect(screen.getByRole("status").textContent).toBe("Ответ проверен");
    expect(screen.getByRole("status").getAttribute("title")).toContain(
      "актуальный результат",
    );
    for (const status of ["failure", "cancelled", "waived"] as const) {
      view.rerender(<QaAnswerReviewStatus review={{ ...review, status }} />);
      expect(screen.getByRole("status").textContent).not.toContain(
        "Ответ проверен",
      );
    }
  });
});
