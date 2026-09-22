/**
 * Documentation: which edition of the corpus a question is answered from.
 *
 * A published corpus carries several editions of the same module under
 * `docs/<module>/<version>/…`, and a chat asked about "the product" reads
 * whichever edition it meets first. A stand that knows which edition it is
 * about names it here, and `docs_search` stays inside it unless the call itself
 * names a `version` or narrows `path`. The switch keeps the value while turning
 * the behaviour off, so a stand can stop defaulting without losing the version
 * it configured.
 */

import { Facts, Notice, Section, TextField, Toggle } from "../fields.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

const DOCS_PATHS: SectionPaths = [
  ["tools", "docsDefaultVersion"],
  ["tools", "docsDefaultVersionEnabled"],
];

/** The documentation corpus the QA tools read, and the edition they default to. */
export function DocsSection(props: ConfigProps) {
  const tools = props.config?.tools;
  const version = (tools?.docsDefaultVersion ?? "").trim();
  const enabled = tools?.docsDefaultVersionEnabled ?? false;
  const disabled = !props.writable;
  const paths: SectionPaths = DOCS_PATHS;
  const root = (props.effective?.tools.docsRoot ?? "").trim();
  return (
    <Section
      title="Документация"
      modified={overriddenAny(props, paths)}
      aside={resetAside(props, paths)}
    >
      <p className="qa-card-muted">
        Поиск и чтение документации ходят по корпусу стенда — дереву
        docs/&lt;модуль&gt;/&lt;версия&gt;/…. Поиск обходит модули раньше
        служебных каталогов (тех, что начинаются с подчёркивания), а в каждом
        попадании называет модуль и версию документа.
      </p>
      <Toggle
        label="Версия по умолчанию"
        hint="Поиск, которому не назвали версию и не сузили подкаталог, остаётся внутри этой редакции корпуса. Явные version или path сильнее: они решают сами."
        checked={enabled}
        disabled={disabled}
        onChange={(checked) => {
          props.write(["tools", "docsDefaultVersionEnabled"], checked);
        }}
      />
      <TextField
        label="Версия"
        value={tools?.docsDefaultVersion ?? ""}
        disabled={disabled}
        placeholder="3.8"
        hint="Как в пути к документу: 3.8, v2, 2024.1. Пусто — дефолта нет, поиск идёт по всем редакциям. Другое значение Host отклонит: версия, которой нет в дереве, отвечала бы «документа нет»."
        onChange={(value) => {
          props.write(["tools", "docsDefaultVersion"], value);
        }}
      />
      {enabled && version === "" ? (
        <Notice tone="warn">
          Флаг включён, а версия не задана: поиск по-прежнему идёт по всем
          редакциям корпуса.
        </Notice>
      ) : null}
      {props.effective === null ? null : (
        <Facts
          items={[
            {
              label: "Корень документации",
              value: root === "" ? "docs/ рабочего каталога чата" : root,
              note:
                root === ""
                  ? "развёртывание не назвало общий корпус"
                  : "tools.docsRoot развёртывания",
            },
          ]}
        />
      )}
    </Section>
  );
}
