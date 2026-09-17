/**
 * Slash interface: the master switch, the two admission policies and the
 * palette itself.
 *
 * The allow lists stay name-based, which is what the deployment config stores
 * — an operator writes `generate-tkp`, never an id. They are plain lists
 * rather than checkboxes over a discovered catalog because the two halves are
 * discovered differently and only one of them can be enumerated here at all:
 * skills are a registry lookup, while a command is only resolvable against a
 * live chat's agent, so this card could not honestly offer a fixed list of
 * command names to tick.
 */

import {
  ListField,
  Notice,
  NumberField,
  Section,
  SelectField,
  Toggle,
} from "../fields.js";
import { parseCommaList } from "../format.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

const POLICY_MODES = [
  { value: "deny-all", label: "Запретить всё" },
  { value: "allow-list", label: "Только из списка" },
  { value: "all", label: "Все доступные" },
];

/** Master switch, per-kind admission policy and palette presentation. */
export function SlashSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const slash = config?.slashCommands;
  const allow = config?.lockdown?.allowSlashCommands ?? false;
  const skillMode = slash?.skills?.mode ?? "allow-list";
  const commandMode = slash?.commands?.mode ?? "deny-all";
  const palette = slash?.palette;
  const paths: SectionPaths = [
    ["slashCommands"],
    ["lockdown", "allowSlashCommands"],
  ];
  const modified = overriddenAny(props, paths);
  // Effective policy: while the switch is off nothing below has an effect, and
  // saying so is the difference between "misconfigured" and "not enabled".
  const effective = props.effective?.slashCommands;
  return (
    <Section
      title="Слеш-действия"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <Toggle
        checked={allow}
        disabled={disabled}
        label="Разрешить слэш-действия"
        hint="Открывает палитру по «/» в поле ввода. Сама по себе ничего не разрешает: навыки и команды перечисляются отдельно ниже."
        onChange={(value) => {
          props.write(["lockdown", "allowSlashCommands"], value);
        }}
      />
      {allow ? null : (
        <Notice tone="info">
          Слэш-действия выключены: «/» в начале сообщения по-прежнему
          отвергается с подсказкой, палитра не открывается.
        </Notice>
      )}
      <SelectField
        label="Навыки"
        value={skillMode}
        disabled={disabled}
        options={POLICY_MODES}
        hint="«Все доступные» — это user-invocable навыки текущего чата, а не весь реестр."
        onChange={(value) => {
          props.write(["slashCommands", "skills", "mode"], value);
        }}
      />
      <ListField
        label="Разрешённые навыки"
        value={slash?.skills?.allow ?? []}
        disabled={disabled || skillMode !== "allow-list"}
        placeholder="generate-tkp, generate-tz, gap-analysis"
        hint="Точные имена без слеша, через запятую или по одному в строке. Действует при режиме «Только из списка»."
        parse={parseCommaList}
        onCommit={(values) => {
          props.write(["slashCommands", "skills", "allow"], values);
        }}
      />
      <SelectField
        label="Команды"
        value={commandMode}
        disabled={disabled}
        options={POLICY_MODES}
        hint="Команды — это управляющий слой: они выполняются хостом напрямую и не становятся сообщением модели."
        onChange={(value) => {
          props.write(["slashCommands", "commands", "mode"], value);
        }}
      />
      <ListField
        label="Разрешённые команды"
        value={slash?.commands?.allow ?? []}
        disabled={disabled || commandMode !== "allow-list"}
        placeholder="compact, export"
        hint="Точные имена без слеша. По умолчанию не разрешена ни одна команда: новая команда установленного плагина не должна появляться в палитре сама."
        parse={parseCommaList}
        onCommit={(values) => {
          props.write(["slashCommands", "commands", "allow"], values);
        }}
      />
      <div className="qa-card-grid">
        <Toggle
          checked={palette?.enabled ?? true}
          disabled={disabled}
          label="Показывать палитру"
          hint="Список действий над полем ввода. Выключение не запрещает уже разрешённые действия — их можно набрать вручную."
          onChange={(value) => {
            props.write(["slashCommands", "palette", "enabled"], value);
          }}
        />
        <Toggle
          checked={palette?.fuzzySearch ?? true}
          disabled={disabled}
          label="Нечёткий поиск"
          hint="Дополнительно ищет по подстроке и по порядку букв. Выключенный — только совпадение, начало имени и граница слова."
          onChange={(value) => {
            props.write(["slashCommands", "palette", "fuzzySearch"], value);
          }}
        />
        <NumberField
          label="Строк в палитре"
          value={palette?.maxVisible ?? 12}
          min={1}
          max={100}
          disabled={disabled}
          hint="Сколько совпадений показывать; остальные отсекаются по релевантности."
          onChange={(value) => {
            props.write(["slashCommands", "palette", "maxVisible"], value);
          }}
        />
      </div>
      {effective?.legacyDefaults === true ? (
        <Notice tone="warn">
          Включён устаревший режим совместимости: развёртывание включает
          слэш-действия, но не описывает их политику. Разрешены все
          user-invocable навыки чата, команды запрещены — перечислите команды
          явно, чтобы они появились.
        </Notice>
      ) : null}
      <p className="qa-card-muted">
        Слэш-действия не расширяют права: песочница, белый список инструментов и
        подтверждения остаются прежними. Навык лишь добавляет модели инструкции,
        команда выполняется хостом.
      </p>
    </Section>
  );
}
