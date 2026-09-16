/**
 * Session: which chat a visitor gets, and which agent and model serve it.
 * Provider and model are written as one mutation because the Host refuses
 * either of them alone.
 */

import { Notice, Section, SelectField, TextField } from "../fields.js";
import { describeSessionPolicy } from "../format.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

const SESSION_POLICIES = [
  { value: "browser-persistent", label: "Чат закреплён за браузером" },
  { value: "new-on-load", label: "Новый чат при каждой загрузке" },
  { value: "fixed", label: "Один фиксированный чат" },
];

/** Which chat a visitor gets, and which agent and model serve it. */
export function SessionSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const policy = config?.session?.policy;
  const policyCopy = describeSessionPolicy(policy);
  const cwd = config?.session?.cwd ?? "";
  const workspaceId = config?.session?.workspaceId ?? "";
  const provider = config?.session?.provider ?? "";
  const model = config?.session?.model ?? "";
  const paths: SectionPaths = [["session"]];
  const modified = overriddenAny(props, paths);
  return (
    <Section
      title="Сессия"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <div className="qa-card-grid">
        <SelectField
          label="Политика сессии"
          value={policy ?? "browser-persistent"}
          disabled={disabled}
          options={SESSION_POLICIES}
          hint={policyCopy.hint}
          onChange={(value) => {
            props.write(["session", "policy"], value);
          }}
        />
        <TextField
          label="Ключ хранения в браузере"
          value={config?.session?.storageKey ?? ""}
          disabled={disabled}
          hint="Префикс ключей localStorage и sessionStorage. Смена ключа разводит историю этого браузера с прежней."
          onChange={(value) => {
            props.write(["session", "storageKey"], value);
          }}
        />
      </div>
      {policy === "fixed" ? (
        <TextField
          label="Идентификатор фиксированной сессии"
          value={config?.session?.fixedSessionId ?? ""}
          disabled={disabled}
          placeholder="session-…"
          hint="Обязателен для фиксированной политики: без него конфигурация отвергается."
          onChange={(value) => {
            props.write(["session", "fixedSessionId"], value);
          }}
        />
      ) : null}
      <div className="qa-card-grid">
        <TextField
          label="Пресет агента"
          value={config?.session?.agentPreset ?? ""}
          disabled={disabled}
          hint="Пресет, которым создаётся сессия помощника. Пусто — пресет по умолчанию."
          onChange={(value) => {
            props.write(["session", "agentPreset"], value);
          }}
        />
        <TextField
          label="Усилие рассуждений"
          value={config?.session?.reasoningEffort ?? ""}
          disabled={disabled}
          placeholder="low, medium, high…"
          hint="Значение для выбранной модели. Пусто — как решает пресет."
          onChange={(value) => {
            props.write(["session", "reasoningEffort"], value);
          }}
        />
        <TextField
          label="Провайдер модели"
          value={provider}
          disabled={disabled}
          placeholder="deepseek"
          hint="Задаётся вместе с моделью: по отдельности хост отвергает конфигурацию, поэтому поле сохраняет оба значения сразу."
          onChange={(value) => {
            props.writeMany([
              { path: ["session", "provider"], value },
              { path: ["session", "model"], value: model },
            ]);
          }}
        />
        <TextField
          label="Модель"
          value={model}
          disabled={disabled}
          placeholder="deepseek-chat"
          hint="Сохраняется вместе с провайдером по той же причине."
          onChange={(value) => {
            props.writeMany([
              { path: ["session", "provider"], value: provider },
              { path: ["session", "model"], value },
            ]);
          }}
        />
        <TextField
          label="Рабочий каталог сессии"
          value={cwd}
          disabled={disabled}
          placeholder="D:\qa"
          hint="Абсолютный путь. Взаимоисключим с рабочим пространством ниже."
          onChange={(value) => {
            props.write(["session", "cwd"], value);
          }}
        />
        <TextField
          label="Рабочее пространство"
          value={workspaceId}
          disabled={disabled}
          placeholder="workspace-…"
          hint="Зарегистрированное рабочее пространство харнесса. Взаимоисключимо с каталогом выше."
          onChange={(value) => {
            props.write(["session", "workspaceId"], value);
          }}
        />
      </div>
      {provider !== "" && model === "" ? (
        <Notice tone="warn">
          Провайдер задан без модели — хост отвергнет такую конфигурацию.
          Заполните модель или очистите провайдера.
        </Notice>
      ) : null}
      {cwd !== "" && workspaceId !== "" ? (
        <Notice tone="warn">
          Заданы и рабочий каталог, и рабочее пространство: сессия не может
          следовать обоим. Очистите одно из полей.
        </Notice>
      ) : null}
    </Section>
  );
}
