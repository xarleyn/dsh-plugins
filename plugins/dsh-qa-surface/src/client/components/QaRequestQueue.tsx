import type { QaQueueStatus } from "../../types.js";
import { pluralRu } from "../settings/format.js";
import { QaModal } from "./QaModal.js";

/**
 * The dialog a question gets when the stand has no place left for it.
 *
 * Saying where the question is beats saying that the visitor was refused: the
 * send stopped before anything reached the Host, so nothing was created,
 * nothing was answered, and the text is still in the composer. A visitor who
 * cannot tell that asks twice, and a second question is exactly the load the
 * ceiling exists to keep off a model that is already busy.
 *
 * The count names occupied places, not people ahead of the visitor: `active`
 * includes this visitor's own turns, and a stand that cannot tell whose place
 * is whose has no business numbering a queue behind which it claims to wait.
 * @param props - the load read that held the question back, and how to close.
 */
export function QaRequestQueue(props: {
  readonly status: QaQueueStatus | null;
  readonly onClose: () => void;
}) {
  const status = props.status;
  return (
    <QaModal
      open={status !== null}
      title="Подождите в очереди"
      closeLabel="Закрыть сообщение об очереди"
      onClose={props.onClose}
      footer={
        <button
          type="button"
          className="dsh-qa-modal__primary"
          onClick={props.onClose}
        >
          Понятно
        </button>
      }
    >
      {status === null ? null : (
        <>
          <p className="dsh-qa-request-queue__notice">
            Стенд отвечает не более чем на{" "}
            {pluralRu(status.limit, ["вопрос", "вопроса", "вопросов"])}, и
            сейчас все его места заняты: в работе{" "}
            {pluralRu(status.active, ["запрос", "запроса", "запросов"])}.
          </p>
          <p className="dsh-qa-request-queue__notice">
            Ваш вопрос не отправлен и остался в поле ввода. Отправьте его ещё
            раз, когда место освободится.
          </p>
        </>
      )}
    </QaModal>
  );
}
