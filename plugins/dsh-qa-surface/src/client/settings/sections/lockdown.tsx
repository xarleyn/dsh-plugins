/**
 * Lockdown: the execution policy every QA chat is pinned to. Its fixed
 * choices are not editable on purpose — the Host rejects any configuration
 * that relaxes them, so the card explains rather than offers.
 */

import {
  Facts,
  ListField,
  Notice,
  Section,
  SelectField,
  TextField,
  Toggle,
} from "../fields.js";
import { describeSandbox, parseCommaList } from "../format.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

const SANDBOX_MODES = [
  { value: "read-only", label: "Только чтение" },
  { value: "workspace-write", label: "Запись в рабочее пространство" },
];

/** The execution policy every QA chat is pinned to. */
export function LockdownSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const lockdown = config?.lockdown;
  const enabled = lockdown?.enabled ?? true;
  const sandbox = lockdown?.sandboxMode ?? "read-only";
  const paths: SectionPaths = [["lockdown"]];
  const modified = overriddenAny(props, paths);
  return (
    <Section
      title="Блокировка"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      {enabled ? null : (
        <Notice tone="warn">
          Блокировка выключена. Сессии помощника больше не закрепляются за
          read-only профилем, белым списком инструментов и подтверждением
          «never»: их определяет обычная политика харнесса. Включайте только на
          стенде, где посетителям доверяют.
        </Notice>
      )}
      <div className="qa-card-grid">
        <Toggle
          checked={enabled}
          disabled={disabled}
          label="Закреплять политику"
          hint="Перед активацией страницы сессия приводится к выбранному ниже профилю."
          onChange={(value) => {
            props.write(["lockdown", "enabled"], value);
          }}
        />
        <TextField
          label="Пресет разрешений"
          value={lockdown?.permissionPreset ?? ""}
          disabled={disabled}
          placeholder="qa-read-only"
          hint="Пресет харнесса, которым закрепляется сессия. Обязателен при включённой блокировке и должен разрешаться в выбранный режим песочницы с подтверждением «never»."
          onChange={(value) => {
            props.write(["lockdown", "permissionPreset"], value);
          }}
        />
        <SelectField
          label="Режим песочницы"
          value={sandbox}
          disabled={disabled}
          options={SANDBOX_MODES}
          hint={describeSandbox(sandbox).hint}
          onChange={(value) => {
            props.write(["lockdown", "sandboxMode"], value);
          }}
        />
        <Toggle
          checked={lockdown?.enforceFixedAgentPreset ?? true}
          disabled={disabled}
          label="Фиксировать пресет агента"
          hint="Посетитель не может выбрать другого агента."
          onChange={(value) => {
            props.write(["lockdown", "enforceFixedAgentPreset"], value);
          }}
        />
        <Toggle
          checked={lockdown?.enforceFixedWorkspace ?? true}
          disabled={disabled}
          label="Фиксировать рабочее пространство"
          hint="Каталог сессии задаёт развёртывание, а не браузер."
          onChange={(value) => {
            props.write(["lockdown", "enforceFixedWorkspace"], value);
          }}
        />
        <Toggle
          checked={lockdown?.enforceFixedModel ?? true}
          disabled={disabled}
          label="Фиксировать модель"
          hint="Провайдер и модель берутся из конфигурации страницы."
          onChange={(value) => {
            props.write(["lockdown", "enforceFixedModel"], value);
          }}
        />
        <Toggle
          checked={lockdown?.allowSessionReset ?? false}
          disabled={disabled}
          label="Разрешить сброс сессии"
          hint="Нужен кнопке «новый чат» в разделе интерфейса."
          onChange={(value) => {
            props.write(["lockdown", "allowSessionReset"], value);
          }}
        />
      </div>
      <ListField
        label="Разрешённые инструменты"
        value={lockdown?.toolPolicy?.allow ?? []}
        disabled={disabled}
        placeholder="read, grep, glob"
        hint="Имена через запятую или по одному в строке. Пустой список не разрешает ничего: агент отвечает только текстом."
        parse={parseCommaList}
        onCommit={(values) => {
          props.write(["lockdown", "toolPolicy", "allow"], values);
        }}
      />
      {(lockdown?.toolPolicy?.allow?.length ?? 0) === 0 ? (
        <Notice tone="info">
          Белый список пуст: помощник отвечает, не вызывая инструментов.
        </Notice>
      ) : null}
      <details className="qa-card-advanced">
        <summary>Зафиксировано в цепочке политики</summary>
        <div className="qa-card-advanced-content">
          <Facts
            items={[
              {
                label: "Подтверждения",
                value: "never",
                note: "запросы подтверждения блокируются, а не одобряются автоматически",
              },
              {
                label: "Вопросы агента",
                value: "не поддерживаются",
                note: "вопрос к пользователю завершает ход, а не ждёт ответа",
              },
              {
                label: "Режим белого списка",
                value: "allow-list",
                note: "инструмент вне списка не запускается",
              },
              {
                label: "Смена разрешений",
                value: "запрещена",
                note: "allowPermissionChanges",
              },
              {
                label: "Слеш-команды",
                value: "запрещены",
                note: "allowSlashCommands",
              },
              {
                label: "Правка настроек",
                value: "запрещена",
                note: "allowSettingsMutation",
              },
              {
                label: "Переименование и удаление сессий",
                value: "запрещены",
                note: "allowSessionRename, allowSessionDelete",
              },
              {
                label: "Открытие чужой сессии",
                value: "запрещено",
                note: "allowArbitrarySessionOpen",
              },
            ]}
          />
          <p className="qa-card-muted">
            Эти значения не настраиваются: конфигурация с любым из включённых
            флагов отвергается хостом, поэтому карточка их не предлагает.
          </p>
        </div>
      </details>
    </Section>
  );
}
