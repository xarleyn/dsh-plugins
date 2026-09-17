/**
 * The status view: what the deployment actually serves, read from the running
 * Host rather than from the settings snapshot.
 */

import type {
  QaSurfaceConfig,
  ResolvedQaSurfaceConfig,
} from "../../../types.js";
import { Chip, Notice, Section } from "../fields.js";
import { formatClock, formatCount, pluralRu } from "../format.js";

export interface StatusProps {
  /** Effective configuration the running Host answered with, when it did. */
  readonly effective: ResolvedQaSurfaceConfig | null;
  /** Settings snapshot shown while the Host has not answered. */
  readonly config: QaSurfaceConfig | undefined;
  readonly refreshing: boolean;
  readonly refreshedAt: number | undefined;
  readonly overrides: number;
  readonly onRefresh: () => void;
}

/** One-line policy wording for the status chips. */
function shortPolicy(policy: string | undefined): string {
  switch (policy) {
    case "new-on-load":
      return "Новый при загрузке";
    case "fixed":
      return "Фиксированный";
    default:
      return "Чат в браузере";
  }
}

/**
 * What the deployment is actually serving: the route, the session policy, the
 * execution policy, and the account gate, as the Host resolved them. The card
 * polls this while it is open, so a saved change is confirmed here.
 */
export function StatusSection(props: StatusProps) {
  const effective = props.effective;
  const config = props.config;
  const enabled = effective?.enabled ?? config?.enabled ?? true;
  const routePath = effective?.route.path ?? config?.route?.path ?? "/qa";
  const policy = effective?.session.policy ?? config?.session?.policy;
  const sandbox =
    effective?.lockdown.sandboxMode ?? config?.lockdown?.sandboxMode;
  const lockdown =
    effective?.lockdown.enabled ?? config?.lockdown?.enabled ?? true;
  const accounts =
    effective?.accounts.enabled ?? config?.accounts?.enabled ?? false;
  const tools =
    effective?.lockdown.toolPolicy.allow.length ??
    config?.lockdown?.toolPolicy?.allow?.length;
  const questions =
    effective?.interaction.questions ?? config?.interaction?.questions;
  // The seam only ever produces a form where the tool policy lets the model
  // call the tool: one half without the other is a setting that does nothing.
  const questionTool = "ask_user_question";
  const questionToolAllowed =
    effective === null
      ? null
      : effective.lockdown.enabled &&
        effective.lockdown.toolPolicy.allow.includes(questionTool);

  return (
    <Section
      title="Состояние"
      modified={false}
      aside={
        <button
          type="button"
          className="qa-card-btn"
          disabled={props.refreshing}
          onClick={props.onRefresh}
        >
          {props.refreshing ? "Обновляю…" : "Обновить"}
        </button>
      }
    >
      <div className="qa-card-status">
        <Chip
          label="Страница"
          value={enabled ? "включена" : "выключена"}
          tone={enabled ? undefined : "off"}
        />
        <Chip label="Маршрут" value={enabled ? routePath : "—"} />
        <Chip label="Сессия" value={shortPolicy(policy)} />
        <Chip
          label="Блокировка"
          value={
            !lockdown
              ? "выключена"
              : sandbox === "workspace-write"
                ? "запись"
                : "только чтение"
          }
          tone={lockdown ? undefined : "off"}
        />
        <Chip label="Аккаунты" value={accounts ? "включены" : "выключены"} />
        <Chip
          label="Вопросы модели"
          value={questions === "interactive" ? "формой в чате" : "отклоняются"}
          tone={questions === "interactive" ? undefined : "off"}
        />
        <Chip label="Инструменты" value={formatCount(tools)} />
        <Chip label="Проверено" value={formatClock(props.refreshedAt)} />
      </div>
      {effective === null ? (
        <Notice tone="info">
          Хост ещё не ответил: значения взяты из настроек. Как только он
          ответит, здесь появится конфигурация, с которой работает страница.
        </Notice>
      ) : null}
      {questions === "interactive" && questionToolAllowed === false ? (
        <Notice tone="warn">
          Вопросы включены, но инструмент {questionTool} не входит в список
          разрешённых (lockdown.toolPolicy.allow): модель не сможет задать
          вопрос, и форма не появится. Добавьте инструмент в список или
          выключите вопросы.
        </Notice>
      ) : null}
      {questions !== "interactive" && questionToolAllowed === true ? (
        <Notice tone="warn">
          Инструмент {questionTool} разрешён, а вопросы выключены: каждый запрос
          модели будет отклонён. Включите «Вопросы модели» в разделе
          «Взаимодействие» или уберите инструмент из списка разрешённых.
        </Notice>
      ) : null}
      {props.overrides > 0 ? (
        <p className="qa-card-muted">
          Пользовательский слой настроек переопределяет{" "}
          {pluralRu(props.overrides, ["ключ", "ключа", "ключей"])}. Секции ниже
          помечают такие поля как «изменено», и рядом с ними есть сброс.
        </p>
      ) : null}
    </Section>
  );
}
