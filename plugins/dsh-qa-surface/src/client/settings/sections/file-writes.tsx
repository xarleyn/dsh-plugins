import { DEFAULT_QA_FILE_WRITE_POLICY } from "../../../shared/file-write-policy.js";
import { ListField, Section, TextField } from "../fields.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

const PATHS: SectionPaths = [
  ["tools", "fileWritePolicy", "blockedExtensions"],
  ["tools", "fileWritePolicy", "message"],
];

/** The operator's refusal is returned to the model before any native write. */
export function FileWritesSection(props: ConfigProps) {
  const policy = props.config?.tools?.fileWritePolicy;
  const fallback =
    props.effective?.tools.fileWritePolicy ?? DEFAULT_QA_FILE_WRITE_POLICY;
  return (
    <Section
      title="Запись файлов"
      modified={overriddenAny(props, PATHS)}
      testId="qa-settings-file-writes"
      aside={resetAside(props, PATHS, "qa-settings-file-writes-reset")}
    >
      <p className="qa-card-muted">
        Запрет проверяется до создания, перезаписи или редактирования файла. Он
        действует для ассистента и делегированных агентов чата. Изменения
        применяются при следующем вызове инструмента.
      </p>
      <ListField
        label="Запрещённые расширения"
        hint="Через пробел, запятую или с новой строки. Регистр не важен, точку можно опустить. Пустой список снимает этот запрет. Чтение файлов остаётся доступным."
        value={policy?.blockedExtensions ?? fallback.blockedExtensions}
        disabled={!props.writable}
        placeholder=".py, .pyw"
        rows={3}
        parse={(text) => text.split(/[\s,;]+/u).filter(Boolean)}
        onCommit={(extensions) => props.write(PATHS[0]!, extensions)}
        testId="qa-settings-file-writes-extensions"
      />
      <TextField
        label="Сообщение агенту"
        hint="Агент получит этот текст вместе с причиной отказа и запрещённым расширением. Укажите, какой доступный инструмент ему следует использовать. До 4000 символов; пустое сообщение Host отклонит."
        value={policy?.message ?? fallback.message}
        disabled={!props.writable}
        multiline
        rows={4}
        onChange={(message) => props.write(PATHS[1]!, message)}
        testId="qa-settings-file-writes-message"
      />
    </Section>
  );
}
