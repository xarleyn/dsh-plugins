import type {
  QaSlashCatalogEntry,
  QaSlashExecution,
  QaSlashRefusal,
} from "../../types.js";
import type { QaSlashRoute } from "./slash-router.js";

/**
 * The user-facing copy of every slash decision. One module because these
 * strings are the whole interface between a refusal and the person reading it:
 * a refusal that does not say what to do next is indistinguishable from a bug.
 */

/** The refusal that predates the feature; unchanged, so nothing regresses. */
export const SLASH_DISABLED_COPY =
  "Команды со слешем недоступны в режиме помощника.";

export function slashRefusalCopy(
  route: Extract<
    QaSlashRoute,
    { kind: "unknown" | "ambiguous" | "unavailable" }
  >,
): string {
  switch (route.kind) {
    case "unknown":
      return `Неизвестное действие: /${route.name}. Выберите действие из списка.`;
    case "ambiguous":
      return `Найдены навык и команда с именем /${route.name}. Выберите нужное действие.`;
    case "unavailable":
      return "Список действий сейчас недоступен. Обычные сообщения работают.";
  }
}

/**
 * A gesture inside an ordinary prompt that this deployment withholds. Stated
 * as a fact about the deployment, not as a fault of the message, because the
 * message itself is fine — it is one word of it that will not take effect.
 */
export function slashWithheldCopy(names: readonly string[]): string {
  const list = names.map((name) => `/${name}`).join(", ");
  return `${list} недоступно в этом чате. Уберите упоминание или включите навык в настройках.`;
}

export function slashExecuteFailureCopy(entry: QaSlashCatalogEntry): string {
  return `Не удалось выполнить /${entry.name}.`;
}

/** Copy for a refusal the Host decided, keyed by its reason. */
export function slashHostRefusalCopy(
  refusal: Extract<QaSlashExecution, { kind: "refused" }>,
): string {
  const reason: QaSlashRefusal = refusal.reason;
  switch (reason) {
    case "slash-disabled":
      return SLASH_DISABLED_COPY;
    case "unknown-command":
      return "Команда больше недоступна.";
    case "not-allowed":
      return "Эта команда запрещена на этом стенде.";
    case "attachments-unsupported":
      return "Эта команда не принимает вложения.";
    case "inactive-session":
      return "Команда доступна только в активном чате.";
  }
}

/**
 * Attachments the chosen command refuses. Checked before dispatch so the
 * composer keeps the draft and the files; the Host checks it again and stays
 * the authority.
 */
export function slashAttachmentsCopy(entry: QaSlashCatalogEntry): string {
  return `/${entry.name} не принимает вложения.`;
}
