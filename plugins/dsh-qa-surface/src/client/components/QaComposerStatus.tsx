import { useLayoutEffect, useRef } from "react";
import type { QaComposerActivity } from "../../types.js";
import { isReviewInProgress } from "../answer-review.js";
import { reviewCopy } from "./QaAnswerReviewStatus.js";

const activityCopy = {
  ...reviewCopy,
  writing: ["Готовим ответ", "Помощник работает над вашим запросом."],
  stopped: ["Подготовка ответа остановлена", "Можно задать следующий вопрос."],
  stopping: ["Останавливаем ответ…", "Ожидаем подтверждения остановки."],
} as const;

export function QaComposerStatus({
  activity,
  writingHint,
}: {
  activity: QaComposerActivity | "stopping";
  writingHint: string | null;
}) {
  const [title, detail] = activityCopy[activity];
  const busy =
    activity === "stopping" ||
    activity === "writing" ||
    isReviewInProgress(activity);
  return (
    <div
      className="dsh-qa-composer-status"
      data-testid="qa-composer-status"
      data-state={activity}
      role="status"
      aria-atomic="true"
    >
      <span
        className="dsh-qa-composer-status__mark"
        aria-hidden="true"
        data-busy={busy}
      >
        {busy
          ? null
          : activity === "pass"
            ? "✓"
            : activity === "revise" || activity === "failure"
              ? "!"
              : "–"}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{activity === "writing" ? (writingHint ?? detail) : detail}</p>
      </div>
    </div>
  );
}

export function QaStopConfirmation({
  id,
  reviewing,
  onContinue,
  onConfirm,
}: {
  id: string;
  reviewing: boolean;
  onContinue: () => void;
  onConfirm: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <div
      id={id}
      className="dsh-qa-stop-confirmation"
      data-testid="qa-composer-stop-confirmation"
      role="group"
      aria-labelledby={id + "-title"}
      aria-describedby={id + "-detail"}
    >
      <strong id={id + "-title"}>
        {reviewing
          ? "Остановить ответ и проверку?"
          : "Остановить подготовку ответа?"}
      </strong>
      <p id={id + "-detail"}>
        {reviewing
          ? "Текст останется в чате. Проверка этой версии прервётся."
          : "Помощник перестанет дописывать ответ."}
      </p>
      <div className="dsh-qa-stop-confirmation__actions">
        <button
          ref={keep}
          type="button"
          data-testid="qa-composer-stop-continue"
          onClick={onContinue}
        >
          {reviewing ? "Продолжить проверку" : "Продолжить ответ"}
        </button>
        <button
          type="button"
          data-testid="qa-composer-stop-confirm"
          onClick={onConfirm}
        >
          Остановить
        </button>
      </div>
    </div>
  );
}
