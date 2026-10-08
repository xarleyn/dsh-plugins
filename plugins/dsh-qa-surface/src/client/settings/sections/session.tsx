/**
 * Session: which chat a visitor gets, which agent and model serve it, and how
 * many questions that model serves at once.
 * Provider and model are written as one mutation because the Host refuses
 * either of them alone.
 */

import {
  Notice,
  NumberField,
  Section,
  SelectField,
  TextField,
} from "../fields.js";
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
      testId="qa-settings-session"
      aside={resetAside(props, paths, "qa-settings-session-reset")}
    >
      <div className="qa-card-grid">
        <SelectField
          label="Политика сессии"
          value={policy ?? "browser-persistent"}
          disabled={disabled}
          options={SESSION_POLICIES}
          hint={policyCopy.hint}
          testId="qa-settings-session-policy"
          onChange={(value) => {
            props.write(["session", "policy"], value);
          }}
        />
        <TextField
          label="Ключ хранения в браузере"
          value={config?.session?.storageKey ?? ""}
          disabled={disabled}
          hint="Префикс ключей localStorage и sessionStorage. Смена ключа разводит историю этого браузера с прежней."
          testId="qa-settings-session-storage-key"
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
          testId="qa-settings-session-fixed-session-id"
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
          testId="qa-settings-session-agent-preset"
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
          testId="qa-settings-session-reasoning-effort"
          onChange={(value) => {
            props.write(["session", "reasoningEffort"], value);
          }}
        />
        <TextField
          label="Провайдер модели"
          value={provider}
          disabled={disabled}
          placeholder="deepseek"
          hint="Пара развёртывания: ею открывается чат любой роли, которая задала свою пару сама. Задаётся вместе с моделью: по отдельности хост отвергает конфигурацию, поэтому поле сохраняет оба значения сразу. Пару отдельной роли или аккаунта задаёт консоль QA на странице «Саброли» и в карточке пользователя."
          testId="qa-settings-session-provider"
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
          hint="Вторая половина пары развёртывания; роль со своей парой её переопределяет. Сохраняется вместе с провайдером по той же причине. Значение, которого нет в каталоге хоста, отвергается при открытии чата — стенд не уходит в попытку выбрать несуществующую модель."
          testId="qa-settings-session-model"
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
          testId="qa-settings-session-cwd"
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
          testId="qa-settings-session-workspace-id"
          onChange={(value) => {
            props.write(["session", "workspaceId"], value);
          }}
        />
        <NumberField
          label="Максимум одновременных вопросов"
          value={config?.session?.maxActiveRequests ?? 0}
          min={0}
          max={50}
          disabled={disabled}
          hint="Сколько вопросов стенд отвечает сразу; 0 — без ограничения. Локальной модели это нужно, чтобы третий вопрос не замедлял остальные: когда все места заняты, новый вопрос не отправляется и остаётся в поле ввода, а браузер показывает очередь."
          onChange={(value) => {
            props.write(["session", "maxActiveRequests"], value);
          }}
        />
      </div>
      {provider !== "" && model === "" ? (
        <Notice
          tone="warn"
          testId="qa-settings-session-notice-provider-without-model"
        >
          Провайдер задан без модели — хост отвергнет такую конфигурацию.
          Заполните модель или очистите провайдера.
        </Notice>
      ) : null}
      {cwd !== "" && workspaceId !== "" ? (
        <Notice
          tone="warn"
          testId="qa-settings-session-notice-cwd-and-workspace"
        >
          Заданы и рабочий каталог, и рабочее пространство: сессия не может
          следовать обоим. Очистите одно из полей.
        </Notice>
      ) : null}
    </Section>
  );
}
