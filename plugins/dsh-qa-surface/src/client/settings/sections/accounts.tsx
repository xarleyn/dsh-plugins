/**
 * Accounts: the account gate, the self-declared profile, and per-user
 * workspaces. The per-user toggle lands together with the sandbox mode —
 * the Host accepts that pairing or nothing.
 */

import {
  IdentitiesField,
  Notice,
  NumberField,
  Section,
  Toggle,
} from "../fields.js";
import { perUserWorkspaceGaps } from "../format.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

/** The account gate, the self-declared profile, and per-user workspaces. */
export function AccountsSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const accounts = config?.accounts;
  const enabled = accounts?.enabled ?? false;
  const profile = accounts?.profile;
  const perUser = accounts?.perUserWorkspace ?? false;
  const gaps = perUser ? [] : perUserWorkspaceGaps(config ?? {});
  const paths: SectionPaths = [["accounts"]];
  const modified = overriddenAny(props, paths);
  return (
    <Section
      title="Аккаунты"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <div className="qa-card-grid">
        <Toggle
          checked={enabled}
          disabled={disabled}
          label="Вход по аккаунтам"
          hint="Пока выключено, страница открыта всякому, кто до неё дошёл."
          onChange={(value) => {
            props.write(["accounts", "enabled"], value);
          }}
        />
        <Toggle
          checked={accounts?.allowRegistration ?? true}
          disabled={disabled || !enabled}
          label="Самостоятельная регистрация"
          hint="Посетитель может завести аккаунт сам. Первый зарегистрированный становится администратором."
          onChange={(value) => {
            props.write(["accounts", "allowRegistration"], value);
          }}
        />
        <NumberField
          label="Срок жизни входа, дней"
          value={accounts?.sessionTtlDays ?? 30}
          min={1}
          max={365}
          disabled={disabled || !enabled}
          hint="Через сколько дней браузеру придётся войти заново."
          onChange={(value) => {
            props.write(["accounts", "sessionTtlDays"], value);
          }}
        />
        <Toggle
          checked={accounts?.showOtherUsersChats ?? false}
          disabled={disabled || !enabled}
          label="Администраторам видны чужие чаты"
          hint="Обычный аккаунт видит только свои чаты; эта настройка открывает администраторам список всех."
          onChange={(value) => {
            props.write(["accounts", "showOtherUsersChats"], value);
          }}
        />
      </div>
      {enabled ? (
        <Notice tone="info">
          Аккаунты называют пользователя и закрепляют за ним чаты. Они не
          отгораживают харнесс: сессия помощника всё равно живёт в правах
          процесса хоста.
        </Notice>
      ) : (
        <Notice tone="info">
          Аккаунты выключены: все посетители анонимны, чаты не закрепляются за
          человеком, а общая история страницы доступна каждому.
        </Notice>
      )}
      {enabled && (accounts?.showOtherUsersChats ?? false) ? (
        <Notice tone="warn">
          Администраторы видят чаты других пользователей. Это осознанное решение
          стенда: содержимое чужих диалогов попадает на экран тому, кто их не
          вёл.
        </Notice>
      ) : null}
      <div className="qa-card-grid">
        <Toggle
          checked={perUser}
          disabled={disabled || !enabled}
          label="Отдельное рабочее пространство каждому"
          hint="Сессии расходятся по каталогам пользователей внутри выбранного рабочего пространства. Сохраняется вместе с режимом песочницы «запись», иначе хост отвергает конфигурацию."
          onChange={(value) => {
            props.writeMany([
              { path: ["accounts", "perUserWorkspace"], value },
              {
                path: ["lockdown", "sandboxMode"],
                value: value ? "workspace-write" : "read-only",
              },
            ]);
          }}
        />
      </div>
      {!perUser && gaps.length > 0 ? (
        <Notice tone="info">
          Для персональных рабочих пространств нужно ещё: {gaps.join("; ")}.
        </Notice>
      ) : null}
      <div className="qa-card-grid">
        <Toggle
          checked={profile?.enabled ?? true}
          disabled={disabled || !enabled}
          label="Профиль пользователя"
          hint="Форма «о себе» в интерфейсе помощника; без аккаунтов её некому заполнять."
          onChange={(value) => {
            props.write(["accounts", "profile", "enabled"], value);
          }}
        />
        <Toggle
          checked={profile?.inject ?? true}
          disabled={disabled || !enabled || !(profile?.enabled ?? true)}
          label="Передавать профиль помощнику"
          hint="Имя, почта и заполненные поля профиля уходят в системную подсказку, чтобы помощник знал, с кем говорит."
          onChange={(value) => {
            props.write(["accounts", "profile", "inject"], value);
          }}
        />
        <NumberField
          label="Предел длины инструкций, символов"
          value={profile?.instructionsMaxLength ?? 2000}
          min={200}
          max={20_000}
          disabled={disabled || !enabled || !(profile?.enabled ?? true)}
          hint="Сколько свободного текста пользователь может написать о том, как ему отвечать."
          onChange={(value) => {
            props.write(
              ["accounts", "profile", "instructionsMaxLength"],
              value,
            );
          }}
        />
      </div>
      <IdentitiesField
        value={profile?.identities ?? []}
        disabled={disabled || !enabled || !(profile?.enabled ?? true)}
        onCommit={(fields) => {
          props.write(["accounts", "profile", "identities"], fields);
        }}
      />
      <div className="qa-card-grid">
        <Toggle
          checked={accounts?.starters?.enabled ?? true}
          disabled={disabled || !enabled}
          label="Свои быстрые сообщения"
          hint="Пользователь задаёт свои кнопки-подсказки над строкой ввода — название и отправляемый промпт — и может скрыть стандартные вопросы."
          onChange={(value) => {
            props.write(["accounts", "starters", "enabled"], value);
          }}
        />
      </div>
    </Section>
  );
}
