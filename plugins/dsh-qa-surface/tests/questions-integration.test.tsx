// @vitest-environment jsdom
/**
 * The question seam end to end, minus the wire: the harness waterfall a
 * model's `ask_user_question` call enters, the Host gate that parks it, the
 * RPC the QA page speaks, the form the operator fills in, and the structured
 * answer that comes back out of the waterfall. Only the transport is a stub —
 * the gate, the bridge and the form are the shipped ones, so a break anywhere
 * between the tool call and the operator's click fails here.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaQuestionGate } from "../src/questions.js";
import { QaSessionOwnership } from "../src/session-ownership.js";
import { QaHostQuestionBridge } from "../src/client/questions.js";
import { QaQuestions } from "../src/client/components/QaQuestions.js";
import type { QaQuestionApi } from "../src/client/types.js";
import { fakeContext, sessionAgent } from "./helpers/context-fakes.js";

const SILENT_LOGGER = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
};

/** The two questions of the pre-sales case the feature is written for. */
const ASKED = [
  {
    id: "modules",
    question: "Какие модули заказчик планирует приобрести?",
    multiSelect: true,
    options: [{ label: "Мониторинг" }, { label: "Контроль событий" }],
  },
  {
    id: "scope",
    question: "Нужен минимальный или расширенный связанный функционал?",
    options: [{ label: "Минимальный" }, { label: "Расширенный" }],
  },
];

/** The Host half and the page half wired the way the deployment wires them. */
function seam(attested = ["chat-1"]) {
  const fake = fakeContext();
  const gate = new QaQuestionGate(
    fake.context,
    () => true,
    new QaSessionOwnership((sessionId) => attested.includes(sessionId)),
    SILENT_LOGGER as never,
  );
  gate.install();
  // The plugin's own remotes: the page never touches the gate directly.
  const api: QaQuestionApi = {
    pendingQuestions: async (_token, sessionId) => ({
      ok: true as const,
      value: gate.list(sessionId),
    }),
    answerQuestion: async (_token, sessionId, requestId, answers) => ({
      ok: true as const,
      value: gate.answer(sessionId, requestId, answers),
    }),
    cancelQuestion: async (_token, sessionId, requestId) => ({
      ok: true as const,
      value: gate.cancel(sessionId, requestId),
    }),
  };
  const bridge = new QaHostQuestionBridge(api);
  return { gate, bridge, dispatch: fake.dispatch };
}

/** Mount the form over the bridge, as the surface does while a turn runs. */
async function openForm(
  bridge: QaHostQuestionBridge,
  sessionId = "chat-1",
): Promise<void> {
  await bridge.refresh(sessionId, "token", () => undefined);
  render(
    <QaQuestions
      questions={bridge.list()}
      onAnswer={(requestId, answers) =>
        bridge.answer(sessionId, "token", requestId, answers)
      }
      onCancel={(requestId) => bridge.cancel(sessionId, "token", requestId)}
    />,
  );
}

describe("answering a model's question from the QA view", () => {
  it("returns the operator's form to the tool call that is waiting", async () => {
    const { bridge, dispatch, gate } = seam();
    const asked = dispatch(
      "user-questions/request",
      { questions: ASKED, agent: sessionAgent("chat-1") },
      async () => {
        throw new Error("no answerer accepted the request");
      },
    );

    await openForm(bridge);
    // A multi-select keeps its options open until the operator pages on.
    fireEvent.click(screen.getByText("Мониторинг"));
    fireEvent.click(screen.getByText("Далее"));
    // A single-select advances by itself.
    fireEvent.click(screen.getByText("Расширенный"));
    fireEvent.click(screen.getByText("Отправить"));

    await expect(asked).resolves.toEqual({
      answers: [
        { id: "modules", selected: ["Мониторинг"] },
        { id: "scope", selected: ["Расширенный"] },
      ],
    });
    // The Host holds nothing once the tool call has its answer.
    expect(gate.list("chat-1")).toEqual([]);
  });

  it("reports a question the operator skipped as skipped, never as a choice", async () => {
    const { bridge, dispatch } = seam();
    const asked = dispatch(
      "user-questions/request",
      { questions: ASKED, agent: sessionAgent("chat-1") },
      async () => {
        throw new Error("no answerer accepted the request");
      },
    );

    await openForm(bridge);
    fireEvent.click(screen.getByText("Пропустить"));
    fireEvent.click(screen.getByText("Минимальный"));
    fireEvent.click(screen.getByText("Отправить"));

    await expect(asked).resolves.toEqual({
      answers: [
        { id: "modules", selected: [] },
        { id: "scope", selected: ["Минимальный"] },
      ],
    });
  });

  it("closes the tool call with a refusal when the operator cancels", async () => {
    const { bridge, dispatch, gate } = seam();
    const asked = dispatch(
      "user-questions/request",
      { questions: ASKED, agent: sessionAgent("chat-1") },
      async () => {
        throw new Error("no answerer accepted the request");
      },
    );

    await openForm(bridge);
    fireEvent.click(screen.getByText("Отмена"));

    // The model reads a reason it can act on instead of a turn that waits.
    await expect(asked).rejects.toThrow(/closed the question/u);
    await waitFor(() => {
      expect(gate.list("chat-1")).toEqual([]);
    });
  });

  it("leaves another surface's question to the answerer behind it", async () => {
    // The stock DSH answerer is mounted in the same page as the QA one, and
    // the QA page speaks for its own chats only.
    const { bridge, dispatch } = seam();
    const stock = vi.fn(async () => ({
      answers: [{ id: "scope", selected: ["Минимальный"] }],
    }));
    const asked = dispatch(
      "user-questions/request",
      { questions: ASKED, agent: sessionAgent("someone-else") },
      stock,
    );
    await openForm(bridge, "someone-else");
    expect(stock).toHaveBeenCalledTimes(1);
    await expect(asked).resolves.toEqual({
      answers: [{ id: "scope", selected: ["Минимальный"] }],
    });
    expect(screen.queryByText(ASKED[0]!.question)).toBeNull();
  });
});
