import { QaQuestionGate } from "../src/questions.js";
import { QaSessionOwnership } from "../src/session-ownership.js";
import { fakeContext, sessionAgent } from "./helpers/context-fakes.js";
interface QuestionAnswerItem {
  readonly id: string;
  readonly selected: readonly string[];
  readonly custom?: string;
}

interface QuestionAnswer {
  readonly answers: readonly QuestionAnswerItem[];
}

const SILENT_LOGGER = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
};

/** A logger that keeps what the seam reported, for the observability tests. */
function recordingLogger() {
  const events: { level: string; event: string; payload: unknown }[] = [];
  const at =
    (level: string) =>
    (event: string, payload?: unknown): void => {
      events.push({ level, event, payload });
    };
  return {
    events,
    logger: {
      debug: at("debug"),
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
      close() {},
    },
    names: () => events.map((entry) => entry.event),
    payloadOf(event: string): Record<string, unknown> {
      const found = events.find((entry) => entry.event === event);
      return (found?.payload ?? {}) as Record<string, unknown>;
    },
  };
}

const QUESTIONS = [
  {
    id: "target",
    question: "Куда писать отчёт?",
    header: "Формат",
    options: [
      { label: "В Confluence", description: "Со страницей-источником" },
      { label: "В чат" },
    ],
  },
];

function gateFor(input: {
  interactive: boolean;
  attested: readonly string[];
  logger?: unknown;
}) {
  const fake = fakeContext();
  const ownership = new QaSessionOwnership((sessionId) =>
    input.attested.includes(sessionId),
  );
  const gate = new QaQuestionGate(
    fake.context,
    () => input.interactive,
    ownership,
    (input.logger ?? SILENT_LOGGER) as never,
  );
  gate.install();
  /** Invoke the gate exactly where the user-questions service would. */
  const ask = (
    request: unknown,
    next: () => Promise<QuestionAnswer> = async () => ({
      answers: [{ id: "target", selected: ["delegated"] }],
    }),
  ) =>
    fake.handler("user-questions/request")(
      request,
      next,
    ) as Promise<QuestionAnswer>;
  return {
    gate,
    ask,
    fire: fake.handler,
    count: fake.count,
    dispatch: fake.dispatch,
    register: fake.register,
    prepended: fake.prepended,
  };
}

export { fakeContext, gateFor, QUESTIONS, recordingLogger, sessionAgent };
