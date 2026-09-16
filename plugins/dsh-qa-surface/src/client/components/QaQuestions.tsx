import { memo, useState } from "react";
import type {
  QaPendingQuestion,
  QaPendingQuestionItem,
  QaQuestionAnswerItem,
} from "../../types.js";

export interface QaQuestionsProps {
  readonly questions: readonly QaPendingQuestion[];
  readonly onAnswer: (
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ) => Promise<void>;
  readonly onCancel: (requestId: string) => Promise<void>;
}

/** What the operator has entered for one question so far. */
interface Draft {
  readonly selected: readonly string[];
  readonly custom: string;
  /** Explicitly skipped: the model is told the question was passed over. */
  readonly skipped: boolean;
}

const NO_DRAFT: Draft = { selected: [], custom: "", skipped: false };

const isAnswered = (draft: Draft): boolean =>
  draft.skipped || draft.selected.length > 0 || draft.custom.trim() !== "";

/**
 * Encode one question's draft the way the harness decodes it (its
 * user-questions README): a skipped question carries no selection, free text
 * overrides the choice in a single-select, and accompanies it in a
 * multi-select.
 */
function encodeAnswer(
  question: QaPendingQuestionItem,
  draft: Draft,
): QaQuestionAnswerItem {
  if (draft.skipped) return { id: question.id, selected: [] };
  const custom = draft.custom.trim();
  if (question.multiSelect) {
    return {
      id: question.id,
      selected: [...draft.selected],
      ...(custom === "" ? {} : { custom }),
    };
  }
  if (custom !== "") return { id: question.id, selected: [], custom };
  return { id: question.id, selected: [...draft.selected] };
}

/**
 * One parked `ask_user_question` request: the operator's answers, a question at
 * a time, with a pager when the model asked more than one thing at once.
 */
function QaQuestionForm({
  request,
  onAnswer,
  onCancel,
}: {
  readonly request: QaPendingQuestion;
  readonly onAnswer: QaQuestionsProps["onAnswer"];
  readonly onCancel: QaQuestionsProps["onCancel"];
}) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [busy, setBusy] = useState<"answer" | "cancel" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const questions = request.questions;
  const question = questions[Math.min(index, questions.length - 1)];
  if (question === undefined) return null;
  const draft = drafts[question.id] ?? NO_DRAFT;
  const last = index === questions.length - 1;
  const complete = questions.every((item) =>
    isAnswered(drafts[item.id] ?? NO_DRAFT),
  );
  const edit = (next: Draft) => {
    setDrafts((current) => ({ ...current, [question.id]: next }));
  };
  const advance = () => {
    setIndex((current) => Math.min(current + 1, questions.length - 1));
  };
  const select = (label: string) => {
    if (question.multiSelect) {
      const selected = draft.selected.includes(label)
        ? draft.selected.filter((item) => item !== label)
        : [...draft.selected, label];
      edit({ ...draft, selected });
      return;
    }
    edit({ ...draft, selected: [label] });
    if (!last) advance();
  };
  const skip = () => {
    edit({ ...draft, selected: [], custom: "", skipped: true });
    if (!last) advance();
  };
  const submit = () => {
    setBusy("answer");
    setFailure(null);
    void onAnswer(
      request.id,
      questions.map((item) => encodeAnswer(item, drafts[item.id] ?? NO_DRAFT)),
    )
      .catch(() => setFailure("Не удалось отправить ответ."))
      .finally(() => setBusy(null));
  };
  const cancel = () => {
    setBusy("cancel");
    setFailure(null);
    void onCancel(request.id)
      .catch(() => setFailure("Не удалось закрыть вопрос."))
      .finally(() => setBusy(null));
  };
  return (
    <section className="dsh-qa-question" aria-live="polite">
      <p className="dsh-qa-question__strip">
        <span className="dsh-qa-question__dot" aria-hidden="true" />
        {questions.length > 1
          ? `Требуется ответ · вопрос ${index + 1} из ${questions.length}`
          : "Требуется ответ"}
      </p>
      {question.header === null ? null : (
        <p className="dsh-qa-question__header">{question.header}</p>
      )}
      <fieldset className="dsh-qa-question__fieldset" disabled={busy !== null}>
        <legend className="dsh-qa-question__text">{question.question}</legend>
        {question.detail === null ? null : (
          <p className="dsh-qa-question__detail">{question.detail}</p>
        )}
        {question.options.length === 0 ? null : (
          <div
            className="dsh-qa-question__options"
            role={question.multiSelect ? "group" : "radiogroup"}
            aria-label={question.question}
          >
            {question.options.map((option) => {
              const checked = draft.selected.includes(option.label);
              return (
                <label
                  key={option.label}
                  className="dsh-qa-question__option"
                  data-checked={checked ? "true" : "false"}
                >
                  <input
                    type={question.multiSelect ? "checkbox" : "radio"}
                    name={`qa-question-${request.id}-${question.id}`}
                    checked={checked}
                    onChange={() => select(option.label)}
                  />
                  <span className="dsh-qa-question__option-text">
                    <span className="dsh-qa-question__option-label">
                      {option.label}
                    </span>
                    {option.description === null ? null : (
                      <span className="dsh-qa-question__option-description">
                        {option.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <label className="dsh-qa-question__custom">
          <span>Свой ответ</span>
          <textarea
            rows={2}
            value={draft.custom}
            placeholder="Напечатайте ответ…"
            onChange={(event) =>
              edit({ ...draft, custom: event.target.value, skipped: false })
            }
          />
        </label>
      </fieldset>
      {failure === null ? null : (
        <p className="dsh-qa-question__error" role="alert">
          {failure}
        </p>
      )}
      <div className="dsh-qa-question__actions">
        <button
          type="button"
          className="dsh-qa-question__button"
          disabled={busy !== null}
          onClick={cancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className="dsh-qa-question__button"
          disabled={busy !== null || draft.skipped}
          onClick={skip}
        >
          Пропустить
        </button>
        {index > 0 ? (
          <button
            type="button"
            className="dsh-qa-question__button"
            disabled={busy !== null}
            onClick={() => setIndex((current) => Math.max(current - 1, 0))}
          >
            Назад
          </button>
        ) : null}
        {last ? (
          <button
            type="button"
            className="dsh-qa-question__button dsh-qa-question__button--primary"
            disabled={busy !== null || !complete}
            onClick={submit}
          >
            Отправить
          </button>
        ) : (
          <button
            type="button"
            className="dsh-qa-question__button dsh-qa-question__button--primary"
            disabled={busy !== null || !isAnswered(draft)}
            onClick={advance}
          >
            Далее
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The questions a running turn waits on. Answers are the operator's own: the
 * form refuses to submit a question left blank, and a question explicitly
 * skipped is reported as skipped rather than answered by guesswork.
 */
export const QaQuestions = memo(function QaQuestions(props: QaQuestionsProps) {
  if (props.questions.length === 0) return null;
  return (
    <div className="dsh-qa-questions" aria-label="Вопросы помощника">
      {props.questions.map((request) => (
        <QaQuestionForm
          key={request.id}
          request={request}
          onAnswer={props.onAnswer}
          onCancel={props.onCancel}
        />
      ))}
    </div>
  );
});
