/**
 * Body sections of the QA Surface settings card.
 *
 * Each section owns its controls and derives every value from the settings
 * snapshot (the effective configuration) or, for the status view, from the
 * running Host through the `qaSurface/describe` Remote. The controls mirror
 * the Host's own validation: combinations the resolver refuses are either
 * written together in one mutation or explained rather than offered.
 */

import { DEFAULT_THINKING_PHRASES } from "../../thinking-phrases.js";
import type { ResolvedQaSurfaceConfig, QaSurfaceConfig } from "../../types.js";
import {
  Chip,
  Facts,
  IdentitiesField,
  ListField,
  Notice,
  NumberField,
  ResetButton,
  Section,
  SelectField,
  TextField,
  Toggle,
  type SectionProps,
} from "./fields.js";
import {
  describeSandbox,
  describeSessionPolicy,
  formatClock,
  formatCount,
  parseCommaList,
  parseLineList,
  perUserWorkspaceGaps,
  pluralRu,
} from "./format.js";

const SESSION_POLICIES = [
  { value: "browser-persistent", label: "Чат закреплён за браузером" },
  { value: "new-on-load", label: "Новый чат при каждой загрузке" },
  { value: "fixed", label: "Один фиксированный чат" },
];

const SANDBOX_MODES = [
  { value: "read-only", label: "Только чтение" },
  { value: "workspace-write", label: "Запись в рабочее пространство" },
];

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
        <Chip label="Инструменты" value={formatCount(tools)} />
        <Chip label="Проверено" value={formatClock(props.refreshedAt)} />
      </div>
      {effective === null ? (
        <Notice tone="info">
          Хост ещё не ответил: значения взяты из настроек. Как только он
          ответит, здесь появится конфигурация, с которой работает страница.
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

export interface ConfigProps extends SectionProps {
  readonly config: QaSurfaceConfig | undefined;
  /**
   * What the running Host resolved, when it answered. A control whose default
   * is not a literal — the running phrases — reads the effective list from
   * here instead of showing an empty field for a setting that is in effect.
   */
  readonly effective: ResolvedQaSurfaceConfig | null;
}

/** Where the page lives and who may reach it. */
export function AccessSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const modified =
    props.overridden(["enabled"]) ||
    props.overridden(["route"]) ||
    props.overridden(["entry"]);
  return (
    <Section
      title="Доступ и маршрут"
      modified={modified}
      aside={
        modified ? (
          <ResetButton
            disabled={disabled}
            label="Сбросить"
            onClick={() => {
              props.unset(["enabled"]);
              props.unset(["route"]);
              props.unset(["entry"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="qa-card-grid">
        <Toggle
          checked={config?.enabled ?? true}
          disabled={disabled}
          label="Страница включена"
          hint="Выключенная страница не отвечает по маршруту и не перенаправляет внешние входы."
          onChange={(value) => {
            props.write(["enabled"], value);
          }}
        />
        <Toggle
          checked={config?.route?.matchChildren ?? true}
          disabled={disabled}
          label="Включая вложенные пути"
          hint="Маршрут с вложенными адресами остаётся страницей помощника."
          onChange={(value) => {
            props.write(["route", "matchChildren"], value);
          }}
        />
        <TextField
          label="Путь страницы"
          value={config?.route?.path ?? "/qa"}
          disabled={disabled}
          placeholder="/qa"
          hint="Начинается с «/»; нельзя занять «/», «/api» и «/plugins». Смена пути перерегистрирует маршрут на хосте."
          onChange={(value) => {
            props.write(["route", "path"], value);
          }}
        />
        <Toggle
          checked={config?.entry?.redirectNonLoopback ?? true}
          disabled={disabled}
          label="Внешние входы — на страницу помощника"
          hint="Корень харнесса, открытый по внешнему адресу, переадресуется сюда. Локальный вход оператора не затрагивается."
          onChange={(value) => {
            props.write(["entry", "redirectNonLoopback"], value);
          }}
        />
      </div>
      {(config?.entry?.redirectNonLoopback ?? true) ? (
        <Notice tone="info">
          Перенаправление включено: любой, кто открыл харнесс по внешнему
          адресу, попадёт на страницу помощника, а не в интерфейс разработчика.
        </Notice>
      ) : (
        <Notice tone="warn">
          Перенаправление выключено: внешний посетитель корня харнесса остаётся
          в полном интерфейсе разработчика. Убедитесь, что он закрыт другими
          средствами.
        </Notice>
      )}
    </Section>
  );
}

/** Titles, welcome copy, and the notice under the composer. */
export function BrandingSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const modified = props.overridden(["branding"]);
  return (
    <Section
      title="Оформление"
      modified={modified}
      aside={
        modified ? (
          <ResetButton
            disabled={disabled}
            label="Сбросить"
            onClick={() => {
              props.unset(["branding"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="qa-card-grid">
        <TextField
          label="Название"
          value={config?.branding?.title ?? ""}
          disabled={disabled}
          placeholder="Помощник"
          hint="Заголовок на странице и в истории браузера."
          onChange={(value) => {
            props.write(["branding", "title"], value);
          }}
        />
        <TextField
          label="Подзаголовок"
          value={config?.branding?.subtitle ?? ""}
          disabled={disabled}
          hint="Строка под названием; пусто — без подзаголовка."
          onChange={(value) => {
            props.write(["branding", "subtitle"], value);
          }}
        />
        <TextField
          label="Приветствие"
          value={config?.branding?.welcomeMessage ?? ""}
          disabled={disabled}
          hint="Первое сообщение в пустом чате."
          onChange={(value) => {
            props.write(["branding", "welcomeMessage"], value);
          }}
        />
        <TextField
          label="Подсказка в поле ввода"
          value={config?.branding?.placeholder ?? ""}
          disabled={disabled}
          hint="Текст-заглушка в строке вопроса."
          onChange={(value) => {
            props.write(["branding", "placeholder"], value);
          }}
        />
        <TextField
          label="Адрес логотипа"
          value={config?.branding?.logoUrl ?? ""}
          disabled={disabled}
          placeholder="https://…/logo.svg"
          hint="Пусто — без логотипа. Картинка грузится браузером посетителя, поэтому внешний адрес виден ему и его сети."
          onChange={(value) => {
            props.write(["branding", "logoUrl"], value);
          }}
        />
      </div>
      <TextField
        label="Плашка о данных"
        value={config?.branding?.disclaimer ?? ""}
        disabled={disabled}
        multiline
        rows={3}
        hint="Показывается под строкой ввода. Пустое поле скрывает плашку: тогда о видимости диалогов и их использовании сообщать нечем."
        onChange={(value) => {
          props.write(["branding", "disclaimer"], value);
        }}
      />
      {(config?.branding?.disclaimer ?? "") === "" ? (
        <Notice tone="warn">
          Плашка о данных скрыта. Диалоги могут быть видны другим пользователям
          сервера и использоваться для улучшения ответов — предупредите об этом
          сами.
        </Notice>
      ) : null}
    </Section>
  );
}

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
  const modified = props.overridden(["session"]);
  return (
    <Section
      title="Сессия"
      modified={modified}
      aside={
        modified ? (
          <ResetButton
            disabled={disabled}
            label="Сбросить"
            onClick={() => {
              props.unset(["session"]);
            }}
          />
        ) : undefined
      }
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

/** What the visitor sees of the conversation. */
export function InterfaceSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const lockdownEnabled = config?.lockdown?.enabled ?? true;
  const allowReset = config?.lockdown?.allowSessionReset ?? false;
  const resetBlocked = lockdownEnabled && !allowReset;
  const reasoning = config?.ui?.showReasoning ?? false;
  const tools = config?.ui?.showToolActivity ?? false;
  const modified =
    props.overridden(["ui"]) ||
    props.overridden(["suggestedQuestions"]) ||
    props.overridden(["thinkingPhrases"]);
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
      aside={
        modified ? (
          <ResetButton
            disabled={disabled}
            label="Сбросить"
            onClick={() => {
              props.unset(["ui"]);
              props.unset(["suggestedQuestions"]);
              props.unset(["thinkingPhrases"]);
            }}
          />
        ) : undefined
      }
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
          label="Ширина содержимого, px"
          value={config?.ui?.maxContentWidth ?? 900}
          min={480}
          max={1600}
          disabled={disabled}
          hint="Предел ширины переписки; посетитель может сузить её в пределах этого значения."
          onChange={(value) => {
            props.write(["ui", "maxContentWidth"], value);
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

/** The execution policy every QA chat is pinned to. */
export function LockdownSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const lockdown = config?.lockdown;
  const enabled = lockdown?.enabled ?? true;
  const sandbox = lockdown?.sandboxMode ?? "read-only";
  const modified = props.overridden(["lockdown"]);
  return (
    <Section
      title="Блокировка"
      modified={modified}
      aside={
        modified ? (
          <ResetButton
            disabled={disabled}
            label="Сбросить"
            onClick={() => {
              props.unset(["lockdown"]);
            }}
          />
        ) : undefined
      }
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

/** The account gate, the self-declared profile, and per-user workspaces. */
export function AccountsSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const accounts = config?.accounts;
  const enabled = accounts?.enabled ?? false;
  const profile = accounts?.profile;
  const perUser = accounts?.perUserWorkspace ?? false;
  const gaps = perUser ? [] : perUserWorkspaceGaps(config ?? {});
  const modified = props.overridden(["accounts"]);
  return (
    <Section
      title="Аккаунты"
      modified={modified}
      aside={
        modified ? (
          <ResetButton
            disabled={disabled}
            label="Сбросить"
            onClick={() => {
              props.unset(["accounts"]);
            }}
          />
        ) : undefined
      }
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
    </Section>
  );
}

/** Which sources the assistant may cite, and how they are shown. */
export function SourcesSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const sources = config?.sources;
  const enabled = sources?.enabled ?? true;
  const filePreview = sources?.filePreview;
  const maxBytes = filePreview?.maxBytes ?? 2_000_000;
  const maxRender = filePreview?.maxMarkdownRenderBytes ?? 1_000_000;
  const modified = props.overridden(["sources"]);
  const blocked = disabled || !enabled;
  return (
    <Section
      title="Источники"
      modified={modified}
      aside={
        modified ? (
          <ResetButton
            disabled={disabled}
            label="Сбросить"
            onClick={() => {
              props.unset(["sources"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="qa-card-grid">
        <Toggle
          checked={enabled}
          disabled={disabled}
          label="Собирать источники"
          hint="Ссылки, файлы и результаты поиска, на которые опирался ответ, показываются под сообщением."
          onChange={(value) => {
            props.write(["sources", "enabled"], value);
          }}
        />
        <Toggle
          checked={sources?.collect?.parentAgent ?? true}
          disabled={blocked}
          label="Источники основного агента"
          hint="Собираются с хода самого помощника."
          onChange={(value) => {
            props.write(["sources", "collect", "parentAgent"], value);
          }}
        />
        <Toggle
          checked={sources?.collect?.subagents ?? true}
          disabled={blocked}
          label="Источники субагентов"
          hint="Собираются и с делегированных экспертов."
          onChange={(value) => {
            props.write(["sources", "collect", "subagents"], value);
          }}
        />
        <Toggle
          checked={sources?.collect?.persistTurnEvent ?? true}
          disabled={blocked}
          label="Писать источники в журнал"
          hint="Позволяет восстановить список источников при перезагрузке страницы."
          onChange={(value) => {
            props.write(["sources", "collect", "persistTurnEvent"], value);
          }}
        />
      </div>
      <details className="qa-card-advanced">
        <summary>Отображение</summary>
        <div className="qa-card-advanced-content qa-card-grid">
          <Toggle
            checked={sources?.display?.sidebar ?? true}
            disabled={blocked}
            label="Панель источников"
            hint="Боковая панель со списком источников хода."
            onChange={(value) => {
              props.write(["sources", "display", "sidebar"], value);
            }}
          />
          <Toggle
            checked={sources?.display?.footer ?? true}
            disabled={blocked}
            label="Строка источников под ответом"
            hint="Короткая сводка под сообщением."
            onChange={(value) => {
              props.write(["sources", "display", "footer"], value);
            }}
          />
          <Toggle
            checked={sources?.display?.groupByKind ?? true}
            disabled={blocked}
            label="Группировать по типу"
            hint="Файлы, ссылки и поиск идут отдельными группами."
            onChange={(value) => {
              props.write(["sources", "display", "groupByKind"], value);
            }}
          />
          <Toggle
            checked={sources?.display?.showDiscovered ?? false}
            disabled={blocked}
            label="Показывать найденное попутно"
            hint="Источники, которые агент не подтвердил как использованные."
            onChange={(value) => {
              props.write(["sources", "display", "showDiscovered"], value);
            }}
          />
          <Toggle
            checked={sources?.display?.showOriginBadges ?? false}
            disabled={blocked}
            label="Пометки происхождения"
            hint="Откуда взялся источник: файл, поиск, инструмент."
            onChange={(value) => {
              props.write(["sources", "display", "showOriginBadges"], value);
            }}
          />
          <NumberField
            label="Видимых источников на группу"
            value={sources?.display?.maxInitiallyVisiblePerGroup ?? 8}
            min={1}
            max={100}
            disabled={blocked}
            hint="Остальные скрыты под «показать все»."
            onChange={(value) => {
              props.write(
                ["sources", "display", "maxInitiallyVisiblePerGroup"],
                value,
              );
            }}
          />
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Поиск в сети</summary>
        <div className="qa-card-advanced-content qa-card-grid">
          <Toggle
            checked={
              sources?.webSearch?.promoteSearchResultsWithoutFetch ?? true
            }
            disabled={blocked}
            label="Ссылки из поиска — тоже источники"
            hint="Результат поиска засчитывается как источник, даже если страницу не открывали."
            onChange={(value) => {
              props.write(
                ["sources", "webSearch", "promoteSearchResultsWithoutFetch"],
                value,
              );
            }}
          />
          <NumberField
            label="Ссылок из одного поиска"
            value={sources?.webSearch?.maxPromotedPerSearch ?? 5}
            min={0}
            max={50}
            disabled={blocked}
            hint="0 отключает зачисление ссылок из выдачи."
            onChange={(value) => {
              props.write(
                ["sources", "webSearch", "maxPromotedPerSearch"],
                value,
              );
            }}
          />
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Склейка дублей</summary>
        <div className="qa-card-advanced-content qa-card-grid">
          <Toggle
            checked={sources?.dedupe?.normalizeUrls ?? true}
            disabled={blocked}
            label="Приводить адреса к общему виду"
            hint="Одинаковые страницы не дублируются."
            onChange={(value) => {
              props.write(["sources", "dedupe", "normalizeUrls"], value);
            }}
          />
          <Toggle
            checked={sources?.dedupe?.stripTrackingParams ?? true}
            disabled={blocked}
            label="Отбрасывать метки переходов"
            hint="utm-метки и подобные параметры не делают ссылку новой."
            onChange={(value) => {
              props.write(["sources", "dedupe", "stripTrackingParams"], value);
            }}
          />
          <Toggle
            checked={sources?.dedupe?.mergeFileRanges ?? true}
            disabled={blocked}
            label="Объединять фрагменты файла"
            hint="Соседние диапазоны одного файла показываются одной записью."
            onChange={(value) => {
              props.write(["sources", "dedupe", "mergeFileRanges"], value);
            }}
          />
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Предпросмотр файлов</summary>
        <div className="qa-card-advanced-content">
          <div className="qa-card-grid">
            <Toggle
              checked={filePreview?.enabled ?? true}
              disabled={blocked}
              label="Открывать источник-файл"
              hint="Просмотр доступен только для файлов, уже попавших в источники ответа."
              onChange={(value) => {
                props.write(["sources", "filePreview", "enabled"], value);
              }}
            />
            <Toggle
              checked={filePreview?.markdownRenderedByDefault ?? true}
              disabled={blocked || !(filePreview?.enabled ?? true)}
              label="Markdown сразу размечен"
              hint="Иначе файл открывается как обычный текст."
              onChange={(value) => {
                props.write(
                  ["sources", "filePreview", "markdownRenderedByDefault"],
                  value,
                );
              }}
            />
            <Toggle
              checked={filePreview?.allowRawToggle ?? true}
              disabled={blocked || !(filePreview?.enabled ?? true)}
              label="Переключатель «исходный текст»"
              hint="Позволяет читателю увидеть файл без разметки."
              onChange={(value) => {
                props.write(
                  ["sources", "filePreview", "allowRawToggle"],
                  value,
                );
              }}
            />
            <NumberField
              label="Предел размера файла, байт"
              value={maxBytes}
              min={1_024}
              max={20_000_000}
              disabled={blocked}
              hint={`≈ ${formatCount(Math.round(maxBytes / 1024))} КиБ.`}
              onChange={(value) => {
                props.write(["sources", "filePreview", "maxBytes"], value);
              }}
            />
            <NumberField
              label="Предел разметки, байт"
              value={maxRender}
              min={1_024}
              max={10_000_000}
              disabled={blocked}
              hint="Больший файл откроется текстом; не может превышать предел размера файла."
              onChange={(value) => {
                props.write(
                  ["sources", "filePreview", "maxMarkdownRenderBytes"],
                  value,
                );
              }}
            />
          </div>
          {maxRender > maxBytes ? (
            <Notice tone="warn">
              Предел разметки выше предела размера файла — хост отвергнет такую
              конфигурацию.
            </Notice>
          ) : null}
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Субагенты</summary>
        <div className="qa-card-advanced-content qa-card-grid">
          <Toggle
            checked={sources?.subagents?.inheritSources ?? true}
            disabled={blocked}
            label="Наследовать источники"
            hint="Ответ эксперта несёт источник, из которого он работал."
            onChange={(value) => {
              props.write(["sources", "subagents", "inheritSources"], value);
            }}
          />
          <Toggle
            checked={sources?.subagents?.enableReportToolFallback ?? true}
            disabled={blocked}
            label="Запасной канал отчёта"
            hint="Если эксперт не вернул источники сам, они берутся из отчёта."
            onChange={(value) => {
              props.write(
                ["sources", "subagents", "enableReportToolFallback"],
                value,
              );
            }}
          />
          <Toggle
            checked={sources?.subagents?.markIncompleteOpaqueRuns ?? true}
            disabled={blocked}
            label="Помечать неполные прогоны"
            hint="Ход, чьи источники собраны не полностью, честно помечается."
            onChange={(value) => {
              props.write(
                ["sources", "subagents", "markIncompleteOpaqueRuns"],
                value,
              );
            }}
          />
        </div>
      </details>
      <details className="qa-card-advanced">
        <summary>Совместимость</summary>
        <div className="qa-card-advanced-content">
          <Toggle
            checked={sources?.legacy?.parseAssistantSourcesBlock ?? false}
            disabled={blocked}
            label="Разбирать старый блок источников"
            hint="Совместимость с ответами прежних версий, где список источников приходил текстом."
            onChange={(value) => {
              props.write(
                ["sources", "legacy", "parseAssistantSourcesBlock"],
                value,
              );
            }}
          />
        </div>
      </details>
    </Section>
  );
}

/** Embedding the page into another site's frame. */
export function EmbeddingSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const frameAncestors = config?.embedding?.frameAncestors ?? "";
  const modified = props.overridden(["embedding"]);
  return (
    <Section
      title="Встраивание"
      modified={modified}
      aside={
        modified ? (
          <ResetButton
            disabled={disabled}
            label="Сбросить"
            onClick={() => {
              props.unset(["embedding"]);
            }}
          />
        ) : undefined
      }
    >
      <TextField
        label="Источники для iframe"
        value={frameAncestors}
        disabled={disabled}
        placeholder="https://portal.example"
        hint="Значение заголовка Content-Security-Policy: frame-ancestors. Пусто — страницу нельзя встроить в чужой фрейм."
        onChange={(value) => {
          props.write(["embedding", "frameAncestors"], value);
        }}
      />
      {frameAncestors !== "" ? (
        <Notice tone="warn">
          Встраивание разрешено для «{frameAncestors}». Эти сайты смогут
          показать страницу помощника в своём фрейме; убедитесь, что список
          узкий.
        </Notice>
      ) : null}
    </Section>
  );
}
