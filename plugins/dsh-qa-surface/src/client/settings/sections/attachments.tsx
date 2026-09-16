/**
 * Attachments: what a visitor may attach to one message. Like the interface
 * section, the list fields show the value in effect — a stored list, else the
 * Host's resolved one — so an untouched deployment never sees an empty box
 * for a setting that is active.
 */

import { DEFAULT_QA_TEXT_EXTENSIONS } from "../../../attachment-rules.js";
import { ListField, Notice, NumberField, Section, Toggle } from "../fields.js";
import { parseCommaList } from "../format.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

/**
 * What a visitor may attach to one message. Files never ride the prompt
 * inline: the browser stages them on the Host and the prompt cites the
 * receipt, so the model resolves the stored copy through its file tools — the
 * deployment's tool allow-list has to keep `read` for that to be useful.
 */
export function AttachmentsSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const attachments = config?.attachments;
  const textFiles = attachments?.textFiles ?? true;
  const pastedTextLines = attachments?.pastedTextLines ?? 200;
  const maxFileBytes = attachments?.maxFileBytes ?? 10_485_760;
  const maxPending = attachments?.maxPending ?? 8;
  const paths: SectionPaths = [["attachments"]];
  const modified = overriddenAny(props, paths);
  // The field shows the list in effect: a stored list wins, the Host's
  // resolved list stands in for it, then the built-in default.
  const stored = attachments?.extensions;
  const extensions =
    stored !== undefined && stored.length > 0
      ? stored
      : (props.effective?.attachments.extensions ?? DEFAULT_QA_TEXT_EXTENSIONS);
  return (
    <Section
      title="Вложения"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <div className="qa-card-grid">
        <Toggle
          checked={textFiles}
          disabled={disabled}
          label="Текстовые файлы"
          hint="К изображениям можно прикладывать md, txt, log и другие текстовые файлы. Выключено — только изображения."
          onChange={(value) => {
            props.write(["attachments", "textFiles"], value);
          }}
        />
        <NumberField
          label="Переносить вставку, строк"
          value={pastedTextLines}
          min={0}
          max={10_000}
          disabled={disabled || !textFiles}
          hint="Вставленный текст длиннее этого числа строк становится вложением. 0 отключает перенос."
          onChange={(value) => {
            props.write(["attachments", "pastedTextLines"], value);
          }}
        />
        <NumberField
          label="Лимит файла, байт"
          value={maxFileBytes}
          min={1_024}
          max={52_428_800}
          disabled={disabled || !textFiles}
          hint="Предельный размер одного прикладываемого файла."
          onChange={(value) => {
            props.write(["attachments", "maxFileBytes"], value);
          }}
        />
        <NumberField
          label="Вложений на сообщение"
          value={maxPending}
          min={1}
          max={40}
          disabled={disabled}
          hint="Изображения и файлы считаются вместе."
          onChange={(value) => {
            props.write(["attachments", "maxPending"], value);
          }}
        />
      </div>
      <ListField
        label="Расширения текстовых файлов"
        value={extensions}
        disabled={disabled || !textFiles}
        placeholder="md\ntxt\nlog"
        hint="По одному расширению на строку, без точки. Дополнительно принимается всё, что браузер помечает как text/*."
        parse={parseCommaList}
        onCommit={(values) => {
          props.write(["attachments", "extensions"], values);
        }}
      />
      <Notice tone="info">
        Файл сохраняется на сервере как есть, а в подсказке модели указывается
        путь к копии: содержимое читает инструмент чтения. Держите «read» в
        списке разрешённых инструментов, иначе вложение останется недоступным
        для модели.
      </Notice>
    </Section>
  );
}
