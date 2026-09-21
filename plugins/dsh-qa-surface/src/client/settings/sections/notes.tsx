/**
 * Model notes: the ambient plugin messages the injector writes into a QA chat
 * (who the user is, the source-provenance rules, delegation naming, which
 * reader an attached document belongs to). Each note has a switch and an
 * optional wording override; an empty template keeps the built-in text, so the
 * fields double as a wording editor and a mute switch.
 */

import { Notice, Section, TextField, Toggle } from "../fields.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

const NOTE_PATHS: SectionPaths = [
  ["notes", "identity", "enabled"],
  ["notes", "identity", "template"],
  ["notes", "sources", "enabled"],
  ["notes", "sources", "template"],
  ["notes", "sources", "fallbackTemplate"],
  ["notes", "delegation", "enabled"],
  ["notes", "delegation", "template"],
  ["notes", "documents", "enabled"],
  ["notes", "documents", "template"],
];

/** The ambient notes the Host writes into QA chats as hidden user messages. */
export function NotesSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const identity = config?.notes?.identity;
  const sources = config?.notes?.sources;
  const delegation = config?.notes?.delegation;
  const documents = config?.notes?.documents;
  const paths: SectionPaths = NOTE_PATHS;
  const modified = overriddenAny(props, paths);
  return (
    <Section
      title="Заметки модели"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <p className="qa-card-muted">
        Служебные сообщения, которые плагин дописывает в начало диалога
        отдельным скрытым ходом. Выключение прекращает новые заметки; уже
        доставленные остаются в истории чата.
      </p>
      <Toggle
        label="Кто пользователь"
        hint="Профиль, хэндлы и личные инструкции автора чата уходят в контекст. Работает только при включённых профилях (accounts → profile → inject)."
        checked={identity?.enabled ?? true}
        disabled={disabled}
        onChange={(checked) => {
          props.write(["notes", "identity", "enabled"], checked);
        }}
      />
      <TextField
        label="Формулировка заметки о пользователе"
        value={identity?.template ?? ""}
        disabled={disabled}
        multiline
        rows={4}
        hint="Плейсхолдеры: {identity} — имя, email и хэндлы; {instructions} — личные инструкции пользователя. Пусто — встроенный текст."
        onChange={(value) => {
          props.write(["notes", "identity", "template"], value);
        }}
      />
      <Toggle
        label="Правила источников"
        hint="Напоминание, что источники собираются автоматически из вызовов тулов и ручной список «Источники» в ответе не нужен."
        checked={sources?.enabled ?? true}
        disabled={disabled}
        onChange={(checked) => {
          props.write(["notes", "sources", "enabled"], checked);
        }}
      />
      <TextField
        label="Формулировка правила об источниках"
        value={sources?.template ?? ""}
        disabled={disabled}
        multiline
        rows={4}
        hint="Пусто — встроенный текст."
        onChange={(value) => {
          props.write(["notes", "sources", "template"], value);
        }}
      />
      <TextField
        label="Формулировка фолбэка отчёта источников"
        value={sources?.fallbackTemplate ?? ""}
        disabled={disabled}
        multiline
        rows={3}
        hint="Дописывается, когда у субагентов включён фолбэк отчёта (sources → subagents → enableReportToolFallback). Плейсхолдер {reportTool} — имя тула; без него используется встроенный текст."
        onChange={(value) => {
          props.write(["notes", "sources", "fallbackTemplate"], value);
        }}
      />
      <Toggle
        label="Имена делегаций"
        hint="Просить модель называть фоновые субагенты коротким осмысленным именем в поле description — оно становится подписью в панели оператора."
        checked={delegation?.enabled ?? true}
        disabled={disabled}
        onChange={(checked) => {
          props.write(["notes", "delegation", "enabled"], checked);
        }}
      />
      <TextField
        label="Формулировка заметки о делегациях"
        value={delegation?.template ?? ""}
        disabled={disabled}
        multiline
        rows={4}
        hint="Пусто — встроенный текст."
        onChange={(value) => {
          props.write(["notes", "delegation", "template"], value);
        }}
      />
      <Toggle
        label="Документы во вложениях"
        hint="Напоминание читать приложенный документ Word или PDF конвейером документов (document_inspect, document_to_markdown), а не универсальным чтением файла: оно отказывает таким форматам как бинарным, и отказ читается как «файла нет»."
        checked={documents?.enabled ?? true}
        disabled={disabled}
        onChange={(checked) => {
          props.write(["notes", "documents", "enabled"], checked);
        }}
      />
      <TextField
        label="Формулировка заметки о документах"
        value={documents?.template ?? ""}
        disabled={disabled}
        multiline
        rows={4}
        hint="Пусто — встроенный текст. Выключите заметку, если на стенде нет конвейера документов."
        onChange={(value) => {
          props.write(["notes", "documents", "template"], value);
        }}
      />
      {identity?.enabled === false &&
      sources?.enabled === false &&
      delegation?.enabled === false &&
      documents?.enabled === false ? (
        <Notice tone="warn">
          Все заметки выключены: новые чаты не получат ни контекста о
          пользователе, ни правил источников, ни имён делегаций, ни
          маршрутизации документов.
        </Notice>
      ) : null}
    </Section>
  );
}
