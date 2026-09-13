/**
 * Interface: what the visitor sees of the conversation. The show-reset toggle
 * stays disabled while the lockdown section withholds session reset — the
 * Host refuses one without the other.
 */

import { DEFAULT_THINKING_PHRASES } from "../../../thinking-phrases.js";
import { ListField, Notice, NumberField, Section, Toggle } from "../fields.js";
import { parseLineList } from "../format.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

/** What the visitor sees of the conversation. */
export function InterfaceSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const lockdownEnabled = config?.lockdown?.enabled ?? true;
  const allowReset = config?.lockdown?.allowSessionReset ?? false;
  const resetBlocked = lockdownEnabled && !allowReset;
  const reasoning = config?.ui?.showReasoning ?? false;
  const tools = config?.ui?.showToolActivity ?? false;
  const paths: SectionPaths = [
    ["ui"],
    ["suggestedQuestions"],
    ["thinkingPhrases"],
  ];
  const modified = overriddenAny(props, paths);
  const storedPhrases = config?.thinkingPhrases;
  // The field shows the list that is actually in effect: a stored list wins,
  // and otherwise the Host's resolved list stands in for it, so an untouched
  // deployment sees its running phrases instead of an empty box. The built-in
  // list is the last resort, before the Remote has answered.
  const phrases =
    storedPhrases !== undefined && storedPhrases.length > 0
      ? storedPhrases
      : (props.effective?.thinkingPhrases ?? DEFAULT_THINKING_PHRASES);
  return (
    <Section
      title="Интерфейс"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <div className="qa-card-grid">
        <Toggle
          checked={config?.ui?.showHeader ?? true}
          disabled={disabled}
          label="Заголовок страницы"
          hint="Название и подзаголовок в верхней полосе."
          onChange={(value) => {
            props.write(["ui", "showHeader"], value);
          }}
        />
        <Toggle
          checked={config?.ui?.showStop ?? true}
          disabled={disabled}
          label="Кнопка остановки"
          hint="Позволяет прервать ответ до его конца."
          onChange={(value) => {
            props.write(["ui", "showStop"], value);
          }}
        />
        <Toggle
          checked={config?.ui?.showReset ?? false}
          disabled={disabled || resetBlocked}
          label="Кнопка нового чата"
          hint={
            resetBlocked
              ? "Требует «Разрешить сброс сессии» в разделе блокировки: без него хост отвергает конфигурацию."
              : "Создаёт новый чат, не покидая страницу."
          }
          onChange={(value) => {
            props.write(["ui", "showReset"], value);
          }}
        />
        <Toggle
          checked={config?.ui?.showTimestamps ?? false}
          disabled={disabled}
          label="Время сообщений"
          hint="Отметка времени у каждого сообщения."
          onChange={(value) => {
            props.write(["ui", "showTimestamps"], value);
          }}
        />
        <Toggle
          checked={config?.ui?.renderMarkdown ?? true}
          disabled={disabled}
          label="Разметка в ответах"
          hint="Ответы рендерятся как Markdown, а не как обычный текст."
          onChange={(value) => {
            props.write(["ui", "renderMarkdown"], value);
          }}
        />
        <Toggle
          checked={config?.ui?.showSessionList ?? false}
          disabled={disabled}
          label="Список чатов"
          hint="Боковая история чатов этого браузера; переключение чата заново подтверждает политику."
          onChange={(value) => {
            props.write(["ui", "showSessionList"], value);
          }}
        />
        <Toggle
          checked={reasoning}
          disabled={disabled}
          label="Рассуждения модели"
          hint="Показывает ход рассуждений в свёрнутом блоке."
          onChange={(value) => {
            props.write(["ui", "showReasoning"], value);
          }}
        />
        <Toggle
          checked={tools}
          disabled={disabled}
          label="Вызовы инструментов"
          hint="Показывает, какие инструменты вызывались и с чем."
          onChange={(value) => {
            props.write(["ui", "showToolActivity"], value);
          }}
        />
        <NumberField
          label="Минимальная ширина содержимого, px"
          value={config?.ui?.minContentWidth ?? 650}
          min={480}
          max={1600}
          disabled={disabled}
          hint="Нижняя граница ширины переписки; шире посетитель расширяет её сам — до краёв страницы."
          onChange={(value) => {
            props.write(["ui", "minContentWidth"], value);
          }}
        />
      </div>
      {reasoning || tools ? (
        <Notice tone="warn">
          Рассуждения модели и вызовы инструментов становятся видны конечным
          пользователям. Включайте их там, где такое содержимое допустимо.
        </Notice>
      ) : null}
      <ListField
        label="Быстрые вопросы"
        value={config?.suggestedQuestions ?? []}
        disabled={disabled}
        placeholder={"Что ты умеешь?\nС чего начать?"}
        hint="По одному вопросу на строку: кнопки-подсказки над строкой ввода. Пустой список убирает их."
        parse={parseLineList}
        onCommit={(values) => {
          props.write(["suggestedQuestions"], values);
        }}
      />
      <ListField
        label="Фразы ожидания"
        value={phrases}
        disabled={disabled}
        placeholder={"Думаю…\nСобираю ответ…"}
        hint="По одной фразе на строку: их сменяет индикатор, пока модель отвечает. Пустой список возвращает встроенные фразы — индикатор всегда что-то говорит."
        parse={parseLineList}
        onCommit={(values) => {
          props.write(["thinkingPhrases"], values);
        }}
      />
    </Section>
  );
}
